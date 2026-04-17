/**
 * システム設定ファイル
 * Threads SNS 運用管理システム
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Threads API
  threads: {
    apiBase: 'https://graph.threads.net/v1.0',
    appId: process.env.THREADS_APP_ID,
    appSecret: process.env.THREADS_APP_SECRET,
    accessToken: process.env.THREADS_ACCESS_TOKEN,
    userId: process.env.THREADS_USER_ID,
    // インサイト取得期間のデフォルト
    defaultInsightDays: 28,
    // API レートリミット (リクエスト/時間)
    rateLimitPerHour: 200,
  },

  // Google Sheets
  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './config/google_service_account.json',
    // シート名定義
    sheetNames: {
      dailyInsights: '日次インサイト',
      postPerformance: '投稿パフォーマンス',
      contentCalendar: 'コンテンツカレンダー',
      topicBank: 'トピックバンク',
      monthlyReport: '月次レポート',
      audienceAnalysis: 'オーディエンス分析',
      timeAnalysis: '時間帯分析',
      velocityTracking: '速度追跡',
    },
  },

  // Claude AI
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-6',
    maxTokens: 4096,
  },

  // システム設定
  system: {
    timezone: process.env.TIMEZONE || 'Asia/Tokyo',
    language: process.env.DEFAULT_LANGUAGE || 'ja',
    reportDir: process.env.REPORT_SAVE_DIR || './reports',
    dataDir: process.env.DATA_SAVE_DIR || './data/insights',
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
  },

  // 投稿最適時間帯 (JST) - データ分析に基づき更新可能
  optimalPostingTimes: {
    weekday: ['07:00', '12:00', '18:00', '21:00'],
    weekend: ['09:00', '12:00', '15:00', '20:00'],
  },

  // コンテンツカテゴリ
  contentCategories: [
    { id: 'tips', label: 'ノウハウ・Tips', emoji: '💡', weight: 0.3 },
    { id: 'story', label: 'ストーリー・体験談', emoji: '📖', weight: 0.2 },
    { id: 'question', label: '質問・議論促進', emoji: '❓', weight: 0.15 },
    { id: 'trend', label: 'トレンド・時事', emoji: '📈', weight: 0.15 },
    { id: 'behind', label: 'Behind the scenes', emoji: '🎬', weight: 0.1 },
    { id: 'promotion', label: 'プロモーション', emoji: '📢', weight: 0.1 },
  ],

  // Slack 通知
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || null,
    enabled: !!process.env.SLACK_WEBHOOK_URL,
  },

  // インサイトKPI定義
  kpiTargets: {
    engagementRate: 3.0,      // エンゲージメント率 (%) 目標
    followerGrowthRate: 5.0,  // フォロワー成長率 (週次%) 目標
    reachRate: 10.0,          // リーチ率 (%) 目標
    avgLikesPerPost: 50,      // 投稿あたり平均いいね数 目標
    avgRepliesPerPost: 5,     // 投稿あたり平均返信数 目標
    viralViewsThreshold: 100000, // バイラル判定閾値（閲覧数）
  },
};

export default config;
