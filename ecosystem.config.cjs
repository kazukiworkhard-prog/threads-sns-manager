/**
 * PM2 Ecosystem Config
 *
 * 使い方:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save          # 再起動後も自動起動
 *   pm2 startup       # OS起動時に自動起動
 *   pm2 logs          # ログ確認
 *   pm2 status        # 稼働状況
 *   pm2 restart threads-dashboard
 */

module.exports = {
  apps: [
    {
      name: 'threads-dashboard',
      script: 'threads.js',
      args: 'dashboard',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
      // ログ設定
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      // クラッシュ時の通知（pm2-slack 等と連携する場合）
      // exp_backoff_restart_delay: 100,
    },
  ],
};
