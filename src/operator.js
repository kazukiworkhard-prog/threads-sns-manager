/**
 * オペレーター (Operator) - 投稿スケジュール・実行・保守
 *
 * Threads APIを使った実際の投稿実行と、スケジュール管理を担当する
 */

import axios from 'axios';
import cron from 'node-cron';
import chalk from 'chalk';
import ora from 'ora';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import { config } from '../config/config.js';
import { LocalStorage } from './storage.js';
import { VelocityTracker } from './velocity.js';

export class Operator {
  constructor() {
    this.storage = new LocalStorage();
    this.velocityTracker = new VelocityTracker(this.storage);
    this.cronJobs = new Map();
    this.scheduledPosts = [];
    this.apiBase = config.threads.apiBase;
    this.accessToken = config.threads.accessToken;
    this.userId = config.threads.userId;
  }

  async initialize() {
    await this.storage.initialize();
    // 保存済みスケジュールを復元
    const saved = await this.storage.loadScheduledPosts();
    if (saved) this.scheduledPosts = saved;
  }

  setCredentials(accessToken, userId) {
    this.accessToken = accessToken;
    this.userId = userId;
  }

  /**
   * 投稿実行
   */
  async publishPost(content) {
    const spinner = ora('投稿を実行中...').start();
    try {
      // Step 1: メディアコンテナ作成
      const container = await this._createContainer(content);

      // Step 2: 投稿公開
      const published = await this._publishContainer(container.id);

      const publishedAt = dayjs().format();
      spinner.succeed(chalk.green(`投稿完了: ID ${published.id}`));

      // 投稿記録を保存
      await this.storage.savePostRecord({
        postId: published.id,
        content,
        publishedAt,
        status: 'published',
      });

      // エンゲージメント速度追跡を開始
      await this.velocityTracker.registerPost(published.id, content.text, publishedAt);

      return published;
    } catch (error) {
      spinner.fail(chalk.red(`投稿失敗: ${error.message}`));
      await this.storage.savePostRecord({
        content,
        attemptedAt: dayjs().format(),
        status: 'failed',
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * メディアコンテナ作成
   */
  async _createContainer(content) {
    try {
      const text = content.text + (content.hashtags?.length
        ? '\n\n' + content.hashtags.map(t => `#${t}`).join(' ')
        : '');

      const response = await axios.post(
        `${this.apiBase}/${this.userId}/threads`,
        {
          media_type: 'TEXT',
          text,
          access_token: this.accessToken,
        }
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('認証エラー: アクセストークンを確認してください');
      }
      throw new Error(`コンテナ作成失敗: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * コンテナ公開
   */
  async _publishContainer(containerId) {
    try {
      const response = await axios.post(
        `${this.apiBase}/${this.userId}/threads_publish`,
        {
          creation_id: containerId,
          access_token: this.accessToken,
        }
      );
      return response.data;
    } catch (error) {
      throw new Error(`公開失敗: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * 投稿スケジュール設定
   */
  async schedulePost(posts) {
    const scheduled = [];

    for (const post of posts) {
      const scheduledTime = dayjs(post.scheduledAt);
      const now = dayjs();

      if (scheduledTime.isBefore(now)) {
        console.log(chalk.yellow(`  ⚠️ スケジュール時刻が過去: ${post.scheduledAt} → 即時投稿`));
        // 過去の時刻の場合、即時投稿するか確認
        const result = { ...post, status: 'skipped_past_time' };
        scheduled.push(result);
        continue;
      }

      // Cron式生成
      const cronExpression = `${scheduledTime.minute()} ${scheduledTime.hour()} ${scheduledTime.date()} ${scheduledTime.month() + 1} *`;

      const job = cron.schedule(cronExpression, async () => {
        console.log(chalk.blue(`\n⏰ スケジュール投稿実行: ${post.scheduledAt}`));
        try {
          const published = await this.publishPost(post.content);
          const publishedAt = dayjs().format();
          this.scheduledPosts = this.scheduledPosts.map(p =>
            p.jobId === jobId ? { ...p, status: 'published', publishedAt, postId: published?.id } : p
          );
          await this.storage.saveScheduledPosts(this.scheduledPosts);
          console.log(chalk.green('✅ スケジュール投稿完了'));
        } catch (error) {
          const failedAt = dayjs().format();
          this.scheduledPosts = this.scheduledPosts.map(p =>
            p.jobId === jobId ? { ...p, status: 'failed', failedAt, error: error.message } : p
          );
          await this.storage.saveScheduledPosts(this.scheduledPosts);
          console.log(chalk.red(`❌ スケジュール投稿失敗: ${error.message}`));
        }
      }, {
        timezone: config.system.timezone,
      });

      const jobId = `post_${scheduledTime.unix()}`;
      this.cronJobs.set(jobId, job);

      const result = {
        ...post,
        jobId,
        cronExpression,
        status: 'scheduled',
      };

      scheduled.push(result);
      console.log(chalk.green(`  ✅ スケジュール設定: ${post.scheduledAt} - ${post.topic}`));
    }

    this.scheduledPosts.push(...scheduled);
    await this.storage.saveScheduledPosts(this.scheduledPosts);

    return scheduled;
  }

  /**
   * スケジュール一覧表示
   */
  async listScheduledPosts() {
    console.log(chalk.bold('\n📅 スケジュール済み投稿一覧'));

    if (this.scheduledPosts.length === 0) {
      console.log(chalk.gray('  スケジュール済みの投稿はありません'));
      return [];
    }

    this.scheduledPosts.forEach((post, i) => {
      const statusIcon = post.status === 'scheduled' ? '🟢' :
        post.status === 'published' ? '✅' :
        post.status === 'failed' ? '❌' : '⏸️';

      console.log(`  ${i + 1}. ${statusIcon} ${post.scheduledAt}`);
      console.log(`     カテゴリ: ${post.category}`);
      console.log(`     トピック: ${post.topic}`);
    });

    return this.scheduledPosts;
  }

  /**
   * スケジュールキャンセル
   */
  cancelScheduledPost(jobId) {
    const job = this.cronJobs.get(jobId);
    if (job) {
      job.stop();
      this.cronJobs.delete(jobId);
      this.scheduledPosts = this.scheduledPosts.map(p =>
        p.jobId === jobId ? { ...p, status: 'cancelled' } : p
      );
      console.log(chalk.green(`✅ スケジュールキャンセル完了: ${jobId}`));
      return true;
    }
    console.log(chalk.yellow(`⚠️ ジョブが見つかりません: ${jobId}`));
    return false;
  }

  /**
   * 定期実行ジョブのセットアップ
   */
  async setupCronJobs(commander) {
    console.log(chalk.bold('\n⚙️ 定期実行ジョブをセットアップ中...'));

    // 毎日 6:00 - 日次インサイト収集
    cron.schedule('0 6 * * *', async () => {
      console.log(chalk.blue('\n🔄 [自動] 日次インサイト収集開始'));
      await commander.runAnalysis();
    }, { timezone: config.system.timezone });

    // 毎週月曜 7:00 - 週次コンテンツ計画
    cron.schedule('0 7 * * 1', async () => {
      console.log(chalk.blue('\n🔄 [自動] 週次コンテンツ計画立案開始'));
      await commander.runContentPlanning();
    }, { timezone: config.system.timezone });

    // 毎月1日 9:00 - 月次レポート生成
    cron.schedule('0 9 1 * *', async () => {
      const lastMonth = dayjs().subtract(1, 'month');
      console.log(chalk.blue('\n🔄 [自動] 月次レポート生成開始'));
      await commander.runReport({
        startDate: lastMonth.startOf('month').format('YYYY-MM-DD'),
        endDate: lastMonth.endOf('month').format('YYYY-MM-DD'),
        type: 'monthly',
      });
    }, { timezone: config.system.timezone });

    // 毎時0分 - エンゲージメント速度ポーリング
    cron.schedule('0 * * * *', async () => {
      await this.velocityTracker.pollAll();
    }, { timezone: config.system.timezone });

    console.log(chalk.green('✅ 定期実行ジョブ設定完了'));
    console.log('  - 毎日 06:00: インサイト収集');
    console.log('  - 毎週月曜 07:00: コンテンツ計画');
    console.log('  - 毎月1日 09:00: 月次レポート');
    console.log('  - 毎時 00分: エンゲージメント速度ポーリング');
  }

  /**
   * 投稿履歴取得
   */
  async getPostHistory(limit = 20) {
    return this.storage.getPostHistory(limit);
  }
}
