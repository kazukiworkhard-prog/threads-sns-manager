/**
 * AI アナリスト (AIAnalyst) - Claude APIによるインサイト分析レポート生成
 *
 * プロのSNSコンサルタント視点で、Threadsインサイトデータを
 * 実践的なアクションプランへと変換する高品質レポートを生成する
 */

import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import ora from 'ora';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config.js';

dayjs.locale('ja');

const SYSTEM_PROMPT = `あなたはThreads専門のSNSコンサルタントです。
クライアントのアカウントデータを分析し、エグゼクティブが即座に意思決定できるレポートを作成します。

## あなたの分析哲学
- 数値を「読む」のではなく「解釈する」
- 相関関係より因果仮説を重視する
- 「何が起きたか」より「なぜ起きたか」「次に何をするか」を優先する
- クライアントの目標（フォロワー増加・エンゲージメント改善・認知拡大）に常に紐付ける

## 禁止事項
- 数値の羅列のみのレポート
- 「〜と思われます」などの曖昧な表現（根拠を示すこと）
- 汎用的すぎる提言（具体的なアクション指示を必ず含める）`;

export class AIAnalyst {
  constructor() {
    if (config.claude?.apiKey) {
      this.client = new Anthropic({ apiKey: config.claude.apiKey });
    }
    this.reportDir = config.system?.reportDir || './reports';
  }

  /**
   * インサイトデータからAI分析レポートを生成する
   * @param {Object} insightData - analyst.js の collectDailyInsights() 出力
   * @param {Object} prevInsightData - 前期比較用データ（任意）
   * @param {Object} options - { clientName, period }
   */
  async generateReport(insightData, prevInsightData = {}, options = {}) {
    const spinner = ora('AI コンサルタントがレポートを作成中...').start();

    try {
      let reportText;
      if (this.client) {
        try {
          reportText = await this._generateWithClaude(insightData, prevInsightData, options);
        } catch (apiError) {
          spinner.warn(`Claude API エラー (フォールバックに切替): ${apiError.message}`);
          reportText = this._generateFallbackReport(insightData, options);
        }
      } else {
        spinner.warn('ANTHROPIC_API_KEY 未設定 — フォールバックレポートを生成します');
        reportText = this._generateFallbackReport(insightData, options);
      }

      const saved = await this._saveReport(reportText, options);
      spinner.succeed(chalk.green('AI分析レポート生成完了'));
      this._printReport(reportText);

      return { text: reportText, ...saved };
    } catch (error) {
      spinner.fail(`AI分析レポート生成失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * Claude API でレポートを生成
   */
  async _generateWithClaude(insightData, prev, options) {
    const userPrompt = this._buildUserPrompt(insightData, prev, options);

    const message = await this.client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    return message.content[0].text;
  }

  /**
   * ユーザープロンプトを構築（インサイトデータをテンプレートに埋め込む）
   */
  _buildUserPrompt(insightData, prev, options) {
    const metrics = insightData?.engagementMetrics || insightData?.summary || {};
    const posts = insightData?.posts || [];
    const topPosts = [...posts]
      .map(p => ({
        ...p,
        er: p.views > 0
          ? (((p.like_count || 0) + (p.reply_count || 0) + (p.repost_count || 0) + (p.quote_count || 0)) / p.views * 100)
          : 0,
      }))
      .sort((a, b) => {
        const scoreA = (a.like_count || 0) * 2 + (a.reply_count || 0) * 3 + (a.repost_count || 0) * 4 + (a.quote_count || 0) * 4;
        const scoreB = (b.like_count || 0) * 2 + (b.reply_count || 0) * 3 + (b.repost_count || 0) * 4 + (b.quote_count || 0) * 4;
        return scoreB - scoreA;
      })
      .slice(0, 10);

    const prevMetrics = prev?.engagementMetrics || prev?.summary || {};

    const calcDiff = (curr, prev) => {
      const c = Number(curr) || 0;
      const p = Number(prev) || 0;
      if (p === 0) return c > 0 ? '+∞' : '—';
      const pct = ((c - p) / p * 100).toFixed(1);
      return pct > 0 ? `+${pct}%` : `${pct}%`;
    };

    const period = options.period || {
      start: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
      end: dayjs().format('YYYY-MM-DD'),
      days: 30,
    };

    const topPostsText = topPosts.map((p, i) =>
      `${i + 1}. [${dayjs(p.timestamp).format('MM/DD HH:mm')}] Views:${p.views || 0} / Likes:${p.like_count || 0} / Replies:${p.reply_count || 0} / ER:${p.er.toFixed(2)}%\n   本文: 「${(p.text || '').slice(0, 60)}${(p.text || '').length > 60 ? '...' : ''}」`
    ).join('\n') || '（データなし）';

    // 時間帯別分析
    const hourlyMap = {};
    posts.forEach(p => {
      const h = dayjs(p.timestamp).hour();
      if (!hourlyMap[h]) hourlyMap[h] = { count: 0, totalER: 0 };
      const er = p.views > 0
        ? (((p.like_count || 0) + (p.reply_count || 0) + (p.repost_count || 0) + (p.quote_count || 0)) / p.views * 100)
        : 0;
      hourlyMap[h].count++;
      hourlyMap[h].totalER += er;
    });
    const hourlyText = Object.entries(hourlyMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([h, d]) => `${h}時台: 投稿${d.count}件 / 平均ER ${(d.totalER / d.count).toFixed(2)}%`)
      .join(', ') || '（データなし）';

    // 曜日別分析
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    const weeklyMap = {};
    posts.forEach(p => {
      const w = dayjs(p.timestamp).day();
      if (!weeklyMap[w]) weeklyMap[w] = { count: 0, totalER: 0 };
      const er = p.views > 0
        ? (((p.like_count || 0) + (p.reply_count || 0) + (p.repost_count || 0) + (p.quote_count || 0)) / p.views * 100)
        : 0;
      weeklyMap[w].count++;
      weeklyMap[w].totalER += er;
    });
    const weeklyText = Object.entries(weeklyMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([w, d]) => `${weekDays[w]}曜: 投稿${d.count}件 / 平均ER ${(d.totalER / d.count).toFixed(2)}%`)
      .join(', ') || '（データなし）';

    return `# Threadsアカウント インサイト分析依頼

## 分析対象期間
${period.start} 〜 ${period.end}（${period.days}日間）

## アカウント基本情報
- ユーザー名: @${insightData?.username || '不明'}
- フォロワー数: ${(metrics.followersCount || 0).toLocaleString()}人
- 分析期間内の投稿数: ${posts.length}件
${options.clientName ? `- クライアント名: ${options.clientName}` : ''}

---

## インサイトデータ

### エンゲージメント集計
| 指標 | 今期 | 前期 | 増減率 |
|------|------|------|--------|
| 総リーチ（Views） | ${(metrics.totalViews || 0).toLocaleString()} | ${(prevMetrics.totalViews || 0).toLocaleString()} | ${calcDiff(metrics.totalViews, prevMetrics.totalViews)} |
| いいね数 | ${(metrics.totalLikes || 0).toLocaleString()} | ${(prevMetrics.totalLikes || 0).toLocaleString()} | ${calcDiff(metrics.totalLikes, prevMetrics.totalLikes)} |
| リプライ数 | ${(metrics.totalReplies || 0).toLocaleString()} | ${(prevMetrics.totalReplies || 0).toLocaleString()} | ${calcDiff(metrics.totalReplies, prevMetrics.totalReplies)} |
| リポスト数 | ${(metrics.totalReposts || 0).toLocaleString()} | ${(prevMetrics.totalReposts || 0).toLocaleString()} | ${calcDiff(metrics.totalReposts, prevMetrics.totalReposts)} |
| 引用数 | ${(metrics.totalQuotes || 0).toLocaleString()} | ${(prevMetrics.totalQuotes || 0).toLocaleString()} | ${calcDiff(metrics.totalQuotes, prevMetrics.totalQuotes)} |
| 平均エンゲージメント率 | ${(metrics.avgER || 0).toFixed(2)}% | ${(prevMetrics.avgER || 0).toFixed(2)}% | — |

### 上位10投稿（エンゲージメントスコア順）
${topPostsText}

### 時間帯別パフォーマンス
${hourlyText}

### 曜日別パフォーマンス
${weeklyText}

---

## 分析レポートを以下の構成で作成してください

### 1. エグゼクティブサマリー（3〜5文）
この期間のアカウント全体の動向を端的に総括してください。
前期比・注目すべき変化・最重要の発見を含めること。

### 2. パフォーマンス詳細分析

#### 2-1. エンゲージメント品質分析
- ER（エンゲージメント率）の水準評価（Threads業界平均と比較）
- いいね・リプライ・リポストのバランス（どのアクションが多いかで「関係性の深さ」を読む）
- バイラル係数の評価（リポスト＋引用がリーチ拡大に寄与しているか）

#### 2-2. コンテンツ勝ちパターン分析
- 上位投稿の共通点（投稿時間・文体・長さ・トーン）を抽出
- 下位投稿との差異を言語化
- 「このタイプの投稿が刺さる理由」の仮説を提示

#### 2-3. 最適投稿タイミング分析
- 高エンゲージメントが集中する時間帯・曜日
- 現在の投稿スケジュールとのギャップ
- 推奨スケジュール（具体的な曜日・時刻）

### 3. 改善アクションプラン（優先順位付き）

以下の形式で3〜5個のアクションを提示してください：

**アクション[番号]: [タイトル]**
- 課題: （何が問題か）
- 施策: （具体的に何をするか）
- 期待効果: （どの指標がどれくらい改善するか）
- 難易度: ★☆☆〜★★★
- 実施時期: 今週中 / 今月中 / 来月以降

### 4. 来期フォーカステーマ
次の30日間で集中すべき1〜2つのテーマを提言してください。
理由と期待する成果を明記すること。

### 5. クライアントへの一言メッセージ
このアカウントの「強み」と「伸びしろ」を、前向きかつ率直に伝えるメッセージ（3文以内）。`;
  }

  /**
   * Claude API 未設定時のフォールバックレポート
   */
  _generateFallbackReport(insightData, options) {
    const metrics = insightData?.engagementMetrics || insightData?.summary || {};
    const posts = insightData?.posts || [];
    const date = dayjs().format('YYYY年MM月DD日');

    return `# Threadsインサイト分析レポート
生成日時: ${date}
${options.clientName ? `クライアント: ${options.clientName}` : ''}

---

## エグゼクティブサマリー
分析期間中の投稿数は${posts.length}件、総リーチは${(metrics.totalViews || 0).toLocaleString()}回でした。
AI分析を利用するには ANTHROPIC_API_KEY を .env に設定してください。

## 基本指標
- 総Views: ${(metrics.totalViews || 0).toLocaleString()}
- 総いいね: ${(metrics.totalLikes || 0).toLocaleString()}
- 総リプライ: ${(metrics.totalReplies || 0).toLocaleString()}
- 総リポスト: ${(metrics.totalReposts || 0).toLocaleString()}
- 平均ER: ${(metrics.avgER || 0).toFixed(2)}%

## 注意
このレポートはフォールバック版です。Claude AIによる深い分析を得るには、
.env ファイルに ANTHROPIC_API_KEY=your_key_here を追加してください。
`;
  }

  /**
   * レポートをファイルに保存
   */
  async _saveReport(text, options) {
    await fs.mkdir(this.reportDir, { recursive: true });

    const date = dayjs().format('YYYY-MM-DD_HHmm');
    const prefix = options.clientName
      ? `ai_report_${options.clientName}_${date}`
      : `ai_report_${date}`;

    const mdPath = path.join(this.reportDir, `${prefix}.md`);
    await fs.writeFile(mdPath, text, 'utf-8');

    return { mdPath };
  }

  /**
   * レポートをコンソールに表示
   */
  _printReport(text) {
    console.log(chalk.bold.cyan('\n' + '═'.repeat(60)));
    console.log(chalk.bold.cyan('  AI コンサルタント分析レポート'));
    console.log(chalk.bold.cyan('═'.repeat(60)));
    console.log('');

    // セクションごとに色分けして表示
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('# ')) {
        console.log(chalk.bold.white(line));
      } else if (line.startsWith('## ')) {
        console.log(chalk.bold.yellow('\n' + line));
      } else if (line.startsWith('### ')) {
        console.log(chalk.bold.cyan(line));
      } else if (line.startsWith('#### ')) {
        console.log(chalk.bold(line));
      } else if (line.startsWith('**アクション')) {
        console.log(chalk.bold.green('\n' + line));
      } else if (line.startsWith('- 課題:') || line.startsWith('- 施策:') || line.startsWith('- 期待効果:')) {
        console.log(chalk.white('  ' + line));
      } else if (line.startsWith('- 難易度:')) {
        console.log(chalk.yellow('  ' + line));
      } else if (line.startsWith('- 実施時期:')) {
        console.log(chalk.magenta('  ' + line));
      } else {
        console.log(line);
      }
    }

    console.log('');
  }
}
