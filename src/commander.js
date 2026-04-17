/**
 * 司令塔 (Commander) - 全体戦略・オーケストレーション
 *
 * 各エージェントを統括し、Threads SNS運用の全体戦略を管理する
 */

import chalk from 'chalk';
import ora from 'ora';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../config/config.js';
import { Analyst } from './analyst.js';
import { Strategist } from './strategist.js';
import { Creator } from './creator.js';
import { Operator } from './operator.js';
import { Reporter } from './reporter.js';
import { AIAnalyst } from './aiAnalyst.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('ja');

export class Commander {
  constructor() {
    this.analyst = new Analyst();
    this.strategist = new Strategist();
    this.creator = new Creator();
    this.operator = new Operator();
    this.reporter = new Reporter();
    this.aiAnalyst = new AIAnalyst();
    this.initialized = false;
  }

  /**
   * システム初期化
   */
  async initialize() {
    console.log(chalk.bold.cyan('\n╔════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║   Threads SNS 運用管理システム v1.0    ║'));
    console.log(chalk.bold.cyan('╚════════════════════════════════════════╝\n'));

    const spinner = ora('システムを初期化しています...').start();

    try {
      await this.analyst.initialize();
      await this.operator.initialize();
      this.initialized = true;
      spinner.succeed(chalk.green('システム初期化完了'));
      this.printStatus();
    } catch (error) {
      spinner.fail(chalk.red(`初期化エラー: ${error.message}`));
      throw error;
    }
  }

  /**
   * システム状態表示
   */
  printStatus() {
    const now = dayjs().tz(config.system.timezone);
    console.log(chalk.gray(`\n現在時刻: ${now.format('YYYY年MM月DD日 HH:mm')} (JST)`));
    console.log(chalk.bold('\n--- エージェント状態 ---'));
    console.log(`  ${chalk.green('●')} 司令塔       : ${chalk.green('稼働中')}`);
    console.log(`  ${chalk.green('●')} アナリスト   : ${chalk.green('待機中')}`);
    console.log(`  ${chalk.green('●')} ストラテジスト: ${chalk.green('待機中')}`);
    console.log(`  ${chalk.green('●')} クリエイター  : ${chalk.green('待機中')}`);
    console.log(`  ${chalk.green('●')} オペレーター  : ${chalk.green('待機中')}`);
    console.log(`  ${chalk.green('●')} レポーター   : ${chalk.green('待機中')}`);
    console.log('');
  }

  /**
   * フルサイクル実行 (日次自動運用)
   * analyze → plan → create → post → report
   */
  async runDailyCycle() {
    console.log(chalk.bold.yellow('\n🚀 日次運用サイクル開始'));
    const results = {};

    // Step 1: インサイト分析
    console.log(chalk.bold('\n[1/5] インサイト分析'));
    results.insights = await this.analyst.collectDailyInsights();
    await this.analyst.saveToSpreadsheet(results.insights);

    // Step 2: 戦略立案
    console.log(chalk.bold('\n[2/5] コンテンツ戦略立案'));
    results.strategy = await this.strategist.planWeeklyContent(results.insights);

    // Step 3: コンテンツ作成
    console.log(chalk.bold('\n[3/5] 投稿コンテンツ作成'));
    results.posts = await this.creator.createDailyPosts(results.strategy);

    // Step 4: 投稿実行
    console.log(chalk.bold('\n[4/5] 投稿スケジュール設定'));
    results.scheduled = await this.operator.schedulePost(results.posts);

    // Step 5: レポート生成
    console.log(chalk.bold('\n[5/5] レポート生成'));
    results.report = await this.reporter.generateDailyReport(results);

    console.log(chalk.bold.green('\n✅ 日次運用サイクル完了'));
    return results;
  }

  /**
   * インサイト分析のみ実行
   */
  async runAnalysis(options = {}) {
    console.log(chalk.bold.blue('\n📊 インサイト分析開始'));

    const insights = await this.analyst.collectDailyInsights(options);
    await this.analyst.saveToSpreadsheet(insights);

    if (options.detailed) {
      await this.analyst.analyzeTopPosts(insights);
      await this.analyst.analyzeAudience(insights);
    }

    return insights;
  }

  /**
   * コンテンツ計画のみ実行
   */
  async runContentPlanning(options = {}) {
    console.log(chalk.bold.blue('\n📝 コンテンツ計画開始'));

    const insights = await this.analyst.collectDailyInsights();
    const strategy = await this.strategist.planWeeklyContent(insights, options);
    await this.strategist.saveContentCalendar(strategy);

    return strategy;
  }

  /**
   * AIコンサルタントによるインサイト分析レポート生成
   */
  async runAIAnalysis(options = {}) {
    console.log(chalk.bold.blue('\n🤖 AI コンサルタント分析開始'));

    // 今期インサイト取得
    const insights = await this.analyst.collectDailyInsights(options);

    // 前期インサイト取得（比較用・失敗しても続行）
    let prevInsights = {};
    if (options.comparePrev !== false) {
      try {
        const prevOptions = {
          ...options,
          daysBack: (options.daysBack || 30) * 2,
          maxPosts: options.maxPosts,
        };
        prevInsights = await this.analyst.collectDailyInsights(prevOptions);
      } catch {
        console.log(chalk.gray('  前期データの取得をスキップしました'));
      }
    }

    const period = {
      start: dayjs().subtract(options.daysBack || 30, 'day').format('YYYY-MM-DD'),
      end: dayjs().format('YYYY-MM-DD'),
      days: options.daysBack || 30,
    };

    const report = await this.aiAnalyst.generateReport(insights, prevInsights, {
      ...options,
      period,
    });

    return report;
  }

  /**
   * レポート生成のみ実行
   */
  async runReport(options = {}) {
    console.log(chalk.bold.blue('\n📋 レポート生成開始'));

    const insights = await this.analyst.collectPeriodInsights(
      options.startDate,
      options.endDate
    );

    const report = await this.reporter.generateClientReport(insights, options);
    return report;
  }

  /**
   * スケジュール設定
   */
  async setupSchedule() {
    await this.operator.setupCronJobs(this);
  }

  /**
   * 戦略サマリー表示
   */
  printStrategySummary(strategy) {
    console.log(chalk.bold('\n--- 今週のコンテンツ計画 ---'));
    strategy.posts.forEach((post, i) => {
      console.log(`  ${i + 1}. [${post.scheduledAt}] ${post.category} - ${post.topic}`);
    });
  }
}
