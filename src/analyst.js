/**
 * アナリスト (Analyst) - インサイト取得・スプレッドシート管理
 *
 * GASコードと同じ方式：投稿ごとにインサイトを取得して集計する
 * /{post_id}/insights?metric=views,likes,replies,reposts,quotes
 */

import axios from 'axios';
import chalk from 'chalk';
import ora from 'ora';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/config.js';
import { SheetsManager } from './spreadsheet.js';
import { LocalStorage } from './storage.js';
import { VelocityTracker } from './velocity.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('ja');

export class Analyst {
  constructor() {
    this.sheets = new SheetsManager();
    this.storage = new LocalStorage();
    this.velocityTracker = new VelocityTracker(this.storage);
    this.apiBase = config.threads.apiBase;
    this.accessToken = config.threads.accessToken;
    this.userId = config.threads.userId;
  }

  async initialize() {
    await this.sheets.initialize();
    await this.storage.initialize();
  }

  setCredentials(accessToken, userId) {
    this.accessToken = accessToken;
    this.userId = userId;
  }

  /**
   * APIリクエスト共通メソッド
   */
  async apiRequest(endpoint, params = {}) {
    try {
      const response = await axios.get(`${this.apiBase}${endpoint}`, {
        params: {
          access_token: this.accessToken,
          ...params,
        },
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('アクセストークンが無効です。トークンを更新してください。');
      }
      if (error.response?.status === 429) {
        throw new Error('APIレート制限に達しました。しばらく待ってから再試行してください。');
      }
      throw new Error(`API エラー: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * アカウント基本情報取得
   * GASコードの getUserId() と同じ方式
   */
  async getAccountInfo() {
    const spinner = ora('アカウント情報を取得中...').start();
    try {
      // 基本情報
      const data = await this.apiRequest('/me', {
        fields: 'id,username,name',
      });

      // フォロワー数はインサイトAPIから取得（total_value.value）
      try {
        const insData = await this.apiRequest(`/${this.userId}/threads_insights`, {
          metric: 'followers_count',
        });
        const followerItem = insData?.data?.[0];
        data.followers_count = followerItem?.total_value?.value ?? 0;
      } catch (e) {
        data.followers_count = 0;
      }

      spinner.succeed(`アカウント情報取得完了 (@${data.username}、フォロワー: ${data.followers_count.toLocaleString()}人)`);
      return data;
    } catch (error) {
      spinner.fail(`アカウント情報取得失敗: ${error.message}`);
      return this._getMockAccountInfo();
    }
  }

  /**
   * 投稿一覧取得（ページネーション対応・全件取得）
   * GASコードの fetchThreadsPage_() + ループと同じ方式
   * maxPosts=0 で全件取得
   */
  async getPosts(maxPosts = 0) {
    const fetchAll = maxPosts === 0;
    const label = fetchAll ? '全件' : `最大${maxPosts}件`;
    const spinner = ora(`投稿データを取得中 (${label})...`).start();

    try {
      const allPosts = [];
      let nextUrl = null;
      const PAGE_LIMIT = 100; // 1ページあたりの取得数（API最大値）

      do {
        let data;
        if (nextUrl) {
          // ページネーション: next URLをそのまま使用
          const resp = await axios.get(nextUrl);
          data = resp.data;
        } else {
          data = await this.apiRequest(`/${this.userId}/threads`, {
            fields: 'id,text,timestamp,permalink,media_type',
            limit: PAGE_LIMIT,
          });
        }

        const posts = data.data || [];
        allPosts.push(...posts);
        nextUrl = data.paging?.next || null;

        spinner.text = `投稿データを取得中... ${allPosts.length}件`;

        // 上限に達したら停止
        if (!fetchAll && allPosts.length >= maxPosts) break;

        // ページ間スリープ（レートリミット対策）
        if (nextUrl) await new Promise(r => setTimeout(r, 120));

      } while (nextUrl);

      spinner.succeed(`投稿データ取得完了 (${allPosts.length}件)`);
      return fetchAll ? allPosts : allPosts.slice(0, maxPosts);

    } catch (error) {
      spinner.fail(`投稿データ取得失敗: ${error.message}`);
      return this._getMockPosts();
    }
  }

  /**
   * 投稿ごとのインサイトをバッチ取得
   * GASコードの fetchInsightsBatch_() と完全同じ方式
   * レスポンス: { data: [{name: 'views', values: [{value: 123}]}, ...] }
   */
  async fetchInsightsBatch(postIds) {
    const BATCH_SIZE = 25;
    const results = {};

    for (let i = 0; i < postIds.length; i += BATCH_SIZE) {
      const batch = postIds.slice(i, i + BATCH_SIZE);

      // 並列リクエスト
      const requests = batch.map(id =>
        axios.get(`${this.apiBase}/${id}/insights`, {
          params: {
            metric: 'views,likes,replies,reposts,quotes',
            access_token: this.accessToken,
          },
        }).catch(() => null)
      );

      const responses = await Promise.all(requests);

      responses.forEach((resp, j) => {
        const id = batch[j];
        if (!resp || resp.status !== 200) {
          results[id] = null;
          return;
        }

        // GASコードと同じパース処理
        const insights = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
        const arr = resp.data?.data || [];
        arr.forEach(item => {
          const name = String(item.name || '').toLowerCase();
          const val = item.values?.[0]?.value ?? 0;
          if (name in insights) insights[name] = val;
        });
        results[id] = insights;
      });

      // バッチ間でスリープ（レートリミット対策）
      if (i + BATCH_SIZE < postIds.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return results;
  }

  /**
   * 日次インサイト収集（メイン処理）
   * GASの runRefreshLatestBatch() と同じ流れ
   */
  async collectDailyInsights(options = {}) {
    console.log(chalk.cyan('  アナリスト: インサイト収集開始'));

    // Step1: アカウント情報取得
    const accountInfo = await this.getAccountInfo();

    // Step2: 投稿一覧取得（0=全件取得）
    const posts = await this.getPosts(options.limit || 0);

    if (!posts.length) {
      console.log(chalk.yellow('  投稿データがありません'));
      return this._buildEmptyResult(accountInfo);
    }

    // Step3: 投稿ごとのインサイスをバッチ取得（GASと同じ方式）
    const spinner = ora(`インサイスを取得中 (${posts.length}件)...`).start();
    const postIds = posts.map(p => String(p.id));
    const insightsMap = await this.fetchInsightsBatch(postIds);
    spinner.succeed('インサイト取得完了');

    // Step4: 投稿データにインサイトをマージ
    const enrichedPosts = posts.map(post => {
      const ins = insightsMap[String(post.id)] || { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
      const totalEng = ins.likes + ins.replies + ins.reposts + ins.quotes;
      const er = ins.views > 0 ? parseFloat(((totalEng / ins.views) * 100).toFixed(2)) : 0;
      return {
        ...post,
        views: ins.views,
        like_count: ins.likes,
        reply_count: ins.replies,
        repost_count: ins.reposts,
        quote_count: ins.quotes,
        engagement: totalEng,
        engagementRate: er,
      };
    });

    // Step5: 集計
    const postPerformance = this._analyzePostPerformance(enrichedPosts);
    const engagementMetrics = this._calculateEngagementMetricsFromPosts(enrichedPosts, accountInfo);
    const topPosts = this._identifyTopPosts(enrichedPosts, 5);
    const trendTopics = this._extractTrendTopics(enrichedPosts);
    const timeAnalysis = this._analyzePostingTimePatterns(enrichedPosts);
    const viralPosts = this._analyzeViralPosts(enrichedPosts, config.kpiTargets.viralViewsThreshold || 100000);
    const bestTimeRecommendation = this._generateBestTimeRecommendation(timeAnalysis);
    const contentLengthAnalysis = this._analyzeContentLength(enrichedPosts);
    const viralityAnalysis = this._analyzeViralityScore(enrichedPosts);

    const result = {
      collectedAt: dayjs().tz(config.system.timezone).format(),
      account: accountInfo,
      posts: enrichedPosts,
      postPerformance,
      engagementMetrics,
      topPosts,
      trendTopics,
      timeAnalysis,
      viralPosts,
      bestTimeRecommendation,
      contentLengthAnalysis,
      viralityAnalysis,
      summary: this._generateInsightSummary(engagementMetrics, topPosts, bestTimeRecommendation),
    };

    // ローカル保存
    await this.storage.saveInsights(result);

    // フォロワー履歴に追記
    await this._appendFollowersHistory(accountInfo.followers_count, result.collectedAt);

    return result;
  }

  async _appendFollowersHistory(count, collectedAt) {
    try {
      const histFile = path.join('data', 'followers_history.json');
      let history = [];
      try { history = JSON.parse(await fs.readFile(histFile, 'utf-8')); } catch {}
      const date = dayjs(collectedAt).format('YYYY-MM-DD');
      if (!history.find(h => h.date === date)) {
        history.push({ date, followers: count });
        history.sort((a, b) => a.date.localeCompare(b.date));
        await fs.mkdir('data', { recursive: true });
        await fs.writeFile(histFile, JSON.stringify(history, null, 2), 'utf-8');
      }
    } catch {}
  }

  /**
   * 期間インサイト収集
   */
  async collectPeriodInsights(startDate, endDate) {
    const posts = await this.getPosts(100);
    const filtered = posts.filter(p => {
      const d = dayjs(p.timestamp);
      return d.isAfter(dayjs(startDate)) && d.isBefore(dayjs(endDate));
    });

    const ids = filtered.map(p => String(p.id));
    const insightsMap = await this.fetchInsightsBatch(ids);

    const enriched = filtered.map(post => {
      const ins = insightsMap[String(post.id)] || { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
      const totalEng = ins.likes + ins.replies + ins.reposts + ins.quotes;
      return {
        ...post,
        views: ins.views,
        like_count: ins.likes,
        reply_count: ins.replies,
        repost_count: ins.reposts,
        quote_count: ins.quotes,
        engagement: totalEng,
        engagementRate: ins.views > 0 ? parseFloat(((totalEng / ins.views) * 100).toFixed(2)) : 0,
      };
    });

    const engagementMetrics = this._calculateEngagementMetricsFromPosts(enriched);

    return {
      period: { startDate, endDate },
      posts: enriched,
      postPerformance: this._analyzePostPerformance(enriched),
      engagementMetrics,
    };
  }

  /**
   * トップ投稿分析（表示用）
   */
  async analyzeTopPosts(insightData) {
    console.log(chalk.cyan('\n  アナリスト: トップ投稿分析'));
    const topPosts = insightData.topPosts || [];

    console.log(chalk.bold('  --- トップ5投稿 ---'));
    topPosts.forEach((post, i) => {
      console.log(`  ${i + 1}. エンゲージメント率: ${post.engagementRate}%`);
      console.log(`     "${(post.text || '').substring(0, 50)}..."`);
      console.log(`     👁 ${post.views}  ❤️ ${post.like_count || 0}  💬 ${post.reply_count || 0}  🔁 ${post.repost_count || 0}`);
    });

    // 時間帯・曜日分析
    const timeAnalysis = insightData.timeAnalysis;
    if (timeAnalysis) {
      console.log(chalk.bold('\n  --- 時間帯別パフォーマンス（平均views上位5） ---'));
      [...timeAnalysis.hourly]
        .filter(h => h.postCount > 0)
        .sort((a, b) => b.avgViews - a.avgViews)
        .slice(0, 5)
        .forEach(h => {
          const bar = '█'.repeat(Math.min(20, Math.round(h.avgViews / 1000)));
          console.log(`  ${h.label}  ${bar} ${h.avgViews.toLocaleString()} views (${h.postCount}件投稿)`);
        });

      console.log(chalk.bold('\n  --- 曜日別パフォーマンス ---'));
      timeAnalysis.weekly
        .filter(d => d.postCount > 0)
        .sort((a, b) => b.avgViews - a.avgViews)
        .forEach(d => {
          console.log(`  ${d.label}曜日: 平均 ${d.avgViews.toLocaleString()} views / ER ${d.avgEngagementRate}% (${d.postCount}件)`);
        });
    }

    // バイラル投稿分析
    const viralPosts = insightData.viralPosts;
    if (viralPosts && viralPosts.count > 0) {
      console.log(chalk.bold(`\n  --- ${viralPosts.threshold.toLocaleString()}views超えのバイラル投稿: ${viralPosts.count}件 ---`));
      if (viralPosts.topHour) {
        console.log(`  最頻出投稿時間帯: ${String(viralPosts.topHour.hour).padStart(2, '0')}:00台 (${viralPosts.topHour.count}件)`);
      }
      if (viralPosts.topDay) {
        console.log(`  最頻出曜日: ${viralPosts.topDay.day}曜日 (${viralPosts.topDay.count}件)`);
      }
      console.log(`  バイラル投稿の平均テキスト長: ${viralPosts.avgTextLength}文字`);
    } else if (viralPosts) {
      console.log(chalk.gray(`\n  ${viralPosts.threshold.toLocaleString()}views超えの投稿はまだありません`));
    }

    // 最適投稿時間の推奨
    const rec = insightData.bestTimeRecommendation;
    if (rec && !rec.dataInsufficient) {
      console.log(chalk.bold.green('\n  --- 最適投稿時間の推奨 ---'));
      console.log(`  ${rec.summary}`);
    }

    // コンテンツ長分析
    const lengthAnalysis = insightData.contentLengthAnalysis;
    if (lengthAnalysis?.bestBucket) {
      console.log(chalk.bold('\n  --- テキスト長別パフォーマンス ---'));
      lengthAnalysis.buckets.filter(b => b.postCount > 0).forEach(b => {
        const mark = b.label === lengthAnalysis.bestBucket.label ? chalk.green(' ← 最高') : '';
        console.log(`  ${b.label}: 平均 ${b.avgViews.toLocaleString()} views${mark} (${b.postCount}件)`);
      });
    }

    // バイラル係数
    const virality = insightData.viralityAnalysis;
    if (virality) {
      console.log(chalk.bold('\n  --- 拡散力・会話誘発力 ---'));
      console.log(`  平均バイラル係数 (拡散率): ${virality.avgViralityScore}%`);
      console.log(`  平均返信率 (会話誘発率): ${virality.avgReplyRate}%`);
      if (virality.topViralPost) {
        console.log(`  最高拡散投稿: "${(virality.topViralPost.text || '').substring(0, 40)}..." (${virality.topViralPost.viralityScore}%)`);
      }
    }
  }

  /**
   * エンゲージメント速度サマリーを表示
   */
  async analyzeVelocity() {
    console.log(chalk.cyan('\n  アナリスト: エンゲージメント速度分析'));

    const summary = await this.velocityTracker.buildSummary();

    if (!summary) {
      console.log(chalk.gray('  速度追跡データがありません。'));
      console.log(chalk.gray('  投稿を実行すると自動的に追跡が開始されます。'));
      return null;
    }

    console.log(chalk.bold(`\n  --- 速度分析サマリー（${summary.analyzedPosts}件の投稿） ---`));

    if (summary.avgFirstHourViews !== null) {
      console.log(`  投稿後1時間の平均views: ${summary.avgFirstHourViews.toLocaleString()}`);
    }
    if (summary.avgHalfLifeHours !== null) {
      console.log(`  平均半減期: 投稿後 ${summary.avgHalfLifeHours} 時間`);
    }

    // ピーク時間帯の分布
    const peakDist = Object.entries(summary.peakHourDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (peakDist.length) {
      console.log(chalk.bold('\n  ピーク到達時間（投稿から何時間後に最も伸びたか）:'));
      peakDist.forEach(([hour, count]) => {
        console.log(`  投稿後 ${hour} 時間: ${count}件`);
      });
    }

    // 個別投稿の速度データ
    console.log(chalk.bold('\n  --- 投稿別 速度データ ---'));
    summary.posts.forEach(a => {
      const publishedStr = dayjs(a.publishedAt).tz(config.system.timezone).format('MM/DD HH:mm');
      console.log(`\n  [${publishedStr}] "${a.text.substring(0, 40)}..."`);
      console.log(`  累計views: ${a.totalViews.toLocaleString()} / 24時間views: ${a.views24h.toLocaleString()}`);
      if (a.firstHourViews !== null) console.log(`  初速（1時間）: +${a.firstHourViews.toLocaleString()} views`);
      if (a.peakHour !== null) console.log(`  ピーク: 投稿後 ${a.peakHour} 時間（+${a.peakDeltaViews.toLocaleString()} views/h）`);
      if (a.halfLifeHours !== null) console.log(`  半減期: ピーク後 ${a.halfLifeHours} 時間`);

      // マイルストーン
      const reached = Object.entries(a.milestones);
      if (reached.length) {
        console.log('  マイルストーン:');
        reached.forEach(([key, val]) => {
          console.log(`    ${key}: 投稿後 ${val.hoursAfterPost} 時間で到達`);
        });
      }
    });

    return summary;
  }

  /**
   * スプレッドシートへの保存
   */
  async saveToSpreadsheet(insightData) {
    const spinner = ora('スプレッドシートにデータを保存中...').start();
    try {
      await Promise.all([
        this.sheets.saveDailyInsights(insightData),
        this.sheets.savePostPerformance(insightData.posts, insightData.engagementMetrics),
        this.sheets.saveTimeAnalysis(insightData),
      ]);

      // 速度追跡データが存在する場合は保存
      const velocitySummary = await this.velocityTracker.buildSummary();
      if (velocitySummary?.posts?.length) {
        await this.sheets.saveVelocityAnalysis(velocitySummary.posts);
      }

      spinner.succeed(chalk.green('スプレッドシート保存完了'));
    } catch (error) {
      spinner.fail(chalk.yellow(`スプレッドシート保存失敗: ${error.message}`));
      await this.storage.saveAsCSV(insightData);
    }
  }

  // ========== プライベートメソッド ==========

  _analyzePostPerformance(posts) {
    if (!posts || posts.length === 0) return { avg: {}, total: {}, postCount: 0 };

    const totals = posts.reduce((acc, post) => ({
      likes: acc.likes + (post.like_count || 0),
      replies: acc.replies + (post.reply_count || 0),
      reposts: acc.reposts + (post.repost_count || 0),
      quotes: acc.quotes + (post.quote_count || 0),
      views: acc.views + (post.views || 0),
    }), { likes: 0, replies: 0, reposts: 0, quotes: 0, views: 0 });

    const count = posts.length;
    return {
      total: totals,
      avg: {
        likes: Math.round(totals.likes / count),
        replies: Math.round(totals.replies / count),
        reposts: Math.round(totals.reposts / count),
        quotes: Math.round(totals.quotes / count),
        views: Math.round(totals.views / count),
      },
      postCount: count,
    };
  }

  /**
   * 投稿データからエンゲージメント指標を集計（GAS方式）
   */
  _calculateEngagementMetricsFromPosts(posts, accountInfo) {
    if (!posts || posts.length === 0) {
      return {
        followersCount: accountInfo?.followers_count || 0,
        totalViews: 0, totalLikes: 0, totalReplies: 0,
        totalReposts: 0, totalQuotes: 0, totalEngagement: 0,
        avgEngagementRate: '0.00', avgViews: 0, postCount: 0,
      };
    }

    const totalViews    = posts.reduce((s, p) => s + (p.views || 0), 0);
    const totalLikes    = posts.reduce((s, p) => s + (p.like_count || 0), 0);
    const totalReplies  = posts.reduce((s, p) => s + (p.reply_count || 0), 0);
    const totalReposts  = posts.reduce((s, p) => s + (p.repost_count || 0), 0);
    const totalQuotes   = posts.reduce((s, p) => s + (p.quote_count || 0), 0);
    const totalEng      = totalLikes + totalReplies + totalReposts + totalQuotes;
    const erValues      = posts.map(p => p.engagementRate || 0);
    const avgEr         = erValues.length ? (erValues.reduce((s, v) => s + v, 0) / erValues.length).toFixed(2) : '0.00';

    return {
      followersCount: accountInfo?.followers_count || 0,
      totalViews,
      totalLikes,
      totalReplies,
      totalReposts,
      totalQuotes,
      totalEngagement: totalEng,
      avgEngagementRate: avgEr,
      avgViews: posts.length ? Math.round(totalViews / posts.length) : 0,
      postCount: posts.length,
      // 後方互換
      engagementRate: avgEr,
      totalReach: totalViews,
      totalImpressions: totalViews,
    };
  }

  _identifyTopPosts(posts, limit = 5) {
    return posts
      .map(post => ({
        ...post,
        engagementScore: (post.like_count || 0) * 2 +
          (post.reply_count || 0) * 3 +
          (post.repost_count || 0) * 4 +
          (post.quote_count || 0) * 4,
      }))
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, limit);
  }

  _extractTrendTopics(posts) {
    const keywords = {};
    const stopWords = new Set(['の', 'は', 'が', 'を', 'に', 'で', 'と', 'も', 'や', 'から', 'まで', 'として', 'など', 'a', 'the', 'is', 'are', 'i', 'you', 'we']);

    posts.forEach(post => {
      if (!post.text) return;
      const words = post.text.split(/[\s、。！？\n]+/);
      words.forEach(word => {
        if (word.length > 2 && !stopWords.has(word)) {
          keywords[word] = (keywords[word] || 0) + 1;
        }
      });
    });

    return Object.entries(keywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));
  }

  /**
   * 時間帯・曜日別パフォーマンス分析
   */
  _analyzePostingTimePatterns(posts) {
    const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

    // 時間帯別集計（0〜23時）
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      postCount: 0,
      totalViews: 0,
      totalEngagement: 0,
      avgViews: 0,
      avgEngagementRate: 0,
    }));

    // 曜日別集計（0=日〜6=土）
    const weekly = Array.from({ length: 7 }, (_, d) => ({
      day: d,
      label: DAY_NAMES[d],
      postCount: 0,
      totalViews: 0,
      totalEngagement: 0,
      avgViews: 0,
      avgEngagementRate: 0,
    }));

    // 時間帯×曜日のヒートマップ（7行×24列）
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));

    posts.forEach(post => {
      if (!post.timestamp) return;
      const dt = dayjs(post.timestamp).tz(config.system.timezone);
      const h = dt.hour();
      const d = dt.day();

      hourly[h].postCount++;
      hourly[h].totalViews += post.views || 0;
      hourly[h].totalEngagement += post.engagement || 0;

      weekly[d].postCount++;
      weekly[d].totalViews += post.views || 0;
      weekly[d].totalEngagement += post.engagement || 0;

      heatmap[d][h] += post.views || 0;
    });

    // 平均値を計算
    hourly.forEach(h => {
      if (h.postCount > 0) {
        h.avgViews = Math.round(h.totalViews / h.postCount);
        h.avgEngagementRate = parseFloat(
          (h.postCount > 0 ? (h.totalEngagement / h.totalViews) * 100 : 0).toFixed(2)
        );
      }
    });
    weekly.forEach(d => {
      if (d.postCount > 0) {
        d.avgViews = Math.round(d.totalViews / d.postCount);
        d.avgEngagementRate = parseFloat(
          (d.postCount > 0 ? (d.totalEngagement / d.totalViews) * 100 : 0).toFixed(2)
        );
      }
    });

    // ピーク時間帯（投稿数1件以上の中で最高avgViews）
    const peakHour = [...hourly]
      .filter(h => h.postCount > 0)
      .sort((a, b) => b.avgViews - a.avgViews)[0] || null;

    const peakDay = [...weekly]
      .filter(d => d.postCount > 0)
      .sort((a, b) => b.avgViews - a.avgViews)[0] || null;

    return { hourly, weekly, heatmap, peakHour, peakDay };
  }

  /**
   * 高バイラル投稿（閾値超え）の時間帯・特徴分析
   */
  _analyzeViralPosts(posts, threshold = 100000) {
    const viral = posts.filter(p => (p.views || 0) >= threshold);

    if (viral.length === 0) {
      return { threshold, count: 0, posts: [], hourDistribution: {}, dayDistribution: {}, avgTextLength: 0 };
    }

    const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
    const hourDist = {};
    const dayDist = {};
    let totalTextLen = 0;

    viral.forEach(post => {
      if (post.timestamp) {
        const dt = dayjs(post.timestamp).tz(config.system.timezone);
        const h = dt.hour();
        const d = dt.day();
        hourDist[h] = (hourDist[h] || 0) + 1;
        dayDist[DAY_NAMES[d]] = (dayDist[DAY_NAMES[d]] || 0) + 1;
      }
      totalTextLen += (post.text || '').length;
    });

    // 最頻出の時間帯・曜日
    const topHour = Object.entries(hourDist).sort((a, b) => b[1] - a[1])[0];
    const topDay = Object.entries(dayDist).sort((a, b) => b[1] - a[1])[0];

    return {
      threshold,
      count: viral.length,
      posts: viral.sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10),
      hourDistribution: hourDist,
      dayDistribution: dayDist,
      topHour: topHour ? { hour: parseInt(topHour[0]), count: topHour[1] } : null,
      topDay: topDay ? { day: topDay[0], count: topDay[1] } : null,
      avgTextLength: Math.round(totalTextLen / viral.length),
      avgViews: Math.round(viral.reduce((s, p) => s + (p.views || 0), 0) / viral.length),
      avgEngagementRate: parseFloat(
        (viral.reduce((s, p) => s + (p.engagementRate || 0), 0) / viral.length).toFixed(2)
      ),
    };
  }

  /**
   * 最適投稿時間の推奨生成
   */
  _generateBestTimeRecommendation(timeAnalysis) {
    const { hourly, weekly } = timeAnalysis;

    // 上位3時間帯（投稿実績あり）
    const topHours = [...hourly]
      .filter(h => h.postCount > 0)
      .sort((a, b) => b.avgViews - a.avgViews)
      .slice(0, 3);

    // 上位3曜日
    const topDays = [...weekly]
      .filter(d => d.postCount > 0)
      .sort((a, b) => b.avgViews - a.avgViews)
      .slice(0, 3);

    // データが不足している場合はconfig.jsのデフォルト値を返す
    if (topHours.length === 0) {
      return {
        dataInsufficient: true,
        message: '投稿データが不足しています。推奨時間はシステムデフォルト値を使用します。',
        recommendedTimes: config.optimalPostingTimes.weekday,
        topHours: [],
        topDays: [],
      };
    }

    return {
      dataInsufficient: false,
      topHours: topHours.map(h => ({
        label: h.label,
        avgViews: h.avgViews,
        avgEngagementRate: h.avgEngagementRate,
        postCount: h.postCount,
      })),
      topDays: topDays.map(d => ({
        label: d.label,
        avgViews: d.avgViews,
        avgEngagementRate: d.avgEngagementRate,
        postCount: d.postCount,
      })),
      recommendedTimes: topHours.map(h => h.label),
      summary: `最も閲覧数が多い時間帯: ${topHours[0]?.label || '不明'}（平均${(topHours[0]?.avgViews || 0).toLocaleString()}views）、`
        + `最も成果の高い曜日: ${topDays[0]?.label || '不明'}曜日`,
    };
  }

  /**
   * テキスト長 vs パフォーマンスの相関分析
   */
  _analyzeContentLength(posts) {
    const BUCKETS = [
      { label: '短文（〜50字）', min: 0, max: 50 },
      { label: '中文（51〜150字）', min: 51, max: 150 },
      { label: '長文（151〜300字）', min: 151, max: 300 },
      { label: '超長文（301字〜）', min: 301, max: Infinity },
    ];

    const buckets = BUCKETS.map(b => ({
      ...b,
      postCount: 0,
      totalViews: 0,
      totalEngagement: 0,
      avgViews: 0,
      avgEngagementRate: 0,
    }));

    posts.forEach(post => {
      const len = (post.text || '').length;
      const bucket = buckets.find(b => len >= b.min && len <= b.max);
      if (!bucket) return;
      bucket.postCount++;
      bucket.totalViews += post.views || 0;
      bucket.totalEngagement += post.engagement || 0;
    });

    buckets.forEach(b => {
      if (b.postCount > 0) {
        b.avgViews = Math.round(b.totalViews / b.postCount);
        b.avgEngagementRate = parseFloat(
          (b.totalViews > 0 ? (b.totalEngagement / b.totalViews) * 100 : 0).toFixed(2)
        );
      }
    });

    const bestBucket = [...buckets]
      .filter(b => b.postCount > 0)
      .sort((a, b) => b.avgViews - a.avgViews)[0] || null;

    return { buckets, bestBucket };
  }

  /**
   * バイラル係数・返信率分析（拡散力・会話誘発力）
   */
  _analyzeViralityScore(posts) {
    if (!posts.length) return { avgViralityScore: 0, avgReplyRate: 0, topViralPost: null };

    const scored = posts.map(post => {
      const views = post.views || 1;
      // バイラル係数 = (reposts + quotes) / views × 100
      const viralityScore = parseFloat(
        (((post.repost_count || 0) + (post.quote_count || 0)) / views * 100).toFixed(3)
      );
      // 返信率 = replies / views × 100
      const replyRate = parseFloat(
        ((post.reply_count || 0) / views * 100).toFixed(3)
      );
      return { ...post, viralityScore, replyRate };
    });

    const avgViralityScore = parseFloat(
      (scored.reduce((s, p) => s + p.viralityScore, 0) / scored.length).toFixed(3)
    );
    const avgReplyRate = parseFloat(
      (scored.reduce((s, p) => s + p.replyRate, 0) / scored.length).toFixed(3)
    );

    const topViralPost = [...scored].sort((a, b) => b.viralityScore - a.viralityScore)[0];
    const topConversationPost = [...scored].sort((a, b) => b.replyRate - a.replyRate)[0];

    return {
      avgViralityScore,
      avgReplyRate,
      topViralPost,
      topConversationPost,
      posts: scored.sort((a, b) => b.viralityScore - a.viralityScore).slice(0, 5),
    };
  }

  _generateInsightSummary(metrics, topPosts, bestTimeRecommendation) {
    const highlights = [
      `総閲覧数: ${(metrics.totalViews || 0).toLocaleString()}`,
      `平均エンゲージメント率: ${metrics.avgEngagementRate || 0}%`,
      `平均閲覧数: ${(metrics.avgViews || 0).toLocaleString()}`,
      `分析投稿数: ${metrics.postCount || 0}件`,
    ];

    if (bestTimeRecommendation && !bestTimeRecommendation.dataInsufficient) {
      highlights.push(`最適投稿時間帯: ${bestTimeRecommendation.recommendedTimes.join(' / ')}`);
      if (bestTimeRecommendation.topDays[0]) {
        highlights.push(`最高成果曜日: ${bestTimeRecommendation.topDays[0].label}曜日`);
      }
    }

    return {
      period: '直近投稿',
      highlights,
      topPostText: topPosts[0]?.text?.substring(0, 100) || 'データなし',
      kpiStatus: this._evaluateKPIs(metrics),
    };
  }

  _evaluateKPIs(metrics) {
    const targets = config.kpiTargets;
    return {
      engagementRate: {
        value: parseFloat(metrics.avgEngagementRate || 0),
        target: targets.engagementRate,
        status: parseFloat(metrics.avgEngagementRate || 0) >= targets.engagementRate ? '達成' : '未達',
      },
    };
  }

  _buildEmptyResult(accountInfo) {
    return {
      collectedAt: dayjs().tz(config.system.timezone).format(),
      account: accountInfo,
      posts: [],
      postPerformance: { avg: {}, total: {}, postCount: 0 },
      engagementMetrics: this._calculateEngagementMetricsFromPosts([], accountInfo),
      topPosts: [],
      trendTopics: [],
      summary: { period: '直近投稿', highlights: [], topPostText: 'データなし', kpiStatus: {} },
    };
  }

  // ========== モックデータ（API未接続時） ==========

  _getMockAccountInfo() {
    return { id: 'demo_user_id', username: 'demo_account', name: 'デモアカウント', _isMock: true };
  }

  _getMockPosts() {
    return [
      { id: 'mock_1', text: '副業で月10万稼ぐまでにやったこと全部書く', timestamp: dayjs().subtract(1, 'day').toISOString(), views: 7800, like_count: 312, reply_count: 78, repost_count: 134, quote_count: 42, engagement: 566, engagementRate: 7.26, _isMock: true },
      { id: 'mock_2', text: 'フリーランスになって2年。正直なところを話します', timestamp: dayjs().subtract(3, 'day').toISOString(), views: 4200, like_count: 201, reply_count: 45, repost_count: 67, quote_count: 19, engagement: 332, engagementRate: 7.90, _isMock: true },
      { id: 'mock_3', text: '読書メモの取り方を変えたら知識の定着率が劇的に上がった話', timestamp: dayjs().subtract(5, 'day').toISOString(), views: 3100, like_count: 156, reply_count: 23, repost_count: 48, quote_count: 11, engagement: 238, engagementRate: 7.68, _isMock: true },
    ];
  }
}
