/**
 * VelocityTracker - エンゲージメント速度追跡
 *
 * 投稿直後から定期的にインサイトを取得し、差分を記録することで
 * 「初速」「ピーク時間」「半減期」「マイルストーン到達時間」を測定する
 *
 * 追跡スケジュール:
 *   0〜24時間: 1時間ごと
 *   24〜72時間: 6時間ごと
 *   72時間〜7日: 1日1回
 *   7日経過: 追跡終了
 */

import axios from 'axios';
import chalk from 'chalk';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('ja');

// マイルストーン定義（views数）
const MILESTONES = [1000, 5000, 10000, 50000, 100000, 500000, 1000000];

// 追跡終了までの時間（時間単位）
const TRACKING_DURATION_HOURS = 7 * 24; // 7日間

export class VelocityTracker {
  constructor(storage) {
    this.storage = storage;
    this.apiBase = config.threads.apiBase;
    this.accessToken = config.threads.accessToken;
  }

  setCredentials(accessToken) {
    this.accessToken = accessToken;
  }

  /**
   * 新規投稿を追跡リストに登録
   */
  async registerPost(postId, text, publishedAt) {
    const existing = await this.storage.loadVelocityData(postId);
    if (existing) return; // 既に登録済み

    const trackingEndAt = dayjs(publishedAt)
      .add(TRACKING_DURATION_HOURS, 'hour')
      .toISOString();

    const data = {
      postId,
      text: (text || '').substring(0, 100),
      publishedAt,
      trackingEndAt,
      snapshots: [],
      milestones: {},
      completed: false,
    };

    await this.storage.saveVelocityData(postId, data);
    console.log(chalk.green(`  📊 速度追跡を開始: ${postId} (7日間)`));
  }

  /**
   * 追跡中の全投稿をポーリング（cronから毎時呼び出す）
   */
  async pollAll() {
    const tracking = await this.storage.loadActiveVelocityList();
    if (!tracking.length) return;

    const now = dayjs().tz(config.system.timezone);
    let polled = 0;

    for (const postId of tracking) {
      const data = await this.storage.loadVelocityData(postId);
      if (!data || data.completed) continue;

      // 追跡終了チェック
      if (now.isAfter(dayjs(data.trackingEndAt))) {
        data.completed = true;
        await this.storage.saveVelocityData(postId, data);
        console.log(chalk.gray(`  📊 追跡終了: ${postId}`));
        continue;
      }

      // ポーリング間隔チェック（次回計測タイミングか確認）
      if (!this._shouldPollNow(data, now)) continue;

      try {
        const snapshot = await this._fetchSnapshot(postId, data, now);
        data.snapshots.push(snapshot);
        this._updateMilestones(data, snapshot);
        await this.storage.saveVelocityData(postId, data);
        polled++;
      } catch {
        // 個別投稿のエラーは無視して次へ
      }
    }

    if (polled > 0) {
      console.log(chalk.gray(`  📊 速度データ更新: ${polled}件`));
    }
  }

  /**
   * 投稿の速度分析結果を生成
   */
  async analyzePost(postId) {
    const data = await this.storage.loadVelocityData(postId);
    if (!data || !data.snapshots.length) return null;

    return this._buildAnalysis(data);
  }

  /**
   * 全追跡済み投稿の集計サマリーを生成
   */
  async buildSummary() {
    const allIds = await this.storage.loadAllVelocityIds();
    const analyses = [];

    for (const postId of allIds) {
      const data = await this.storage.loadVelocityData(postId);
      if (!data || data.snapshots.length < 2) continue;
      analyses.push(this._buildAnalysis(data));
    }

    if (!analyses.length) return null;

    // 平均初速（投稿後1時間のviews）
    const firstHourData = analyses.filter(a => a.firstHourViews !== null);
    const avgFirstHourViews = firstHourData.length
      ? Math.round(firstHourData.reduce((s, a) => s + a.firstHourViews, 0) / firstHourData.length)
      : null;

    // ピーク時間帯の分布
    const peakHourDist = {};
    analyses.forEach(a => {
      if (a.peakHour !== null) {
        peakHourDist[a.peakHour] = (peakHourDist[a.peakHour] || 0) + 1;
      }
    });

    // 平均半減期
    const halfLifeData = analyses.filter(a => a.halfLifeHours !== null);
    const avgHalfLifeHours = halfLifeData.length
      ? parseFloat((halfLifeData.reduce((s, a) => s + a.halfLifeHours, 0) / halfLifeData.length).toFixed(1))
      : null;

    return {
      analyzedPosts: analyses.length,
      avgFirstHourViews,
      avgHalfLifeHours,
      peakHourDistribution: peakHourDist,
      posts: analyses,
    };
  }

  // ========== プライベートメソッド ==========

  /**
   * 今このタイミングでポーリングすべきか判定
   */
  _shouldPollNow(data, now) {
    const publishedAt = dayjs(data.publishedAt);
    const hoursElapsed = now.diff(publishedAt, 'hour', true);
    const lastSnapshot = data.snapshots[data.snapshots.length - 1];
    const lastPolledAt = lastSnapshot ? dayjs(lastSnapshot.recordedAt) : publishedAt;
    const hoursSinceLast = now.diff(lastPolledAt, 'hour', true);

    if (hoursElapsed <= 24) {
      // 0〜24時間: 1時間ごと
      return hoursSinceLast >= 0.9;
    } else if (hoursElapsed <= 72) {
      // 24〜72時間: 6時間ごと
      return hoursSinceLast >= 5.5;
    } else {
      // 72時間〜7日: 24時間ごと
      return hoursSinceLast >= 23;
    }
  }

  /**
   * APIからスナップショットを取得
   */
  async _fetchSnapshot(postId, data, now) {
    const publishedAt = dayjs(data.publishedAt);
    const hoursAfterPost = parseFloat(now.diff(publishedAt, 'hour', true).toFixed(1));

    const resp = await axios.get(`${this.apiBase}/${postId}/insights`, {
      params: {
        metric: 'views,likes,replies,reposts,quotes',
        access_token: this.accessToken,
      },
    });

    const metrics = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
    const arr = resp.data?.data || [];
    arr.forEach(item => {
      const name = String(item.name || '').toLowerCase();
      const val = item.values?.[0]?.value ?? 0;
      if (name in metrics) metrics[name] = val;
    });

    // 前回スナップショットとの差分
    const prev = data.snapshots[data.snapshots.length - 1];
    const delta = {
      views:   metrics.views   - (prev?.views   || 0),
      likes:   metrics.likes   - (prev?.likes   || 0),
      replies: metrics.replies - (prev?.replies || 0),
      reposts: metrics.reposts - (prev?.reposts || 0),
      quotes:  metrics.quotes  - (prev?.quotes  || 0),
    };

    return {
      recordedAt: now.toISOString(),
      hoursAfterPost,
      ...metrics,
      delta,
    };
  }

  /**
   * マイルストーン到達チェック・記録
   */
  _updateMilestones(data, snapshot) {
    const prevViews = snapshot.views - snapshot.delta.views;
    MILESTONES.forEach(milestone => {
      const key = `${milestone >= 10000 ? milestone / 10000 + '万' : milestone}_views`;
      if (!data.milestones[key] && snapshot.views >= milestone && prevViews < milestone) {
        data.milestones[key] = {
          reachedAt: snapshot.recordedAt,
          hoursAfterPost: snapshot.hoursAfterPost,
        };
      }
    });
  }

  /**
   * 速度分析オブジェクトを構築
   */
  _buildAnalysis(data) {
    const snapshots = data.snapshots;
    if (!snapshots.length) return null;

    // 投稿後1時間のviews（最初のスナップショットで代用）
    const snap1h = snapshots.find(s => s.hoursAfterPost <= 2) || snapshots[0];
    const firstHourViews = snap1h?.delta?.views ?? null;

    // ピーク時間（delta.viewsが最大のスナップショット）
    const peakSnap = [...snapshots].sort((a, b) => (b.delta?.views || 0) - (a.delta?.views || 0))[0];
    const peakHour = peakSnap ? Math.round(peakSnap.hoursAfterPost) : null;
    const peakDeltaViews = peakSnap?.delta?.views ?? 0;

    // 最終views
    const latestSnap = snapshots[snapshots.length - 1];
    const totalViews = latestSnap?.views || 0;

    // 半減期（ピーク後にdelta.viewsがpeakDeltaViews/2を下回った時点）
    let halfLifeHours = null;
    if (peakSnap && peakDeltaViews > 0) {
      const afterPeak = snapshots.filter(s => s.hoursAfterPost > peakSnap.hoursAfterPost);
      const halfSnap = afterPeak.find(s => (s.delta?.views || 0) <= peakDeltaViews / 2);
      if (halfSnap) {
        halfLifeHours = parseFloat((halfSnap.hoursAfterPost - peakSnap.hoursAfterPost).toFixed(1));
      }
    }

    // 24時間以内のviews合計
    const views24h = snapshots
      .filter(s => s.hoursAfterPost <= 24)
      .reduce((sum, s) => sum + (s.delta?.views || 0), 0);

    return {
      postId: data.postId,
      text: data.text,
      publishedAt: data.publishedAt,
      completed: data.completed,
      snapshotCount: snapshots.length,
      totalViews,
      views24h,
      firstHourViews,
      peakHour,
      peakDeltaViews,
      halfLifeHours,
      milestones: data.milestones,
    };
  }
}
