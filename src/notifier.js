/**
 * Notifier - Slack通知ユーティリティ
 *
 * SLACK_WEBHOOK_URL が未設定の場合はコンソール出力のみ（例外を投げない）
 */

import axios from 'axios';
import { config } from '../config/config.js';

const COLORS = { error: '#dc2626', warn: '#d97706', success: '#16a34a', info: '#2563eb' };

export class Notifier {
  constructor() {
    this.webhookUrl = config.slack?.webhookUrl || null;
  }

  async sendSlack(text, { level = 'info', fields = [], title = null } = {}) {
    const color = COLORS[level] || COLORS.info;
    const payload = {
      attachments: [{
        color,
        title: title || text,
        text: title ? text : undefined,
        fields: fields.map(f => ({ title: f.key, value: f.value, short: true })),
        footer: 'Threads SNS Manager',
        ts: Math.floor(Date.now() / 1000),
      }],
    };

    if (this.webhookUrl) {
      try {
        await axios.post(this.webhookUrl, payload);
      } catch (e) {
        console.error('[Notifier] Slack送信失敗:', e.message);
      }
    } else {
      const prefix = { error: '❌', warn: '⚠️', success: '✅', info: 'ℹ️' }[level] || 'ℹ️';
      console.log(`${prefix} [Notifier] ${title || text}`);
    }
  }

  async error(title, detail = '') {
    return this.sendSlack(detail, { level: 'error', title });
  }

  async warn(title, detail = '') {
    return this.sendSlack(detail, { level: 'warn', title });
  }

  async success(title, detail = '') {
    return this.sendSlack(detail, { level: 'success', title });
  }

  async postSuccess(postId, textPreview, username = '') {
    return this.sendSlack('', {
      level: 'success',
      title: `投稿完了 @${username}`,
      fields: [
        { key: '投稿ID', value: postId },
        { key: 'プレビュー', value: textPreview?.substring(0, 80) || '-' },
      ],
    });
  }

  async tokenExpiringSoon(username, daysLeft) {
    return this.sendSlack(
      `アクセストークンの有効期限まで残り ${daysLeft} 日です。ダッシュボードから再ログインして更新してください。`,
      { level: 'warn', title: `トークン期限警告: @${username}` },
    );
  }

  async tokenRefreshed(username) {
    return this.sendSlack('', {
      level: 'success',
      title: `トークン自動更新完了: @${username}`,
    });
  }

  async systemError(context, error) {
    return this.sendSlack(error?.message || String(error), {
      level: 'error',
      title: `システムエラー: ${context}`,
    });
  }
}
