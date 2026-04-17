/**
 * NewsDigest - Google News RSSからAIニュースを取得し、Threads投稿に変換・予約投稿
 *
 * GASの dailyDigest ロジックを Node.js / ESM に移植し、
 * Threads 投稿生成・スケジューリングと統合する。
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/config.js';

const SEARCH_QUERIES = [
  'AI OR ChatGPT OR "生成AI"',
  '"人工知能" OR OpenAI OR Claude',
  '"機械学習" OR "ディープラーニング"',
  'ChatGPT OR Gemini OR "AI技術"',
];

const RSS_BASE = 'https://news.google.com/rss/search';
const LOOKBACK_DAYS = 7;
const MAX_ITEMS_PER_QUERY = 8;
const MAX_GENERATE = 5;        // 1回のバッチで生成する最大本数
const DEDUPE_KEEP_DAYS = 60;
const NEWS_DATA_DIR = path.resolve('./data/news');
const SENT_MAP_FILE = path.join(NEWS_DATA_DIR, 'sent_hashes.json');
const SCHEDULED_FILE = path.join(NEWS_DATA_DIR, 'scheduled_news.json');

export class NewsDigest {
  constructor() {
    if (config.claude?.apiKey) {
      this.ai = new Anthropic({ apiKey: config.claude.apiKey });
    }
  }

  async initialize() {
    await fs.mkdir(NEWS_DATA_DIR, { recursive: true });
  }

  // ===========================
  // 記事取得
  // ===========================

  /** Google News RSSから全記事を取得（重複タイトルは除去） */
  async fetchArticles() {
    const seen = new Set();
    const articles = [];

    for (const query of SEARCH_QUERIES) {
      const url = this._buildRssUrl(query);
      let xmlText;
      try {
        const res = await axios.get(url, {
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ThreadsBot/1.0)' },
        });
        xmlText = typeof res.data === 'string' ? res.data : String(res.data);
      } catch (e) {
        console.warn(`[NewsDigest] RSS取得失敗 (${query.slice(0, 20)}...): ${e.message}`);
        continue;
      }

      const parsed = this._parseRss(xmlText, query);
      let count = 0;
      for (const a of parsed) {
        if (!a.title || seen.has(a.titleHash) || count >= MAX_ITEMS_PER_QUERY) continue;
        seen.add(a.titleHash);
        articles.push(a);
        count++;
      }
    }

    articles.sort((a, b) => (b.pubMs || 0) - (a.pubMs || 0));
    return articles;
  }

  /** 未送信の新着記事だけ返す */
  async getFreshArticles() {
    const [all, sentMap] = await Promise.all([this.fetchArticles(), this._loadSentMap()]);
    return all.filter(a => !sentMap[a.titleHash]);
  }

  // ===========================
  // Threads投稿生成
  // ===========================

  /**
   * 記事リストから Threads 投稿を生成する
   * @param {Array} articles - 変換する記事（最大 MAX_GENERATE 件）
   * @returns {Array} 生成された投稿オブジェクト配列
   */
  async generateThreadsPosts(articles) {
    const targets = articles.slice(0, MAX_GENERATE);
    const posts = [];

    for (const article of targets) {
      const content = await this._generateSinglePost(article);
      posts.push({
        article,
        content,
        status: 'draft',
        createdAt: new Date().toISOString(),
      });
    }

    return posts;
  }

  /** 1記事 → Threads投稿文（Claude API or フォールバック） */
  async _generateSinglePost(article) {
    if (!this.ai) return this._fallbackPost(article);

    const systemPrompt = `あなたはThreads SNSの投稿コンテンツ作成の専門家です。
ニュース記事をもとに、Threadsで拡散されやすい投稿文を作成してください。

【投稿ルール】
- 500文字以内（必須）
- 冒頭1〜2行で読者の興味を引くフック
- ニュースの核心を平易な言葉で伝える
- 自分の見解・コメントを1〜2文加える（"〜と思う"など一人称）
- 自然な話し言葉、親しみやすいトーン
- 絵文字は3〜5個
- ハッシュタグは末尾に3〜4個（AI・テクノロジー関連）
- 最後に読者への問いかけ or CTAを入れる
- URLは本文に含めない（Threadsの仕様上貼れないため）

必ずJSON形式のみで返すこと（説明文は不要）：
{"text": "投稿本文", "hashtags": ["タグ1", "タグ2", "タグ3"]}`;

    const userPrompt = `以下のAIニュース記事をThreads投稿に変換してください。

タイトル: ${article.title}
概要: ${article.description ? article.description.slice(0, 300) : '（なし）'}
ソース: ${article.source}
公開日: ${article.pubDateFormatted || ''}`;

    try {
      const res = await this.ai.messages.create({
        model: config.claude?.model || 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      });
      const raw = res.content[0].text;
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          text: parsed.text || '',
          hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
          generatedBy: 'claude',
        };
      }
    } catch (e) {
      console.warn(`[NewsDigest] Claude生成失敗: ${e.message}`);
    }

    return this._fallbackPost(article);
  }

  _fallbackPost(article) {
    const desc = article.description ? article.description.slice(0, 150) + '…' : '';
    return {
      text: `【AIニュース】\n${article.title}\n\n${desc}\n\nこのニュース、あなたはどう思いますか？ 👇`,
      hashtags: ['AI', '人工知能', 'テクノロジー'],
      generatedBy: 'template',
    };
  }

  // ===========================
  // スケジュール管理
  // ===========================

  /** 生成済み投稿をスケジュール保存 */
  async saveScheduledNewsPosts(posts) {
    let existing = await this._loadScheduled();
    existing.push(...posts);
    await fs.writeFile(SCHEDULED_FILE, JSON.stringify(existing, null, 2), 'utf-8');
  }

  async loadScheduledNewsPosts() {
    return this._loadScheduled();
  }

  async updateScheduledNewsPost(id, updates) {
    const posts = await this._loadScheduled();
    const idx = posts.findIndex(p => p.id === id);
    if (idx === -1) return false;
    posts[idx] = { ...posts[idx], ...updates };
    await fs.writeFile(SCHEDULED_FILE, JSON.stringify(posts, null, 2), 'utf-8');
    return true;
  }

  async deleteScheduledNewsPost(id) {
    const posts = await this._loadScheduled();
    const filtered = posts.filter(p => p.id !== id);
    await fs.writeFile(SCHEDULED_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  }

  async _loadScheduled() {
    try {
      const raw = await fs.readFile(SCHEDULED_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // ===========================
  // 送信済みハッシュ管理
  // ===========================

  async markSent(articles) {
    const sentMap = await this._loadSentMap();
    const now = Date.now();
    for (const a of articles) sentMap[a.titleHash] = now;
    await fs.writeFile(SENT_MAP_FILE, JSON.stringify(sentMap, null, 2), 'utf-8');
  }

  async _loadSentMap() {
    try {
      const raw = await fs.readFile(SENT_MAP_FILE, 'utf-8');
      const obj = JSON.parse(raw);
      const keepMs = DEDUPE_KEEP_DAYS * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const cleaned = {};
      for (const [k, v] of Object.entries(obj)) {
        if (now - Number(v) < keepMs) cleaned[k] = v;
      }
      return cleaned;
    } catch {
      return {};
    }
  }

  // ===========================
  // RSS パーサー
  // ===========================

  _buildRssUrl(query) {
    const q = `${query} when:${LOOKBACK_DAYS}d`;
    return `${RSS_BASE}?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;
  }

  _parseRss(xmlText, query) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xmlText)) !== null) {
      const block = m[1];
      const title = this._extractTag(block, 'title');
      const link = this._extractTag(block, 'link');
      const pubDate = this._extractTag(block, 'pubDate');
      const descRaw = this._extractTag(block, 'description');
      const description = this._stripHtml(descRaw).slice(0, 300);
      const source = this._extractTag(block, 'source') || 'Google News';
      const pubMs = pubDate ? new Date(pubDate).getTime() : 0;
      const pubDateFormatted = pubMs
        ? new Date(pubMs).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        : pubDate || '';
      const titleHash = crypto.createHash('sha256').update(title || '').digest('hex');

      if (title) {
        items.push({ title, url: link, pubDate, pubMs, pubDateFormatted, description, source, query, titleHash });
      }
    }
    return items;
  }

  _extractTag(xml, tag) {
    // CDATA または通常テキストを両方サポート
    const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
    const m = xml.match(re);
    return m ? m[1].trim() : '';
  }

  _stripHtml(html) {
    let s = (html || '');
    s = s.replace(/<[^>]*>/g, '');                       // 実タグ除去
    s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<')   // エンティティデコード
          .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ');
    s = s.replace(/<[^>]*>/g, '');                       // エンティティ展開後のタグも除去
    return s.trim();
  }
}
