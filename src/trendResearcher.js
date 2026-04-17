/**
 * TrendResearcher - バズ投稿パターン分析
 *
 * 自分の過去投稿データからClaudeを使って「伸びる投稿の法則」を分析する。
 * - 文字数・ハッシュタグ・時間帯・カテゴリ別のエンゲージメント傾向
 * - トップ投稿の共通パターン抽出
 * - 次の投稿への具体的な改善提案
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import { config } from '../config/config.js';

dayjs.locale('ja');

const CACHE_DIR = './data/trend';
const CACHE_TTL_HOURS = 6;

export class TrendResearcher {
  constructor(storage) {
    this.storage = storage;
    this.client = config.claude.apiKey
      ? new Anthropic({ apiKey: config.claude.apiKey })
      : null;
  }

  /**
   * バズ投稿パターン分析（メインエントリー）
   * @param {Array} posts - analyst.js が取得した投稿配列
   * @returns {Object} 分析結果
   */
  async analyzeMyPostPatterns(posts) {
    if (!posts?.length) {
      return { error: '投稿データがありません' };
    }

    // キャッシュ確認
    const cached = await this.loadCachedResult();
    if (cached) return cached;

    const features = this._aggregateFeatures(posts);
    const topPosts = this._extractTopPosts(posts, 15);

    let result;
    if (this.client) {
      result = await this._analyzeWithClaude(features, topPosts, posts.length);
    } else {
      result = this._buildStaticAnalysis(features, topPosts);
    }

    result.generatedAt = dayjs().toISOString();
    result.postCount = posts.length;
    result.features = features;
    result.topPosts = topPosts.slice(0, 10);

    await this.saveResult(result);
    return result;
  }

  /**
   * 投稿の特徴量を集計
   */
  _aggregateFeatures(posts) {
    const buckets = {
      byLength:  { short: [], medium: [], long: [] },
      byHour:    {},
      byWeekday: { 月: [], 火: [], 水: [], 木: [], 金: [], 土: [], 日: [] },
      byHashtag: { none: [], some: [], many: [] },
    };

    for (const p of posts) {
      const text   = p.text || '';
      const len    = text.length;
      const er     = parseFloat(p.engagementRate || 0);
      const views  = p.views || 0;
      const score  = (p.like_count || 0) * 2 + (p.reply_count || 0) * 3 + (p.repost_count || 0) * 4;
      const tags   = (text.match(/#\S+/g) || []).length;
      const ts     = p.timestamp ? dayjs(p.timestamp) : null;

      // 文字数別
      if (len < 80) buckets.byLength.short.push({ er, score, views });
      else if (len < 200) buckets.byLength.medium.push({ er, score, views });
      else buckets.byLength.long.push({ er, score, views });

      // 時間帯別
      if (ts) {
        const h = ts.hour();
        if (!buckets.byHour[h]) buckets.byHour[h] = [];
        buckets.byHour[h].push({ er, score, views });
      }

      // 曜日別
      if (ts) {
        const wd = ts.format('ddd');
        const wdMap = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土', Sun: '日' };
        const key = wdMap[wd] || wd;
        if (buckets.byWeekday[key]) buckets.byWeekday[key].push({ er, score, views });
      }

      // ハッシュタグ数別
      if (tags === 0) buckets.byHashtag.none.push({ er, score, views });
      else if (tags <= 3) buckets.byHashtag.some.push({ er, score, views });
      else buckets.byHashtag.many.push({ er, score, views });
    }

    const avg = arr => arr.length ? (arr.reduce((s, x) => s + x, 0) / arr.length) : 0;
    const summarize = arr => ({
      count: arr.length,
      avgER: avg(arr.map(x => x.er)).toFixed(2),
      avgScore: Math.round(avg(arr.map(x => x.score))),
      avgViews: Math.round(avg(arr.map(x => x.views))),
    });

    return {
      byLength: {
        short:  summarize(buckets.byLength.short),
        medium: summarize(buckets.byLength.medium),
        long:   summarize(buckets.byLength.long),
      },
      byHour: Object.fromEntries(
        Object.entries(buckets.byHour)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([h, arr]) => [h, summarize(arr)])
      ),
      byWeekday: Object.fromEntries(
        Object.entries(buckets.byWeekday).map(([d, arr]) => [d, summarize(arr)])
      ),
      byHashtag: {
        none: summarize(buckets.byHashtag.none),
        some: summarize(buckets.byHashtag.some),
        many: summarize(buckets.byHashtag.many),
      },
    };
  }

  /**
   * エンゲージメントスコア上位N件を抽出
   */
  _extractTopPosts(posts, topN = 15) {
    return [...posts]
      .map(p => ({
        ...p,
        _score: (p.like_count || 0) * 2 + (p.reply_count || 0) * 3 + (p.repost_count || 0) * 4,
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, topN)
      .map(p => ({
        text: (p.text || '').substring(0, 120),
        views: p.views,
        like_count: p.like_count,
        reply_count: p.reply_count,
        repost_count: p.repost_count,
        engagementRate: p.engagementRate,
        timestamp: p.timestamp,
        score: p._score,
      }));
  }

  /**
   * Claude でパターン分析
   */
  async _analyzeWithClaude(features, topPosts, totalPostCount) {
    const prompt = `あなたはThreadsのSNSマーケティング専門家です。
以下のデータを分析し、「どんな投稿が伸びているか」を具体的に教えてください。

## 総投稿数: ${totalPostCount}件

## 文字数別パフォーマンス
${JSON.stringify(features.byLength, null, 2)}

## 時間帯別パフォーマンス（上位5時間帯）
${JSON.stringify(
  Object.entries(features.byHour)
    .sort((a, b) => parseFloat(b[1].avgER) - parseFloat(a[1].avgER))
    .slice(0, 5)
    .reduce((obj, [k, v]) => ({ ...obj, [k + '時']: v }), {}),
  null, 2
)}

## 曜日別パフォーマンス
${JSON.stringify(features.byWeekday, null, 2)}

## ハッシュタグ数別パフォーマンス
${JSON.stringify(features.byHashtag, null, 2)}

## エンゲージメントスコア上位10投稿（冒頭120文字）
${topPosts.slice(0, 10).map((p, i) =>
  `${i + 1}. [ER:${p.engagementRate}% スコア:${p.score} 閲覧:${p.views}]\n   "${p.text}"`
).join('\n')}

## 分析してほしいこと（JSON形式で返してください）

\`\`\`json
{
  "summary": "3〜4行の総括",
  "winningPatterns": [
    { "pattern": "パターン名", "detail": "詳細説明", "evidence": "根拠データ" }
  ],
  "optimalLength": { "recommendation": "推奨文字数", "reason": "理由" },
  "optimalTiming": { "bestHours": [時間帯リスト], "bestDays": [曜日リスト], "reason": "理由" },
  "hashtagStrategy": { "recommendation": "推奨", "reason": "理由" },
  "contentInsights": [
    { "insight": "気づき", "actionable": "具体的なアクション" }
  ],
  "nextPostTips": ["すぐ使える具体的なTips（5つ）"]
}
\`\`\``;

    try {
      const msg = await this.client.messages.create({
        model: config.claude.model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = msg.content[0]?.text || '';
      const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      // JSONブロックがない場合はそのままテキストとして返す
      return { summary: text, winningPatterns: [], nextPostTips: [] };
    } catch (e) {
      return this._buildStaticAnalysis(features, topPosts);
    }
  }

  /**
   * Claude API 未使用時のフォールバック分析
   */
  _buildStaticAnalysis(features, topPosts) {
    const byLength = features.byLength;
    const bestLength = Object.entries(byLength).sort((a, b) => parseFloat(b[1].avgER) - parseFloat(a[1].avgER))[0];

    const bestHour = Object.entries(features.byHour).sort((a, b) => parseFloat(b[1].avgER) - parseFloat(a[1].avgER))[0];
    const bestDay = Object.entries(features.byWeekday).filter(([, v]) => v.count > 0).sort((a, b) => parseFloat(b[1].avgER) - parseFloat(a[1].avgER))[0];

    return {
      summary: `${topPosts.length}件の上位投稿を分析しました。最もエンゲージメントが高い文字数は「${bestLength?.[0] || '-'}」、最適投稿時間は「${bestHour?.[0] || '-'}時」です。`,
      winningPatterns: topPosts.slice(0, 3).map((p, i) => ({
        pattern: `上位${i + 1}位の投稿スタイル`,
        detail: p.text,
        evidence: `ER: ${p.engagementRate}%, スコア: ${p.score}`,
      })),
      optimalLength: { recommendation: bestLength?.[0], reason: `平均ER ${bestLength?.[1]?.avgER}%` },
      optimalTiming: { bestHours: [bestHour?.[0]], bestDays: [bestDay?.[0]], reason: '分析結果より' },
      hashtagStrategy: { recommendation: '1〜3個が推奨', reason: 'ハッシュタグ数別の分析による' },
      contentInsights: [],
      nextPostTips: ['上位投稿の冒頭パターンを参考にする', '最適な時間帯に投稿する', '最適な文字数を意識する'],
    };
  }

  /**
   * 自分の投稿を分析し、ベンチマークすべきアカウントの特徴と候補をClaudeが推薦
   * @param {Array} posts
   * @param {Object} metrics
   * @returns {Object}
   */
  async recommendCompetitors(posts, metrics) {
    if (!posts?.length) return { error: '投稿データがありません' };

    // キャッシュ確認（当日分）
    const cacheFile = path.join(CACHE_DIR, `recommend_${dayjs().format('YYYY-MM-DD')}.json`);
    try {
      const raw = await fs.readFile(cacheFile, 'utf-8');
      const cached = JSON.parse(raw);
      if (cached.generatedAt && dayjs().diff(dayjs(cached.generatedAt), 'hour') < 12) {
        return { ...cached, fromCache: true };
      }
    } catch { /* キャッシュなし */ }

    const topPosts = this._extractTopPosts(posts, 20);
    const features = this._aggregateFeatures(posts);

    if (!this.client) {
      return { error: 'Claude APIキーが設定されていません。.envにANTHROPIC_API_KEYを設定してください。' };
    }

    // 投稿テーマ・キーワードを抽出するためのサンプル
    const postSamples = topPosts.slice(0, 20).map((p, i) =>
      `${i + 1}. [ER:${p.engagementRate}% いいね:${p.like_count} 閲覧:${p.views}]\n"${p.text}"`
    ).join('\n\n');

    const prompt = `あなたはSNSマーケティングの専門家です。
以下はあるThreadsアカウントの実際の投稿データです。このデータを分析し、
「どんなアカウントをベンチマークすべきか」を具体的に提案してください。

## アカウント基本指標
- フォロワー数: ${metrics.followersCount}人
- 総投稿数: ${posts.length}件
- 平均閲覧数: ${metrics.avgViews}
- 平均ER: ${metrics.engagementRate || metrics.avgEngagementRate}%
- 総いいね: ${metrics.totalLikes}

## エンゲージメント上位20投稿
${postSamples}

## 文字数別パフォーマンス
${JSON.stringify(features.byLength, null, 2)}

---

以下のJSON形式で回答してください:

\`\`\`json
{
  "accountAnalysis": {
    "mainThemes": ["投稿の主要テーマ（3〜5個）"],
    "contentStyle": "コンテンツスタイルの説明（2〜3行）",
    "targetAudience": "想定読者層",
    "currentStrengths": ["強み（3つ）"],
    "growthOpportunities": ["伸びしろ（3つ）"]
  },
  "benchmarkCriteria": {
    "why": "なぜこの基準でベンチマークすべきか（2〜3行）",
    "idealProfiles": [
      {
        "type": "ベンチマーク先タイプ名",
        "reason": "このタイプを参考にすべき理由",
        "whatToLearn": "学べること"
      }
    ]
  },
  "recommendedAccounts": [
    {
      "username": "Threadsのユーザー名（@なし、実在するアカウント）",
      "displayName": "表示名",
      "reason": "推薦理由（具体的に）",
      "expectedLearning": "このアカウントから学べること",
      "followerRange": "フォロワー数の目安（例: 1万〜5万）",
      "confidence": "high|medium|low（アカウント実在の確信度）"
    }
  ],
  "searchKeywords": ["Threadsで検索すると類似アカウントが見つかるキーワード（5個）"],
  "actionPlan": "今すぐ実行できる具体的なアクション（3ステップ）"
}
\`\`\`

注意:
- recommendedAccountsは必ず実在するThreadsアカウントのユーザー名を記載してください
- 日本語で活躍しているアカウントを優先してください
- フォロワー数はこのアカウントの10〜100倍程度を目安に（学べる差があるが遠すぎない）
- confidenceがlowの場合はそのように明示してください`;

    try {
      const msg = await this.client.messages.create({
        model: config.claude.model,
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = msg.content[0]?.text || '';
      const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
      if (!jsonMatch) throw new Error('JSONパース失敗');

      const result = {
        ...JSON.parse(jsonMatch[1]),
        generatedAt: dayjs().toISOString(),
        basedOnPosts: posts.length,
      };

      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(result, null, 2), 'utf-8');
      return result;
    } catch (e) {
      // クレジット不足・APIエラー時はルールベースにフォールバック
      if (e.message?.includes('credit') || e.message?.includes('402') || e.message?.includes('billing')) {
        return this._recommendByRules(posts, metrics);
      }
      throw new Error(`推薦生成失敗: ${e.message}`);
    }
  }

  /**
   * Claude不使用のルールベースフォールバック
   */
  _recommendByRules(posts, metrics) {
    const features = this._aggregateFeatures(posts);
    const topPosts = this._extractTopPosts(posts, 20);

    // テキストから頻出ワードでテーマ推定
    const allText = posts.map(p => p.text || '').join(' ');
    const themeKeywords = {
      '日常・生活': /日常|生活|毎日|今日|昨日|朝|夜|ご飯|食べ/,
      'ビジネス・副業': /仕事|ビジネス|副業|収入|稼ぐ|フリーランス|起業/,
      'SNS運用': /threads|インスタ|SNS|フォロワー|投稿|エンゲージメント/i,
      '健康・ダイエット': /ダイエット|健康|筋トレ|運動|痩せ|体重/,
      '恋愛・人間関係': /恋愛|彼氏|彼女|結婚|友達|人間関係/,
      '思考・考察': /思う|考える|感じ|なぜ|どうして|〜について/,
    };

    const detectedThemes = Object.entries(themeKeywords)
      .filter(([, re]) => re.test(allText))
      .map(([theme]) => theme)
      .slice(0, 4);

    // ベストタイムとベスト文字数
    const bestHour = Object.entries(features.byHour)
      .sort((a, b) => parseFloat(b[1].avgER) - parseFloat(a[1].avgER))[0];
    const bestLength = Object.entries(features.byLength)
      .sort((a, b) => parseFloat(b[1].avgER) - parseFloat(a[1].avgER))[0];

    const followerCount = metrics.followersCount || 0;
    const targetMin = Math.round(followerCount * 5 / 1000) * 1000;
    const targetMax = Math.round(followerCount * 50 / 1000) * 1000;
    const followerRange = `${(targetMin/10000).toFixed(1)}万〜${(targetMax/10000).toFixed(1)}万`;

    return {
      accountAnalysis: {
        mainThemes: detectedThemes.length ? detectedThemes : ['日常・生活', '思考・考察'],
        contentStyle: `フォロワー${followerCount}人のアカウント。平均閲覧数${metrics.avgViews}、ER${metrics.engagementRate}%。${bestLength?.[0] === 'short' ? '短文' : bestLength?.[0] === 'medium' ? '中文' : '長文'}が最もエンゲージメント高い。`,
        targetAudience: '一般ユーザー・同年代',
        currentStrengths: [
          `${bestHour ? bestHour[0] + '時台の投稿が高ER' : '定期的な投稿'}`,
          `${topPosts[0]?.text?.substring(0, 20) || ''}系コンテンツが得意`,
          `総投稿${posts.length}件の継続力`,
        ],
        growthOpportunities: [
          'エンゲージメントの高い投稿パターンの一貫化',
          'フォロワー数に対してリーチを拡大',
          '他アカウントとの差別化コンテンツの開発',
        ],
      },
      benchmarkCriteria: {
        why: `現在フォロワー${followerCount}人なので、${followerRange}規模の同ジャンルアカウントを参考にするのが最も学びやすい。`,
        idealProfiles: [
          { type: '同ジャンル・上位アカウント', reason: '同じテーマで成功しているアカウント', whatToLearn: '投稿フォーマット・頻度・トーン' },
          { type: '急成長アカウント', reason: '最近フォロワーが急増したアカウント', whatToLearn: 'バズパターン・タイミング' },
          { type: 'ER高効率アカウント', reason: 'フォロワー数は少なくてもERが高いアカウント', whatToLearn: '濃いコンテンツの作り方' },
        ],
      },
      recommendedAccounts: [
        { username: 'kzktone', displayName: '自分のアカウント', reason: '現状ベースライン', expectedLearning: '自分のデータを基準に', followerRange: `${followerCount}人`, confidence: 'high' },
      ],
      searchKeywords: detectedThemes.concat(['Threads運用', '日本語アカウント']).slice(0, 5),
      actionPlan: '1. 上記の推薦アカウントを「競合比較」に追加してデータ取得\n2. 自分のトップ投稿との共通点を探す\n3. 週1回ベンチマークを更新して差分を確認',
      generatedAt: dayjs().toISOString(),
      basedOnPosts: posts.length,
      _fallback: true,
      _note: 'Claude APIクレジットが不足しているためルールベース分析を使用。APIを補充すると詳細なAI分析が利用できます。',
    };
  }

  async saveResult(result) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `pattern_${dayjs().format('YYYY-MM-DD')}.json`);
    await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf-8');
  }

  async loadCachedResult() {
    const file = path.join(CACHE_DIR, `pattern_${dayjs().format('YYYY-MM-DD')}.json`);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const data = JSON.parse(raw);
      // CACHE_TTL_HOURS 以内なら有効
      if (data.generatedAt) {
        const age = dayjs().diff(dayjs(data.generatedAt), 'hour');
        if (age < CACHE_TTL_HOURS) return { ...data, fromCache: true };
      }
    } catch { /* キャッシュなし */ }
    return null;
  }
}
