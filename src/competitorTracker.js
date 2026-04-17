/**
 * CompetitorTracker - 競合アカウント追跡
 *
 * Puppeteerで threads.net/@username の公開プロフィールをスクレイピングし、
 * 自分のKPIと比較するベンチマーク機能を提供する。
 *
 * 注意: スクレイピングはMetaのToSに抵触する可能性があります。
 * 利用は自己責任で。
 */

import fs from 'fs/promises';
import path from 'path';
import dayjs from 'dayjs';

const COMPETITORS_DIR = './data/competitors';
const COMPETITORS_LIST_FILE = path.join(COMPETITORS_DIR, 'list.json');

export class CompetitorTracker {
  constructor(storage) {
    this.storage = storage;
    this._browser = null;
  }

  // ===== 競合リスト管理 =====

  async addCompetitor(username) {
    const list = await this.listCompetitors();
    const clean = username.replace(/^@/, '').trim().toLowerCase();
    if (!clean) throw new Error('ユーザー名が無効です');
    if (list.find(c => c.username === clean)) {
      throw new Error(`@${clean} は既に登録されています`);
    }
    list.push({ username: clean, addedAt: dayjs().toISOString(), lastScrapedAt: null });
    await this._saveList(list);
    return list;
  }

  async removeCompetitor(username) {
    const clean = username.replace(/^@/, '').trim().toLowerCase();
    let list = await this.listCompetitors();
    list = list.filter(c => c.username !== clean);
    await this._saveList(list);
    return list;
  }

  async listCompetitors() {
    await fs.mkdir(COMPETITORS_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(COMPETITORS_LIST_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // ===== スクレイピング =====

  /**
   * 単一アカウントのプロフィールをスクレイピング
   * @param {string} username
   * @returns {{ username, bio, posts, scrapedAt }}
   */
  /**
   * @param {string} username
   * @param {{ maxScrolls?: number }} options
   */
  async scrapeProfile(username, { maxScrolls = 15 } = {}) {
    const clean = username.replace(/^@/, '');
    const url = `https://www.threads.com/@${clean}`;

    let browser;
    try {
      const { default: puppeteer } = await import('puppeteer');
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // スクロールして追加投稿をロード（増えなくなるか maxScrolls 回で終了）
      let prevCount = 0;
      for (let i = 0; i < maxScrolls; i++) {
        const count = await page.evaluate(() =>
          document.querySelectorAll('div[data-pressable-container="true"]').length
        );
        if (count === prevCount && i > 0) break;
        prevCount = count;
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
        await new Promise(r => setTimeout(r, 1500));
      }

      const data = await page.evaluate((profileUsername) => {
        const posts = [];

        // data-pressable-container を起点に投稿を抽出（threads.com の実際のDOM構造に対応）
        const containers = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'));

        for (const container of containers.slice(0, 100)) {
          const timeEl = container.querySelector('time');
          if (!timeEl) continue;

          // /post/ リンク（メディアページを除外）
          const postLink = Array.from(container.querySelectorAll('a[href*="/post/"]'))
            .find(a => !a.href.includes('/media') && !a.href.includes('/likes'));
          if (!postLink) continue;

          // テキスト: span[dir="auto"] から取得し、ユーザー名・日付・翻訳ボタン・数値を除去
          const dateStr = timeEl.innerText?.trim() || '';
          const textSpans = Array.from(container.querySelectorAll('span[dir="auto"]'));
          const text = textSpans
            .map(s => s.innerText?.trim().replace(/\n翻訳$|\n?Translate$/, '').trim())
            .filter(t => {
              if (!t || t.length < 4) return false;
              if (t === dateStr) return false;
              if (t === profileUsername || t === '@' + profileUsername) return false; // ユーザー名を除外
              if (/^翻訳$|^Translate$/.test(t)) return false;
              if (/^\d[\d,]*$/.test(t)) return false; // 数値のみは除外
              return true;
            })
            .join(' ')
            .substring(0, 300);

          // role="button" の数値ボタンからいいね・返信・リポスト数を取得
          // 順序: [翻訳?] いいね, 返信, リポスト, 引用
          const numBtns = Array.from(container.querySelectorAll('[role="button"]'))
            .map(b => b.innerText?.trim())
            .filter(t => /^[\d,]+$/.test(t))
            .map(t => parseInt(t.replace(/,/g, ''), 10));

          const likeCount    = numBtns[0] || 0;
          const replyCount   = numBtns[1] || 0;
          const repostCount  = numBtns[2] || 0;

          if (text.length > 5 || likeCount > 0) {
            posts.push({
              text: text.substring(0, 200),
              likeCount,
              replyCount,
              repostCount,
              timestamp: timeEl.dateTime,
              postUrl: postLink.href,
            });
          }
        }

        // フォロワー数（「フォロワーN万人」形式）
        const allSpans = Array.from(document.querySelectorAll('span'));
        const followerSpan = allSpans.find(s => /フォロワー/.test(s.innerText));
        const followerMatch = followerSpan?.innerText?.match(/([\d,.]+万?)\s*人/);
        const followerCount = followerMatch ? followerMatch[1] + '人' : null;

        // bio（プロフィール文）
        const bioSpan = Array.from(document.querySelectorAll('span[dir="auto"]'))
          .find(s => s.innerText?.length > 15 && s.innerText?.length < 200
                  && !s.innerText?.includes('フォロワー'));
        const bio = bioSpan?.innerText?.trim() || '';

        return { posts, bio, followerCount };
      }, clean);

      await browser.close();

      const result = {
        username: clean,
        bio: data.bio,
        followerCount: data.followerCount,
        posts: data.posts,
        scrapedAt: dayjs().toISOString(),
        postCount: data.posts.length,
      };

      await this._saveScrapedData(clean, result);

      // 競合リストの lastScrapedAt を更新
      const list = await this.listCompetitors();
      const idx = list.findIndex(c => c.username === clean);
      if (idx >= 0) {
        list[idx].lastScrapedAt = result.scrapedAt;
        list[idx].followerCount = data.followerCount;
        await this._saveList(list);
      }

      return result;
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      throw new Error(`スクレイピング失敗 (@${clean}): ${e.message}`);
    }
  }

  /**
   * 全競合を一括更新
   */
  async updateAll() {
    const list = await this.listCompetitors();
    const results = [];
    for (const competitor of list) {
      try {
        const data = await this.scrapeProfile(competitor.username, { maxScrolls: 15 });
        results.push({ username: competitor.username, success: true, postCount: data.postCount });
      } catch (e) {
        results.push({ username: competitor.username, success: false, error: e.message });
      }
      // レート制限対策で少し待つ
      await new Promise(r => setTimeout(r, 3000));
    }
    return results;
  }

  /**
   * 自分のKPIと競合KPIを比較
   */
  async buildBenchmark(myInsights) {
    const list = await this.listCompetitors();
    const competitors = [];

    for (const item of list) {
      const data = await this.loadScrapedData(item.username);
      if (!data?.posts?.length) continue;

      const n = data.posts.length;
      const avgLikes   = Math.round(data.posts.reduce((s, p) => s + (p.likeCount   || 0), 0) / n);
      const avgReplies = Math.round(data.posts.reduce((s, p) => s + (p.replyCount  || 0), 0) / n);
      const avgReposts = Math.round(data.posts.reduce((s, p) => s + (p.repostCount || 0), 0) / n);

      const sortedPosts = [...data.posts].sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));

      competitors.push({
        username: item.username,
        followerCount: item.followerCount || data.followerCount,
        followerCountRaw: this._parseFollowerCount(item.followerCount || data.followerCount),
        postCount: data.postCount,
        avgLikes,
        avgReplies,
        avgReposts,
        scrapedAt: data.scrapedAt,
        topPosts: sortedPosts.slice(0, 3),
        allPosts: sortedPosts,
      });
    }

    const postLen = myInsights?.posts?.length || 1;
    const myMetrics = {
      followersCount: myInsights?.engagementMetrics?.followersCount || 0,
      avgLikes:   Math.round((myInsights?.engagementMetrics?.totalLikes   || 0) / postLen),
      avgReplies: Math.round((myInsights?.engagementMetrics?.totalReplies || 0) / postLen),
      avgReposts: Math.round((myInsights?.engagementMetrics?.totalReposts || 0) / postLen),
      avgViews:   myInsights?.engagementMetrics?.avgViews || 0,
      engagementRate: myInsights?.engagementMetrics?.engagementRate || 0,
      postCount: myInsights?.posts?.length || 0,
    };

    return { myMetrics, competitors, generatedAt: dayjs().toISOString() };
  }

  // ===== Private =====

  async _saveScrapedData(username, data) {
    await fs.mkdir(COMPETITORS_DIR, { recursive: true });
    const file = path.join(COMPETITORS_DIR, `${username}_${dayjs().format('YYYY-MM-DD')}.json`);
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
  }

  async loadScrapedData(username) {
    // 最新のファイルを探す
    try {
      const files = await fs.readdir(COMPETITORS_DIR);
      const matching = files
        .filter(f => f.startsWith(username + '_') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (!matching.length) return null;
      const raw = await fs.readFile(path.join(COMPETITORS_DIR, matching[0]), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** "545.4万人" → 5454000、"8,842人" → 8842 */
  _parseFollowerCount(str) {
    if (!str) return null;
    const s = String(str).replace(/[人,\s]/g, '');
    if (s.includes('万')) return Math.round(parseFloat(s) * 10000);
    if (s.includes('k') || s.includes('K')) return Math.round(parseFloat(s) * 1000);
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  async _saveList(list) {
    await fs.mkdir(COMPETITORS_DIR, { recursive: true });
    await fs.writeFile(COMPETITORS_LIST_FILE, JSON.stringify(list, null, 2), 'utf-8');
  }
}
