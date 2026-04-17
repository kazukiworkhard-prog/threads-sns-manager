/**
 * LocalStorage - ローカルデータ永続化
 *
 * インサイトデータや投稿記録をローカルファイルシステムに保存する
 */

import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { config } from '../config/config.js';

export class LocalStorage {
  constructor(dataDir = null) {
    this.dataDir = dataDir || config.system.dataDir;
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'csv'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'posts'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'schedules'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'velocity'), { recursive: true });
  }

  /**
   * インサイトデータ保存
   */
  async saveInsights(insightData) {
    const date = dayjs(insightData.collectedAt).format('YYYY-MM-DD');
    const filepath = path.join(this.dataDir, `insights_${date}.json`);
    await fs.writeFile(filepath, JSON.stringify(insightData, null, 2), 'utf-8');
  }

  /**
   * CSV形式で保存
   */
  async saveAsCSV(insightData) {
    const date = dayjs(insightData.collectedAt).format('YYYY-MM-DD');
    const metrics = insightData.engagementMetrics;

    // 日次インサイト CSV
    const insightRow = [
      date,
      metrics.followersCount,
      metrics.totalReach,
      metrics.totalImpressions,
      metrics.totalLikes,
      metrics.totalReplies,
      metrics.engagementRate,
      metrics.reachRate,
      insightData.posts?.length || 0,
    ].join(',');

    const insightFile = path.join(this.dataDir, 'csv', '日次インサイト.csv');
    const insightHeader = '日付,フォロワー数,リーチ,インプレッション,いいね,返信,エンゲージメント率(%),リーチ率(%),投稿数';

    try {
      await fs.access(insightFile);
      await fs.appendFile(insightFile, '\n' + insightRow, 'utf-8');
    } catch {
      await fs.writeFile(insightFile, insightHeader + '\n' + insightRow, 'utf-8');
    }

    // 投稿パフォーマンス CSV
    if (insightData.posts?.length > 0) {
      const postFile = path.join(this.dataDir, 'csv', '投稿パフォーマンス.csv');
      const postHeader = '投稿ID,投稿日時,本文(冒頭100字),いいね,返信,リポスト,引用,ビュー,エンゲージメントスコア';

      const postRows = insightData.posts.map(p =>
        [
          p.id || '',
          dayjs(p.timestamp).format('YYYY-MM-DD HH:mm'),
          `"${(p.text || '').substring(0, 100).replace(/"/g, '""')}"`,
          p.like_count || 0,
          p.reply_count || 0,
          p.repost_count || 0,
          p.quote_count || 0,
          p.views || 0,
          (p.like_count || 0) * 2 + (p.reply_count || 0) * 3 + (p.repost_count || 0) * 4,
        ].join(',')
      );

      try {
        await fs.access(postFile);
        await fs.appendFile(postFile, '\n' + postRows.join('\n'), 'utf-8');
      } catch {
        await fs.writeFile(postFile, postHeader + '\n' + postRows.join('\n'), 'utf-8');
      }
    }
  }

  /**
   * Excelファイルとして保存（オフライン全データ）
   */
  async saveAsExcel(insightData) {
    const date = dayjs(insightData.collectedAt).format('YYYY-MM-DD');
    const workbook = XLSX.utils.book_new();

    // 日次インサイトシート
    const metrics = insightData.engagementMetrics;
    const insightData2 = [{
      '日付': date,
      'フォロワー数': metrics.followersCount,
      'リーチ': metrics.totalReach,
      'インプレッション': metrics.totalImpressions,
      'いいね': metrics.totalLikes,
      '返信': metrics.totalReplies,
      'エンゲージメント率(%)': metrics.engagementRate,
      'リーチ率(%)': metrics.reachRate,
      '投稿数': insightData.posts?.length || 0,
    }];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(insightData2), '日次インサイト');

    // 投稿パフォーマンスシート
    if (insightData.posts?.length > 0) {
      const postsData = insightData.posts.map(p => ({
        '投稿ID': p.id || '',
        '投稿日時': dayjs(p.timestamp).format('YYYY/MM/DD HH:mm'),
        '本文': p.text?.substring(0, 100) || '',
        'いいね': p.like_count || 0,
        '返信': p.reply_count || 0,
        'リポスト': p.repost_count || 0,
        '引用': p.quote_count || 0,
        'ビュー': p.views || 0,
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(postsData), '投稿パフォーマンス');
    }

    const filepath = path.join(this.dataDir, `insights_${date}.xlsx`);
    XLSX.writeFile(workbook, filepath);
    return filepath;
  }

  /**
   * 投稿記録保存
   */
  async savePostRecord(record) {
    const date = dayjs().format('YYYY-MM-DD');
    const filepath = path.join(this.dataDir, 'posts', `posts_${date}.json`);

    let records = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      records = JSON.parse(existing);
    } catch {
      // ファイルが存在しない場合は空配列から開始
    }

    records.push(record);
    await fs.writeFile(filepath, JSON.stringify(records, null, 2), 'utf-8');
  }

  /**
   * スケジュール済み投稿保存
   */
  async saveScheduledPosts(posts) {
    const filepath = path.join(this.dataDir, 'schedules', 'scheduled_posts.json');
    await fs.writeFile(filepath, JSON.stringify(posts, null, 2), 'utf-8');
  }

  /**
   * スケジュール済み投稿読み込み
   */
  async loadScheduledPosts() {
    const filepath = path.join(this.dataDir, 'schedules', 'scheduled_posts.json');
    try {
      const data = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * 速度追跡データ保存
   */
  async saveVelocityData(postId, data) {
    const filepath = path.join(this.dataDir, 'velocity', `${postId}.json`);
    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 速度追跡データ読み込み
   */
  async loadVelocityData(postId) {
    const filepath = path.join(this.dataDir, 'velocity', `${postId}.json`);
    try {
      return JSON.parse(await fs.readFile(filepath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 追跡中（未完了）の投稿ID一覧
   */
  async loadActiveVelocityList() {
    const dir = path.join(this.dataDir, 'velocity');
    try {
      const files = await fs.readdir(dir);
      const ids = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8'));
          if (!data.completed) ids.push(data.postId);
        } catch { /* skip */ }
      }
      return ids;
    } catch {
      return [];
    }
  }

  /**
   * 全速度追跡ファイルの投稿ID一覧（完了済み含む）
   */
  async loadAllVelocityIds() {
    const dir = path.join(this.dataDir, 'velocity');
    try {
      const files = await fs.readdir(dir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * 投稿履歴取得
   */
  async getPostHistory(limit = 20) {
    try {
      const files = await fs.readdir(path.join(this.dataDir, 'posts'));
      const sortedFiles = files.sort().reverse();

      const allPosts = [];
      for (const file of sortedFiles.slice(0, 7)) {
        const filepath = path.join(this.dataDir, 'posts', file);
        const data = await fs.readFile(filepath, 'utf-8');
        allPosts.push(...JSON.parse(data));
        if (allPosts.length >= limit) break;
      }

      return allPosts.slice(0, limit);
    } catch {
      return [];
    }
  }
}
