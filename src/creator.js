/**
 * クリエイター (Creator) - 投稿コンテンツ作成
 *
 * Claude AI APIを使って、戦略に基づいた高品質な投稿文案を生成する
 */

import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../config/config.js';

export class Creator {
  constructor() {
    if (config.claude.apiKey) {
      this.client = new Anthropic({ apiKey: config.claude.apiKey });
    }
  }

  /**
   * 日次投稿コンテンツ作成
   */
  async createDailyPosts(strategy) {
    console.log(chalk.cyan('  クリエイター: コンテンツ作成開始'));

    const todayPosts = strategy.posts.filter(post => {
      return post.scheduledAt.startsWith(new Date().toISOString().split('T')[0]);
    });

    const posts = [];
    for (const postPlan of todayPosts) {
      const content = await this.generatePost(postPlan);
      posts.push({ ...postPlan, content, variants: [] });
    }

    return posts;
  }

  /**
   * 単投稿生成
   */
  async generatePost(postPlan, options = {}) {
    const spinner = ora(`「${postPlan.topic}」の投稿を生成中...`).start();

    try {
      let content;
      if (this.client) {
        content = await this._generateWithClaude(postPlan, options);
      } else {
        content = this._generateTemplate(postPlan, options);
      }

      spinner.succeed(`投稿生成完了: ${content.text.substring(0, 30)}...`);
      return content;
    } catch (error) {
      spinner.warn(`AI生成失敗、テンプレートを使用: ${error.message}`);
      return this._generateTemplate(postPlan, options);
    }
  }

  /**
   * Claude AI を使った投稿生成
   */
  async _generateWithClaude(postPlan, options = {}) {
    const systemPrompt = `あなたはThreadsの投稿コンテンツ作成の専門家です。
エンゲージメントの高い投稿を作成してください。

【投稿ルール】
- 500文字以内（Threadsの推奨長）
- 冒頭3行で強力なフックを作る
- 読者が「保存・シェアしたい」と思う実用的な内容
- 自然な話し言葉、親しみやすいトーン
- 過度な絵文字は避ける（1投稿3〜5個まで）
- ハッシュタグは末尾に3〜5個
- 行動を促すCTA（コメント誘導など）を入れる

【カテゴリ別スタイル】
- ノウハウ・Tips: 番号付きリスト、具体的な数字を使う
- ストーリー: 起承転結、感情移入しやすい描写
- 質問: オープンな問いかけ、答えやすい設計
- トレンド: タイムリーな情報、独自の見解を加える`;

    const userPrompt = `以下の条件で投稿文を作成してください：

トピック: ${postPlan.topic}
カテゴリ: ${postPlan.category}
キーワード: ${postPlan.keywords?.join(', ') || 'なし'}
推定エンゲージメント: ${postPlan.estimatedEngagement}
${options.tone ? `トーン: ${options.tone}` : ''}
${options.targetAudience ? `ターゲット: ${options.targetAudience}` : ''}

JSON形式で返してください：
{
  "text": "投稿本文",
  "hashtags": ["タグ1", "タグ2"],
  "hook": "冒頭フック（30文字以内）",
  "cta": "CTAの内容",
  "estimatedReadTime": 秒数
}`;

    const response = await this.client.messages.create({
      model: config.claude.model,
      max_tokens: config.claude.maxTokens,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const responseText = response.content[0].text;

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          text: parsed.text,
          hashtags: parsed.hashtags || [],
          hook: parsed.hook,
          cta: parsed.cta,
          estimatedReadTime: parsed.estimatedReadTime || 30,
          generatedBy: 'claude',
          model: config.claude.model,
        };
      }
    } catch (e) {
      // JSON解析失敗時はテキストそのままを使用
    }

    return {
      text: responseText,
      hashtags: [],
      generatedBy: 'claude',
      model: config.claude.model,
    };
  }

  /**
   * テンプレートベースの投稿生成（AI未使用時のフォールバック）
   */
  _generateTemplate(postPlan, options = {}) {
    const templates = {
      tips: this._tipsTemplate(postPlan),
      story: this._storyTemplate(postPlan),
      question: this._questionTemplate(postPlan),
      trend: this._trendTemplate(postPlan),
      behind: this._behindTemplate(postPlan),
      promotion: this._promotionTemplate(postPlan),
    };

    const template = templates[postPlan.categoryId] || templates.tips;

    return {
      ...template,
      generatedBy: 'template',
      topic: postPlan.topic,
    };
  }

  _tipsTemplate(postPlan) {
    return {
      text: `【${postPlan.topic}】

知っておくと得する3つのポイント：

1️⃣ まず基本から始める
→ 小さな一歩が大きな変化につながります

2️⃣ 継続が最大の武器
→ 毎日少しずつ積み上げることで差がつく

3️⃣ 結果を振り返る習慣
→ PDCAサイクルで改善し続ける

あなたはどれが一番難しいと感じますか？
コメントで教えてください👇

#生産性 #自己改善 #習慣化`,
      hashtags: ['生産性', '自己改善', '習慣化'],
      hook: `【${postPlan.topic}】知っておくと得する3つのポイント`,
      cta: 'コメントで教えてください',
      estimatedReadTime: 25,
    };
  }

  _storyTemplate(postPlan) {
    return {
      text: `${postPlan.topic}

正直に話します。

最初は全くうまくいきませんでした。
何度も挫折しかけて、諦めようとも思いました。

でも、あるきっかけで考え方が変わって——

今では毎日が楽しくて仕方がありません。

詳しい話、気になる方はコメントください。
同じ悩みを持つ方に届けたくて書きました。

#体験談 #気づき #マインドセット`,
      hashtags: ['体験談', '気づき', 'マインドセット'],
      hook: `${postPlan.topic}。正直に話します。`,
      cta: '気になる方はコメントください',
      estimatedReadTime: 20,
    };
  }

  _questionTemplate(postPlan) {
    return {
      text: `質問させてください🙋

${postPlan.topic}

□ 毎日やっている
□ たまにやっている
□ やりたいけどできていない
□ 必要を感じていない

コメントで答えてもらえると嬉しいです！
皆さんの答えを集計して後日シェアします📊

#アンケート #みんなの意見 #教えてください`,
      hashtags: ['アンケート', 'みんなの意見', '教えてください'],
      hook: `質問させてください🙋 ${postPlan.topic}`,
      cta: 'コメントで答えてください',
      estimatedReadTime: 15,
    };
  }

  _trendTemplate(postPlan) {
    return {
      text: `【速報】${postPlan.topic}

これ、かなり重要なトレンドです。

▶ 何が変わるか
現状のやり方が通用しなくなる可能性があります

▶ 私の見解
早めに対応した人が圧倒的に有利になる変化だと思います

▶ 今すぐできること
まずは情報収集から。このトレンドをどう見ますか？

コメント欄でディスカッションしましょう！

#トレンド #最新情報 #考察`,
      hashtags: ['トレンド', '最新情報', '考察'],
      hook: `【速報】${postPlan.topic}、かなり重要なトレンドです`,
      cta: 'コメント欄でディスカッションしましょう',
      estimatedReadTime: 20,
    };
  }

  _behindTemplate(postPlan) {
    return {
      text: `${postPlan.topic}

舞台裏を少しだけ公開します🎬

実はこんな流れで作っています：

準備 → 下書き → 推敲 → 投稿 → 分析

一番時間をかけているのは「推敲」のステップ。
伝わる言葉を選ぶのが一番難しくて、一番大切。

あなたが気になるのはどの部分ですか？

#裏側 #コンテンツ制作 #SNS運用`,
      hashtags: ['裏側', 'コンテンツ制作', 'SNS運用'],
      hook: `${postPlan.topic}、舞台裏を少しだけ公開します🎬`,
      cta: 'あなたが気になるのはどの部分ですか？',
      estimatedReadTime: 20,
    };
  }

  _promotionTemplate(postPlan) {
    return {
      text: `お知らせです📢

${postPlan.topic}

詳細はプロフィールのリンクから確認できます。

質問があればコメントかDMでお気軽に！

#お知らせ #新着情報`,
      hashtags: ['お知らせ', '新着情報'],
      hook: `お知らせです📢 ${postPlan.topic}`,
      cta: '質問はコメントかDMで',
      estimatedReadTime: 10,
    };
  }

  /**
   * A/Bテスト用バリアント生成
   */
  async generateVariants(postPlan, count = 2) {
    const variants = [];
    for (let i = 0; i < count; i++) {
      const options = {
        tone: i === 0 ? 'formal' : 'casual',
        variant: i + 1,
      };
      const content = await this.generatePost(postPlan, options);
      variants.push({ ...content, variantLabel: `バリアント${String.fromCharCode(65 + i)}` });
    }
    return variants;
  }
}
