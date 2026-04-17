/**
 * Secretary（秘書） - AIアシスタント
 *
 * ユーザーからの指示を受け取り、適切な部署（エージェント）に
 * タスクを割り振り、結果をまとめて返す
 */

import Anthropic from '@anthropic-ai/sdk';
import dayjs from 'dayjs';
import 'dayjs/locale/ja.js';
import { config } from '../config/config.js';

dayjs.locale('ja');

const SYSTEM_PROMPT = `あなたはThreads SNS運用管理会社の優秀な秘書AIです。
オーナー（島村一輝さん）の右腕として、以下の業務をサポートします。

【あなたが担当できる業務】
- Threadsの運用状況の確認・まとめ
- クライアントへの提案書・レポートコメントの下書き
- 投稿コンテンツのアイデア出し・改善提案
- スケジュール・タスクの整理
- 月次レポートの解説文作成
- 新規クライアント向けの営業トーク・提案内容の作成
- データをもとにした改善提案

【あなたが知っていること】
- このシステムはThreads Graph APIと連携しており、投稿・インサイト・フォロワーデータが取得できる
- Claude APIを使ってAI文案生成ができる
- 予約投稿・スケジュール管理ができる
- レポートをPDFで出力できる

【返答のスタイル】
- 簡潔・明確・実用的に返す
- 必要に応じて箇条書きや表を使う
- 「〜しましょうか？」「〜はいかがでしょう？」など提案型で
- 日本語で返答する
- 今日の日付: ${dayjs().format('YYYY年MM月DD日（ddd）')}`;

export class Secretary {
  constructor() {
    this.client = config.claude.apiKey
      ? new Anthropic({ apiKey: config.claude.apiKey })
      : null;
    this.conversations = new Map(); // セッションごとの会話履歴
  }

  /**
   * メッセージを送信してストリーミングレスポンスを返す
   */
  async chat(sessionId, userMessage, context = {}) {
    if (!this.client) {
      throw new Error('Claude APIキーが設定されていません');
    }

    // 会話履歴を取得（なければ新規作成）
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, []);
    }
    const history = this.conversations.get(sessionId);

    // コンテキスト情報をメッセージに付加
    let fullMessage = userMessage;
    if (context.insightsSummary) {
      fullMessage = `【現在のインサイト情報】\n${context.insightsSummary}\n\n【ユーザーの指示】\n${userMessage}`;
    }

    history.push({ role: 'user', content: fullMessage });

    // 履歴が長くなりすぎたら古いものを削除（直近20件を保持）
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    const stream = await this.client.messages.stream({
      model: config.claude.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    // アシスタントの返答を履歴に追加
    let fullResponse = '';
    stream.on('text', (text) => {
      fullResponse += text;
    });

    stream.on('finalMessage', () => {
      history.push({ role: 'assistant', content: fullResponse });
    });

    return stream;
  }

  /**
   * 会話履歴をリセット
   */
  clearHistory(sessionId) {
    this.conversations.delete(sessionId);
  }

  /**
   * インサイトデータをサマリー文字列に変換
   */
  buildInsightsSummary(insights) {
    if (!insights) return null;
    const m = insights.engagementMetrics || {};
    const posts = insights.posts || [];
    return `
フォロワー数: ${m.followersCount || 0}人
エンゲージメント率: ${m.engagementRate || 0}%
総閲覧数: ${(m.totalViews || 0).toLocaleString()}
総いいね: ${(m.totalLikes || 0).toLocaleString()}
総返信: ${(m.totalReplies || 0).toLocaleString()}
分析投稿数: ${posts.length}件
直近ハイライト: ${insights.topPosts?.[0]?.text?.substring(0, 50) || 'なし'}
`.trim();
  }
}
