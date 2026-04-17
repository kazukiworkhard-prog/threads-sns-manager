/**
 * ストラテジスト (Strategist) - トピック選定・コンテンツ計画
 *
 * インサイトデータを基に、最適なコンテンツ戦略とトピックを選定する
 */

import chalk from 'chalk';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import { config } from '../config/config.js';
import { SheetsManager } from './spreadsheet.js';

export class Strategist {
  constructor() {
    this.sheets = new SheetsManager();
  }

  /**
   * 週次コンテンツ計画立案
   */
  async planWeeklyContent(insightData, options = {}) {
    console.log(chalk.cyan('  ストラテジスト: 週次コンテンツ計画立案'));

    const weekStart = dayjs().startOf('week').add(1, 'day'); // 月曜日
    const postSchedule = this._generatePostSchedule(weekStart, options.postsPerWeek || 7);
    const topicIdeas = this._generateTopicIdeas(insightData);
    const assignedPosts = this._assignTopicsToSchedule(postSchedule, topicIdeas, insightData);

    const plan = {
      weekOf: weekStart.format('YYYY-MM-DD'),
      generatedAt: dayjs().format(),
      posts: assignedPosts,
      weeklyGoal: this._setWeeklyGoal(insightData),
      contentMix: this._calculateContentMix(assignedPosts),
      notes: this._generateStrategyNotes(insightData),
    };

    this._printPlan(plan);
    return plan;
  }

  /**
   * トピック候補生成
   */
  _generateTopicIdeas(insightData) {
    const trendTopics = insightData?.trendTopics || [];
    const topPosts = insightData?.topPosts || [];
    const engagementMetrics = insightData?.engagementMetrics || {};

    const ideas = [];

    // トレンドキーワードから派生
    trendTopics.slice(0, 5).forEach(({ word }) => {
      ideas.push({
        topic: `${word}について深掘り`,
        category: 'tips',
        source: 'trend',
        estimatedEngagement: 'high',
        keywords: [word],
      });
    });

    // トップ投稿の成功パターンから派生
    topPosts.slice(0, 3).forEach(post => {
      ideas.push({
        topic: `${post.text?.substring(0, 30)}... の続き`,
        category: 'story',
        source: 'top_post',
        estimatedEngagement: 'high',
        basePostId: post.id,
        keywords: [],
      });
    });

    // カテゴリバランスを考慮した追加アイデア
    const categoryTopics = {
      tips: [
        '今日から使える時間管理術5選',
        'AI活用で仕事が変わった体験談',
        '読んで変わった本3冊を正直レビュー',
        '失敗から学んだビジネスの教訓',
        'スマートフォン生産性活用術',
      ],
      question: [
        'みなさんの朝のルーティンを教えてください',
        '最近ハマっていることは何ですか？',
        '転職して良かった・後悔したこと',
        '副業始めて変わったこと、正直に聞かせてください',
      ],
      trend: [
        '2025年注目のテクノロジートレンド',
        '働き方改革の実態レポート',
        'SNSマーケティングの最新動向',
        'リモートワーク普及から3年の変化',
      ],
      story: [
        '起業して一番きつかった時期の話',
        '人生を変えた出会いと選択',
        '失敗談：後悔している判断3つ',
        '30代で気づいた、20代の自分へのアドバイス',
      ],
      behind: [
        '投稿作成の裏側を公開します',
        '1週間のリアルなスケジュール',
        'よく使うツール・アプリ一覧',
      ],
    };

    Object.entries(categoryTopics).forEach(([category, topics]) => {
      topics.forEach(topic => {
        ideas.push({
          topic,
          category,
          source: 'template',
          estimatedEngagement: 'medium',
          keywords: [],
        });
      });
    });

    // エンゲージメント高のカテゴリを優先
    return ideas.sort((a, b) => {
      const engagementScore = { high: 3, medium: 2, low: 1 };
      return engagementScore[b.estimatedEngagement] - engagementScore[a.estimatedEngagement];
    });
  }

  /**
   * 投稿スケジュール生成
   */
  _generatePostSchedule(weekStart, postsPerWeek) {
    const schedule = [];
    const isWeekend = (d) => d.day() === 0 || d.day() === 6;

    let day = weekStart.clone();
    let count = 0;

    while (count < postsPerWeek) {
      const times = isWeekend(day)
        ? config.optimalPostingTimes.weekend
        : config.optimalPostingTimes.weekday;

      const timeIndex = count % times.length;
      const [hour, minute] = times[timeIndex].split(':').map(Number);

      schedule.push({
        scheduledAt: day.hour(hour).minute(minute).format('YYYY-MM-DD HH:mm'),
        dayOfWeek: day.locale('ja').format('ddd'),
        timeSlot: times[timeIndex],
        isWeekend: isWeekend(day),
      });

      count++;
      if (count % times.length === 0) {
        day = day.add(1, 'day');
      }
    }

    return schedule;
  }

  /**
   * トピックをスケジュールに割り当て
   */
  _assignTopicsToSchedule(schedule, topicIdeas, insightData) {
    const categories = config.contentCategories;
    const usedCategories = {};
    const usedTopics = new Set();

    return schedule.map((slot, index) => {
      // カテゴリ選択（重み付きランダム + バランス考慮）
      const category = this._selectCategory(categories, usedCategories);
      usedCategories[category.id] = (usedCategories[category.id] || 0) + 1;

      // カテゴリに合うトピック選択
      const matchingTopics = topicIdeas.filter(
        t => t.category === category.id && !usedTopics.has(t.topic)
      );
      const selectedTopic = matchingTopics[0] || topicIdeas[index % topicIdeas.length];

      if (selectedTopic) usedTopics.add(selectedTopic.topic);

      return {
        ...slot,
        index: index + 1,
        category: category.label,
        categoryId: category.id,
        categoryEmoji: category.emoji,
        topic: selectedTopic?.topic || `${category.label}に関するコンテンツ`,
        keywords: selectedTopic?.keywords || [],
        estimatedEngagement: selectedTopic?.estimatedEngagement || 'medium',
        status: 'planned',
        postId: null,
      };
    });
  }

  /**
   * カテゴリ重み付き選択
   */
  _selectCategory(categories, usedCategories) {
    const totalUsed = Object.values(usedCategories).reduce((s, v) => s + v, 0);

    // 使用比率と目標重みの差を計算
    const scores = categories.map(cat => {
      const currentRatio = totalUsed > 0 ? (usedCategories[cat.id] || 0) / totalUsed : 0;
      const deficit = cat.weight - currentRatio;
      return { cat, score: Math.max(0, deficit) + 0.01 };
    });

    const totalScore = scores.reduce((s, { score }) => s + score, 0);
    let rand = Math.random() * totalScore;

    for (const { cat, score } of scores) {
      rand -= score;
      if (rand <= 0) return cat;
    }

    return categories[0];
  }

  /**
   * 週次目標設定
   */
  _setWeeklyGoal(insightData) {
    const current = insightData?.engagementMetrics || {};
    const targets = config.kpiTargets;

    return {
      engagementRate: `${targets.engagementRate}%以上`,
      newFollowers: `+${Math.ceil((current.followersCount || 1000) * 0.02)}人`,
      totalReach: `${Math.ceil((current.totalReach || 5000) * 1.1).toLocaleString()}以上`,
      postCount: 7,
    };
  }

  /**
   * コンテンツミックス計算
   */
  _calculateContentMix(posts) {
    const mix = {};
    posts.forEach(post => {
      mix[post.category] = (mix[post.category] || 0) + 1;
    });
    return mix;
  }

  /**
   * 戦略メモ生成
   */
  _generateStrategyNotes(insightData) {
    const notes = [];
    const metrics = insightData?.engagementMetrics || {};
    const topPosts = insightData?.topPosts || [];

    if (parseFloat(metrics.engagementRate) < config.kpiTargets.engagementRate) {
      notes.push('⚠️ エンゲージメント率が目標を下回っています。質問投稿・議論促進コンテンツを増やしましょう。');
    }

    if (topPosts.length > 0 && topPosts[0].repost_count > topPosts[0].like_count * 0.3) {
      notes.push('✅ リポストが多いコンテンツが好評です。保存・シェアされやすい実用的な情報を増やしましょう。');
    }

    notes.push('💡 投稿冒頭の3行で興味を引く「フック」を必ず入れてください。');
    notes.push('📊 ハッシュタグは3〜5個、関連性の高いものを選択してください。');

    return notes;
  }

  /**
   * コンテンツカレンダーをスプレッドシートに保存
   */
  async saveContentCalendar(plan) {
    try {
      await this.sheets.saveContentCalendar(plan);
      console.log(chalk.green('  ✅ コンテンツカレンダー保存完了'));
    } catch (error) {
      console.log(chalk.yellow(`  ⚠️ スプレッドシート保存失敗: ${error.message}`));
    }
  }

  _printPlan(plan) {
    console.log(chalk.bold(`\n  📅 ${plan.weekOf} 週のコンテンツ計画`));
    plan.posts.forEach(post => {
      console.log(`  ${post.scheduledAt} [${post.categoryEmoji}${post.category}] ${post.topic}`);
    });
    console.log(chalk.bold('\n  📌 戦略メモ:'));
    plan.notes.forEach(note => console.log(`  ${note}`));
  }
}
