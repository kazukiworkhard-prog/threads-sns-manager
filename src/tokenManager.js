/**
 * TokenManager - アクセストークン自動更新・期限監視
 *
 * Threads long-lived token は発行から60日で期限切れ。
 * 7日前に警告 → 自動更新試行。期限切れ後は再認証が必要。
 *
 * 更新API: GET https://graph.threads.net/oauth/refresh_access_token
 *   ?grant_type=th_refresh_token&access_token={token}
 */

import axios from 'axios';
import dayjs from 'dayjs';

const REFRESH_ENDPOINT = 'https://graph.threads.net/oauth/refresh_access_token';
const TOKEN_LIFETIME_DAYS = 60;
const WARN_DAYS_BEFORE = 7;

export class TokenManager {
  constructor(userStore, notifier) {
    this.userStore = userStore;
    this.notifier = notifier;
  }

  /**
   * 全ユーザーのトークンを一括チェック（毎日 cron から呼び出す）
   */
  async checkAllTokens() {
    const users = this.userStore.getAllUsers();
    for (const user of users) {
      if (!user.accessToken) continue;
      try {
        await this.renewIfNearExpiry(user.userId, user.accessToken, user.username);
      } catch (e) {
        await this.notifier?.systemError(`tokenCheck:${user.username}`, e);
      }
    }
  }

  /**
   * トークンが期限 WARN_DAYS_BEFORE 日以内なら更新を試みる
   */
  async renewIfNearExpiry(userId, accessToken, username = userId) {
    const daysLeft = this._getDaysLeft(userId);

    if (daysLeft === null) {
      // tokenUpdatedAt が未記録 → 今の時刻で初期化して保存
      await this.userStore.upsertUser(userId, {
        tokenUpdatedAt: new Date().toISOString(),
        tokenExpiresIn: TOKEN_LIFETIME_DAYS * 86400,
      });
      return;
    }

    if (daysLeft <= 0) {
      // 期限切れ → 通知のみ（更新不可）
      await this.notifier?.error(
        `トークン期限切れ: @${username}`,
        'ダッシュボードから再ログインして新しいトークンを取得してください。',
      );
      return;
    }

    if (daysLeft <= WARN_DAYS_BEFORE) {
      await this.notifier?.tokenExpiringSoon(username, daysLeft);
      // 自動更新を試みる
      const refreshed = await this.refreshToken(accessToken);
      if (refreshed) {
        await this.saveRefreshedToken(userId, refreshed.access_token, refreshed.expires_in);
        await this.notifier?.tokenRefreshed(username);
      }
    }
  }

  /**
   * Threads API でトークンを更新する
   * @returns {{ access_token, expires_in }} or null
   */
  async refreshToken(accessToken) {
    try {
      const res = await axios.get(REFRESH_ENDPOINT, {
        params: { grant_type: 'th_refresh_token', access_token: accessToken },
      });
      return res.data; // { access_token, token_type, expires_in }
    } catch (e) {
      // 24時間未満の新しいトークンは更新不可（APIが拒否する）
      console.warn('[TokenManager] トークン更新失敗:', e.response?.data?.error?.message || e.message);
      return null;
    }
  }

  /**
   * 更新済みトークンをストアに保存
   */
  async saveRefreshedToken(userId, newAccessToken, expiresIn) {
    await this.userStore.upsertUser(userId, {
      accessToken: newAccessToken,
      tokenUpdatedAt: new Date().toISOString(),
      tokenExpiresIn: expiresIn || TOKEN_LIFETIME_DAYS * 86400,
    });
  }

  /**
   * トークンの残り有効日数を計算
   * @returns {number|null} null = tokenUpdatedAt 未記録
   */
  _getDaysLeft(userId) {
    const user = this.userStore.getUser(userId);
    if (!user?.tokenUpdatedAt) return null;
    const updatedAt = dayjs(user.tokenUpdatedAt);
    const expiresIn = user.tokenExpiresIn || TOKEN_LIFETIME_DAYS * 86400;
    const expiresAt = updatedAt.add(expiresIn, 'second');
    return expiresAt.diff(dayjs(), 'day');
  }

  /**
   * トークンの有効期限情報を返す（ダッシュボード表示用）
   */
  getTokenStatus(userId) {
    const daysLeft = this._getDaysLeft(userId);
    if (daysLeft === null) return { status: 'unknown', daysLeft: null };
    if (daysLeft <= 0) return { status: 'expired', daysLeft: 0 };
    if (daysLeft <= WARN_DAYS_BEFORE) return { status: 'expiring', daysLeft };
    return { status: 'ok', daysLeft };
  }
}
