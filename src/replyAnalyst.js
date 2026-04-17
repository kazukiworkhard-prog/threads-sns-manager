/**
 * ReplyAnalyst - 返信取得・分類・テンプレート生成
 *
 * Threads API: GET /{post_id}/replies
 * スコープ: threads_read_replies（OAuthで取得済み）
 */

import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';
import { config } from '../config/config.js';

const REPLIES_DIR = './data/replies';

export class ReplyAnalyst {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.apiBase = config.threads.apiBase;
    this.client = config.claude.apiKey
      ? new Anthropic({ apiKey: config.claude.apiKey })
      : null;
  }

  setCredentials(accessToken) {
    this.accessToken = accessToken;
  }

  /**
   * 投稿への返信一覧を取得
   * @param {string} postId
   * @param {number} limit - 最大取得数
   * @returns {Array} 返信配列
   */
  async getReplies(postId, limit = 50) {
    const replies = [];
    let cursor = null;

    while (replies.length < limit) {
      const params = {
        access_token: this.accessToken,
        fields: 'id,text,username,timestamp,has_replies,reply_audience,is_reply',
        limit: Math.min(25, limit - replies.length),
      };
      if (cursor) params.after = cursor;

      try {
        const res = await axios.get(`${this.apiBase}/${postId}/replies`, { params });
        const items = res.data?.data || [];
        replies.push(...items);

        cursor = res.data?.paging?.cursors?.after;
        if (!cursor || items.length === 0) break;
      } catch (e) {
        if (e.response?.status === 400 || e.response?.status === 404) break;
        throw new Error(`返信取得エラー: ${e.response?.data?.error?.message || e.message}`);
      }
    }

    return replies;
  }

  /**
   * 返信をClaudeで分類
   * @param {Array} replies
   * @returns {Object} { positive, negative, question, impression, other }
   */
  async classifyReplies(replies) {
    if (!replies.length) return { positive: [], negative: [], question: [], impression: [], other: [] };

    if (!this.client) {
      return this._classifyByKeyword(replies);
    }

    const texts = replies.map((r, i) => `${i + 1}. "${r.text || ''}"`).join('\n');
    const prompt = `以下のThreadsへの返信コメントを分類してください。

返信一覧:
${texts}

以下のJSON形式で返してください:
\`\`\`json
{
  "classified": [
    { "index": 番号, "category": "positive|negative|question|impression|other", "summary": "10文字以内の要約" }
  ]
}
\`\`\`

カテゴリ定義:
- positive: 感謝・称賛・共感・同意
- negative: 批判・不満・反論
- question: 質問・確認・詳細を求めるコメント
- impression: 感想・雑感（ポジネガ不明）
- other: その他・スパム・意味不明`;

    try {
      const msg = await this.client.messages.create({
        model: config.claude.model,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = msg.content[0]?.text || '';
      const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
      if (!jsonMatch) return this._classifyByKeyword(replies);

      const { classified } = JSON.parse(jsonMatch[1]);
      const result = { positive: [], negative: [], question: [], impression: [], other: [] };

      for (const item of classified) {
        const reply = replies[item.index - 1];
        if (reply && result[item.category]) {
          result[item.category].push({ ...reply, summary: item.summary });
        }
      }
      return result;
    } catch {
      return this._classifyByKeyword(replies);
    }
  }

  /**
   * よくある質問パターンを抽出
   */
  async extractFAQs(replies) {
    const questions = replies.filter(r => r.text?.includes('？') || r.text?.includes('?') || r.text?.includes('どう') || r.text?.includes('教えて'));
    if (!questions.length) return [];

    if (!this.client) {
      return questions.slice(0, 5).map(q => ({ question: q.text, frequency: 1 }));
    }

    const texts = questions.map(q => q.text || '').join('\n');
    const prompt = `以下の返信コメント（質問系）から、よくあるパターンのFAQを最大5つ抽出してください。

${texts}

JSON形式:
\`\`\`json
{
  "faqs": [
    { "question": "まとめた質問", "frequency": 件数 }
  ]
}
\`\`\``;

    try {
      const msg = await this.client.messages.create({
        model: config.claude.model,
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = msg.content[0]?.text || '';
      const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
      if (jsonMatch) return JSON.parse(jsonMatch[1]).faqs || [];
    } catch { /* ignore */ }
    return questions.slice(0, 5).map(q => ({ question: q.text, frequency: 1 }));
  }

  /**
   * 各カテゴリのベスト返信テンプレートを生成
   */
  async generateReplyTemplates(classifiedReplies, postText = '') {
    if (!this.client) {
      return {
        forPositive: 'ありがとうございます！参考になれば幸いです。',
        forQuestion: 'ご質問ありがとうございます。詳しくはDMでお答えします！',
        forImpression: 'コメントありがとうございます！',
      };
    }

    const examples = {
      positive:   classifiedReplies.positive?.slice(0, 3).map(r => r.text).join('\n') || '',
      question:   classifiedReplies.question?.slice(0, 3).map(r => r.text).join('\n') || '',
      negative:   classifiedReplies.negative?.slice(0, 2).map(r => r.text).join('\n') || '',
      impression: classifiedReplies.impression?.slice(0, 3).map(r => r.text).join('\n') || '',
    };

    const prompt = `Threadsの投稿への返信テンプレートを生成してください。

【元の投稿（冒頭100文字）】
"${(postText || '').substring(0, 100)}"

【返信コメントの例】
ポジティブ:
${examples.positive || 'なし'}

質問:
${examples.question || 'なし'}

ネガティブ:
${examples.negative || 'なし'}

感想:
${examples.impression || 'なし'}

各カテゴリに対する自然な返信テンプレートを生成してください（50文字以内）。

JSON形式:
\`\`\`json
{
  "forPositive": "テンプレート文",
  "forQuestion": "テンプレート文",
  "forNegative": "テンプレート文",
  "forImpression": "テンプレート文",
  "universal": "どんな返信にも使えるテンプレート"
}
\`\`\``;

    try {
      const msg = await this.client.messages.create({
        model: config.claude.model,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = msg.content[0]?.text || '';
      const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
      if (jsonMatch) return JSON.parse(jsonMatch[1]);
    } catch { /* ignore */ }

    return {
      forPositive: 'ありがとうございます！励みになります。',
      forQuestion: 'ご質問ありがとうございます！詳しくはDMでもお気軽にどうぞ。',
      forNegative: 'ご意見ありがとうございます。参考にさせていただきます。',
      forImpression: 'コメントありがとうございます！',
      universal: 'ありがとうございます！またよろしくお願いします。',
    };
  }

  /**
   * 投稿の返信を一括分析
   */
  async analyzePost(postId, postText = '') {
    const replies = await this.getReplies(postId, 100);
    if (!replies.length) {
      return { postId, replyCount: 0, classification: {}, faqs: [], templates: {} };
    }

    const [classification, faqs, templates] = await Promise.all([
      this.classifyReplies(replies),
      this.extractFAQs(replies),
      this.generateReplyTemplates({ positive: [], question: [], negative: [], impression: [] }, postText),
    ]);

    // テンプレートは分類後に生成し直す
    const betterTemplates = await this.generateReplyTemplates(classification, postText);

    const result = {
      postId,
      replyCount: replies.length,
      replies: replies.slice(0, 50),
      classification,
      classificationSummary: {
        positive:   classification.positive?.length   || 0,
        negative:   classification.negative?.length   || 0,
        question:   classification.question?.length   || 0,
        impression: classification.impression?.length || 0,
        other:      classification.other?.length      || 0,
      },
      faqs,
      templates: betterTemplates,
      analyzedAt: dayjs().toISOString(),
    };

    await this.saveAnalysis(postId, result);
    return result;
  }

  async saveAnalysis(postId, result) {
    await fs.mkdir(REPLIES_DIR, { recursive: true });
    const file = path.join(REPLIES_DIR, `${postId}.json`);
    await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf-8');
  }

  async loadAnalysis(postId) {
    try {
      const file = path.join(REPLIES_DIR, `${postId}.json`);
      const raw = await fs.readFile(file, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // キーワードベースの分類（フォールバック）
  _classifyByKeyword(replies) {
    const result = { positive: [], negative: [], question: [], impression: [], other: [] };
    for (const r of replies) {
      const t = r.text || '';
      if (/ありがとう|すごい|参考|助かった|最高|素晴らしい/.test(t)) result.positive.push(r);
      else if (/？|\?|どう|教えて|詳しく/.test(t)) result.question.push(r);
      else if (/違う|おかしい|間違|批判/.test(t)) result.negative.push(r);
      else if (t.length > 5) result.impression.push(r);
      else result.other.push(r);
    }
    return result;
  }
}
