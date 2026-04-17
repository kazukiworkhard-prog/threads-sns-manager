/**
 * SheetsManager - Google Sheets連携
 *
 * インサイトデータをGoogle Sheetsに保存・管理する
 * API未接続時はローカルCSVにフォールバック
 */

import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import dayjs from 'dayjs';
import { config } from '../config/config.js';

export class SheetsManager {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = config.sheets.spreadsheetId;
    this.connected = false;
  }

  /**
   * Google Sheets APIに接続
   */
  async initialize() {
    try {
      const keyFileContent = await fs.readFile(config.sheets.keyFile, 'utf-8');
      const credentials = JSON.parse(keyFileContent);

      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.connected = true;

      await this._ensureSheets();
      console.log(chalk.green('  ✅ Google Sheets 接続完了'));
    } catch (error) {
      this.connected = false;
      console.log(chalk.yellow(`  ⚠️ Google Sheets 未接続: ${error.message}`));
      console.log(chalk.gray('  → ローカルCSVを使用します'));
    }
  }

  /**
   * 必要なシートが存在することを確認・作成
   */
  async _ensureSheets() {
    if (!this.connected) return;

    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);
    const requiredSheets = Object.values(config.sheets.sheetNames);

    const sheetsToCreate = requiredSheets.filter(s => !existingSheets.includes(s));

    if (sheetsToCreate.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: sheetsToCreate.map(title => ({
            addSheet: { properties: { title } },
          })),
        },
      });
      console.log(chalk.green(`  ✅ シートを作成: ${sheetsToCreate.join(', ')}`));

      // 新規作成したシートのみヘッダーを設定（既存シートには追記しない）
      await this._initializeHeaders(sheetsToCreate);
    }
  }

  /**
   * 各シートのヘッダー初期化（新規作成シートのみ対象）
   */
  async _initializeHeaders(targetSheets = null) {
    const headers = {
      [config.sheets.sheetNames.dailyInsights]: [
        ['日付', 'フォロワー数', '総閲覧数', '平均閲覧数', '総いいね', '総返信', '総リポスト', '総引用', '平均ER(%)', '投稿数', '備考'],
      ],
      [config.sheets.sheetNames.postPerformance]: [
        ['投稿ID', '投稿日時', '本文(冒頭100字)', '閲覧数', 'いいね', '返信', 'リポスト', '引用', 'ER(%)', 'エンゲージメントスコア', 'パーマリンク'],
      ],
      [config.sheets.sheetNames.contentCalendar]: [
        ['週', '投稿予定日時', '曜日', 'カテゴリ', 'トピック', 'キーワード', 'ステータス', '投稿ID', 'エンゲージメント'],
      ],
      [config.sheets.sheetNames.topicBank]: [
        ['トピック', 'カテゴリ', '追加日', '使用日', 'エンゲージメント結果', '評価', 'メモ'],
      ],
      [config.sheets.sheetNames.monthlyReport]: [
        ['月', 'フォロワー数', 'フォロワー増減', 'エンゲージメント率(%)', 'リーチ', 'インプレッション', '投稿数', 'KPI達成'],
      ],
      [config.sheets.sheetNames.audienceAnalysis]: [
        ['分析日', '国TOP1', '国TOP2', '年齢TOP1', '年齢TOP2', '性別:男性(%)', '性別:女性(%)'],
      ],
      [config.sheets.sheetNames.timeAnalysis]: [
        ['記録日', '時間帯', '投稿数', '平均閲覧数', '平均ER(%)', '曜日', '曜日別平均閲覧数', 'ピーク時間帯', 'ピーク曜日', 'バイラル件数(10万+)', 'バイラル最頻時間', '最適文字数帯', '平均バイラル係数(%)', '平均返信率(%)'],
      ],
      [config.sheets.sheetNames.velocityTracking]: [
        ['投稿ID', '投稿日時', '本文(冒頭50字)', '初速(1h views)', 'ピーク時間(h後)', 'ピーク増加views', '半減期(h)', '24h views', '累計views', '1000views到達(h)', '1万views到達(h)', '10万views到達(h)', '記録完了'],
      ],
    };

    for (const [sheetName, headerRows] of Object.entries(headers)) {
      // targetSheetsが指定されている場合はその中のシートのみ初期化
      if (targetSheets && !targetSheets.includes(sheetName)) continue;
      await this._appendRows(sheetName, headerRows);
    }
  }

  /**
   * 日次インサイトを保存
   */
  async saveDailyInsights(insightData) {
    const m = insightData.engagementMetrics;
    const date = dayjs(insightData.collectedAt).format('YYYY-MM-DD');

    const row = [
      date,
      m.followersCount || 0,
      m.totalViews || 0,
      m.avgViews || 0,
      m.totalLikes || 0,
      m.totalReplies || 0,
      m.totalReposts || 0,
      m.totalQuotes || 0,
      m.avgEngagementRate || 0,
      m.postCount || insightData.posts?.length || 0,
      insightData.posts?.[0]?._isMock ? 'デモデータ' : '',
    ];

    await this._appendRows(config.sheets.sheetNames.dailyInsights, [row]);
    console.log(chalk.green(`  ✅ 日次インサイト保存: ${date}`));
  }

  /**
   * 投稿パフォーマンスを保存
   */
  async savePostPerformance(posts, metrics) {
    if (!posts || posts.length === 0) return;

    const rows = posts.map(post => [
      post.id || '',
      dayjs(post.timestamp).format('YYYY-MM-DD HH:mm'),
      post.text?.substring(0, 100) || '',
      post.views || 0,
      post.like_count || 0,
      post.reply_count || 0,
      post.repost_count || 0,
      post.quote_count || 0,
      post.engagementRate || 0,
      (post.like_count || 0) * 2 + (post.reply_count || 0) * 3 + (post.repost_count || 0) * 4,
      post.permalink || '',
    ]);

    await this._appendRows(config.sheets.sheetNames.postPerformance, rows);
  }

  /**
   * コンテンツカレンダーを保存
   */
  async saveContentCalendar(plan) {
    const rows = plan.posts.map(post => [
      plan.weekOf,
      post.scheduledAt,
      post.dayOfWeek,
      post.category,
      post.topic,
      post.keywords?.join(', ') || '',
      post.status,
      post.postId || '',
      '',
    ]);

    await this._appendRows(config.sheets.sheetNames.contentCalendar, rows);
  }

  /**
   * 時間帯分析データを保存
   */
  async saveTimeAnalysis(insightData) {
    const date = dayjs(insightData.collectedAt).format('YYYY-MM-DD');
    const ta = insightData.timeAnalysis;
    const vp = insightData.viralPosts;
    const cl = insightData.contentLengthAnalysis;
    const va = insightData.viralityAnalysis;
    const rec = insightData.bestTimeRecommendation;

    if (!ta) return;

    // 時間帯別行（投稿実績のある時間帯のみ）
    const hourRows = ta.hourly
      .filter(h => h.postCount > 0)
      .map(h => [
        date, h.label, h.postCount, h.avgViews, h.avgEngagementRate,
        '', '', '', '', '', '', '', '', '',
      ]);

    // 曜日別行
    const dayRows = ta.weekly
      .filter(d => d.postCount > 0)
      .map(d => [
        date, '', '', '', '',
        d.label + '曜日', d.avgViews, '', '', '', '', '', '', '',
      ]);

    // サマリー行（1行）
    const summaryRow = [
      date,
      rec?.recommendedTimes?.join(' / ') || '',
      '', '', '',
      ta.peakDay?.label ? ta.peakDay.label + '曜日' : '',
      ta.peakDay?.avgViews || '',
      ta.peakHour?.label || '',
      ta.peakDay?.label || '',
      vp?.count || 0,
      vp?.topHour ? `${String(vp.topHour.hour).padStart(2,'0')}:00` : '',
      cl?.bestBucket?.label || '',
      va?.avgViralityScore || 0,
      va?.avgReplyRate || 0,
    ];

    await this._appendRows(config.sheets.sheetNames.timeAnalysis, [summaryRow, ...hourRows, ...dayRows]);
    console.log(chalk.green(`  ✅ 時間帯分析保存: ${date}`));
  }

  /**
   * 速度追跡データをスプレッドシートに保存
   */
  async saveVelocityAnalysis(analyses) {
    if (!analyses || !analyses.length) return;

    const rows = analyses.map(a => {
      const m = a.milestones || {};
      return [
        a.postId || '',
        dayjs(a.publishedAt).format('YYYY-MM-DD HH:mm'),
        (a.text || '').substring(0, 50),
        a.firstHourViews ?? '',
        a.peakHour ?? '',
        a.peakDeltaViews ?? '',
        a.halfLifeHours ?? '',
        a.views24h || 0,
        a.totalViews || 0,
        m['1000_views']?.hoursAfterPost ?? '',
        m['1万_views']?.hoursAfterPost ?? '',
        m['10万_views']?.hoursAfterPost ?? '',
        a.completed ? '完了' : '追跡中',
      ];
    });

    await this._appendRows(config.sheets.sheetNames.velocityTracking, rows);
    console.log(chalk.green(`  ✅ 速度追跡データ保存: ${rows.length}件`));
  }

  /**
   * 月次レポートを保存
   */
  async saveMonthlyReport(reportData) {
    const metrics = reportData.metrics;
    const month = reportData.period.start.substring(0, 7);

    const row = [
      month,
      metrics.followersCount || 0,
      metrics.followerGrowth || 0,
      metrics.engagementRate || 0,
      metrics.totalReach || 0,
      metrics.totalImpressions || 0,
      reportData.posts?.length || 0,
      Object.values(reportData.kpiStatus).every(k => k.status === '達成') ? '全達成' : '一部未達',
    ];

    await this._appendRows(config.sheets.sheetNames.monthlyReport, [row]);
  }

  /**
   * 行追加（Google Sheets / ローカルCSVフォールバック）
   */
  async _appendRows(sheetName, rows) {
    if (this.connected && this.sheets) {
      try {
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: rows },
        });
        return;
      } catch (error) {
        console.log(chalk.yellow(`  Sheets API エラー: ${error.message}`));
      }
    }

    // フォールバック: ローカルCSV保存
    await this._saveToCSV(sheetName, rows);
  }

  /**
   * ローカルCSVに保存
   */
  async _saveToCSV(sheetName, rows) {
    const csvDir = path.join(config.system.dataDir, 'csv');
    await fs.mkdir(csvDir, { recursive: true });

    const filename = `${sheetName.replace(/[\/\\:*?"<>|]/g, '_')}.csv`;
    const filepath = path.join(csvDir, filename);

    const csvLines = rows.map(row =>
      row.map(cell => {
        const str = String(cell ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    );

    try {
      await fs.appendFile(filepath, csvLines.join('\n') + '\n', 'utf-8');
    } catch (error) {
      // ファイル書き込みエラーは静かに無視
    }
  }

  /**
   * スプレッドシートURLを取得
   */
  getSpreadsheetUrl() {
    if (!this.spreadsheetId) return null;
    return `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}`;
  }
}
