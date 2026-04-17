#!/usr/bin/env node
/**
 * Threads SNS 運用管理システム - メインエントリーポイント
 *
 * 使い方:
 *   node threads.js                  - 対話メニュー起動
 *   node threads.js analyze          - インサイト分析
 *   node threads.js plan             - コンテンツ計画立案
 *   node threads.js post             - 投稿実行/スケジュール
 *   node threads.js report           - レポート生成
 *   node threads.js schedule         - 自動スケジュール起動
 *   node threads.js setup            - 初期セットアップウィザード
 *   node threads.js dashboard        - ウェブダッシュボード起動
 *   node threads.js ai-analyze       - AIコンサルタントによるインサイト分析レポート生成
 */

import { createRequire } from 'module';
import chalk from 'chalk';
import { Commander } from './src/commander.js';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const command = args[0] || 'menu';

async function main() {
  const commander = new Commander();

  try {
    await commander.initialize();

    switch (command) {
      case 'analyze':
        await runAnalyze(commander, args);
        break;

      case 'plan':
        await runPlan(commander, args);
        break;

      case 'post':
        await runPost(commander, args);
        break;

      case 'report':
        await runReport(commander, args);
        break;

      case 'schedule':
        await runSchedule(commander);
        break;

      case 'setup':
        await runSetup();
        break;

      case 'dashboard':
        await runDashboard(commander);
        break;

      case 'daily':
        await commander.runDailyCycle();
        break;

      case 'ai-analyze':
        await runAIAnalyze(commander, args);
        break;

      case 'menu':
      default:
        await runInteractiveMenu(commander);
        break;
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ エラーが発生しました: ${error.message}`));
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

async function runAnalyze(commander, args) {
  const detailed = args.includes('--detailed') || args.includes('-d');
  const result = await commander.runAnalysis({ detailed });

  console.log(chalk.bold('\n📊 分析結果サマリー'));
  console.log(JSON.stringify(result.summary, null, 2));
}

async function runPlan(commander, args) {
  const postsPerWeek = args.find(a => a.startsWith('--posts='))
    ? parseInt(args.find(a => a.startsWith('--posts=')).split('=')[1]) : 7;

  await commander.runContentPlanning({ postsPerWeek });
}

async function runPost(commander, args) {
  const { default: inquirer } = await import('inquirer');

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: '投稿操作を選択:',
    choices: [
      { name: '📝 今日の投稿を作成・スケジュール', value: 'create' },
      { name: '📋 スケジュール一覧を表示', value: 'list' },
      { name: '❌ スケジュールをキャンセル', value: 'cancel' },
    ],
  }]);

  if (action === 'create') {
    const strategy = await commander.runContentPlanning();
    const posts = await commander.creator.createDailyPosts(strategy);
    await commander.operator.schedulePost(posts);
  } else if (action === 'list') {
    await commander.operator.listScheduledPosts();
  } else if (action === 'cancel') {
    const scheduled = await commander.operator.listScheduledPosts();
    if (scheduled.length > 0) {
      const { jobId } = await inquirer.prompt([{
        type: 'list',
        name: 'jobId',
        message: 'キャンセルするジョブを選択:',
        choices: scheduled.map(p => ({ name: `${p.scheduledAt} - ${p.topic}`, value: p.jobId })),
      }]);
      commander.operator.cancelScheduledPost(jobId);
    }
  }
}

async function runReport(commander, args) {
  const { default: inquirer } = await import('inquirer');

  const { reportType } = await inquirer.prompt([{
    type: 'list',
    name: 'reportType',
    message: 'レポートタイプを選択:',
    choices: [
      { name: '📊 今月のクライアントレポート', value: 'monthly' },
      { name: '📈 カスタム期間レポート', value: 'custom' },
      { name: '📋 週次サマリー', value: 'weekly' },
    ],
  }]);

  let options = {};

  if (reportType === 'custom') {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'startDate', message: '開始日 (YYYY-MM-DD):', default: '2025-01-01' },
      { type: 'input', name: 'endDate', message: '終了日 (YYYY-MM-DD):', default: new Date().toISOString().split('T')[0] },
      { type: 'input', name: 'clientName', message: 'クライアント名 (任意):' },
    ]);
    options = answers;
  } else if (reportType === 'weekly') {
    const { default: dayjs } = await import('dayjs');
    options = {
      startDate: dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
      endDate: dayjs().format('YYYY-MM-DD'),
    };
  }

  const result = await commander.runReport(options);
  console.log(chalk.green(`\n✅ レポート生成完了`));
  if (result.htmlPath) console.log(`  HTML: ${result.htmlPath}`);
  if (result.excelPath) console.log(`  Excel: ${result.excelPath}`);
}

async function runAIAnalyze(commander, args) {
  // CLIオプション解析: --days=30 --client=名前 --no-compare
  const daysArg = args.find(a => a.startsWith('--days='));
  const clientArg = args.find(a => a.startsWith('--client='));
  const noCompare = args.includes('--no-compare');

  let daysBack = daysArg ? parseInt(daysArg.split('=')[1]) : null;
  let clientName = clientArg ? clientArg.split('=').slice(1).join('=') : null;
  let comparePrev = !noCompare;

  // オプション未指定時のみ対話形式
  if (!daysBack) {
    const { default: inquirer } = await import('inquirer');

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'daysBack',
        message: '分析期間を選択:',
        choices: [
          { name: '📅 直近7日間', value: 7 },
          { name: '📅 直近30日間', value: 30 },
          { name: '📅 直近90日間', value: 90 },
        ],
        default: 30,
      },
      {
        type: 'input',
        name: 'clientName',
        message: 'クライアント名（任意、省略可）:',
        default: '',
      },
      {
        type: 'confirm',
        name: 'comparePrev',
        message: '前期との比較分析を含めますか？',
        default: true,
      },
    ]);

    daysBack = answers.daysBack;
    clientName = answers.clientName || undefined;
    comparePrev = answers.comparePrev;
  }

  const result = await commander.runAIAnalysis({
    daysBack,
    clientName: clientName || undefined,
    comparePrev,
  });

  console.log(chalk.green('\n✅ AI分析レポート生成完了'));
  if (result.mdPath) console.log(`  保存先: ${result.mdPath}`);
}

async function runSchedule(commander) {
  console.log(chalk.bold.yellow('\n⏰ 自動スケジュール起動モード'));
  console.log(chalk.gray('Ctrl+C で停止\n'));

  await commander.setupSchedule();

  // プロセスを継続
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n自動スケジュールを停止しました。'));
    process.exit(0);
  });

  // ハートビート表示
  setInterval(() => {
    const now = new Date().toLocaleTimeString('ja-JP');
    process.stdout.write(chalk.gray(`\r⏰ 稼働中: ${now}`));
  }, 10000);
}

async function runSetup() {
  const { default: inquirer } = await import('inquirer');
  const fs = await import('fs/promises');

  console.log(chalk.bold.cyan('\n🔧 初期セットアップウィザード'));
  console.log(chalk.gray('Threads SNS運用管理システムの初期設定を行います\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'THREADS_APP_ID',
      message: 'Threads App ID:',
      validate: v => v.length > 0 || '必須項目です',
    },
    {
      type: 'password',
      name: 'THREADS_APP_SECRET',
      message: 'Threads App Secret:',
    },
    {
      type: 'password',
      name: 'THREADS_ACCESS_TOKEN',
      message: 'Threads Access Token:',
    },
    {
      type: 'input',
      name: 'THREADS_USER_ID',
      message: 'Threads User ID:',
    },
    {
      type: 'input',
      name: 'GOOGLE_SHEETS_SPREADSHEET_ID',
      message: 'Google Sheets スプレッドシートID (任意):',
      default: '',
    },
    {
      type: 'password',
      name: 'ANTHROPIC_API_KEY',
      message: 'Anthropic API Key (Claude AIによる文案生成に使用、任意):',
      default: '',
    },
  ]);

  const envContent = Object.entries(answers)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  await fs.writeFile('.env', envContent + '\nTIMEZONE=Asia/Tokyo\nDEFAULT_LANGUAGE=ja\n', 'utf-8');

  console.log(chalk.green('\n✅ .env ファイルを作成しました'));
  console.log(chalk.cyan('\n次のステップ:'));
  console.log('  1. npm install でパッケージをインストール');
  console.log('  2. npm start でシステムを起動');
}

async function runDashboard(commander) {
  const { default: express } = await import('express');
  const { default: path } = await import('path');
  const { default: fs } = await import('fs/promises');
  const { fileURLToPath } = await import('url');
  const { default: session } = await import('express-session');
  const { default: axios } = await import('axios');
  const { UserStore } = await import('./src/userStore.js');
  const { Commander } = await import('./src/commander.js');
  const { LocalStorage } = await import('./src/storage.js');
  const { VelocityTracker } = await import('./src/velocity.js');
  const { config } = await import('./config/config.js');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = express();
  const PORT = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '3000');

  // ユーザーストア初期化
  const userStore = new UserStore();
  await userStore.initialize();

  // アプリオーナーをストアに登録（初回のみ）
  if (config.threads.userId && config.threads.accessToken) {
    const existing = userStore.getUser(config.threads.userId);
    if (!existing) {
      await userStore.upsertUser(config.threads.userId, {
        userId: config.threads.userId,
        accessToken: config.threads.accessToken,
        username: 'owner',
        name: 'App Owner',
        isOwner: true,
      });
    }
  }

  // ユーザーごとのCommanderキャッシュ
  const commanderCache = new Map();
  // オーナーのCommanderはすでに初期化済み
  if (config.threads.userId) {
    commanderCache.set(config.threads.userId, commander);
  }

  // ユーザー用Commanderファクトリ
  async function getCommanderForUser(user) {
    if (commanderCache.has(user.userId)) {
      return commanderCache.get(user.userId);
    }
    const cmd = new Commander();
    const userDataDir = `./data/users/${user.userId}`;
    const userStorage = new LocalStorage(userDataDir);
    await userStorage.initialize();
    // ストレージを上書き
    cmd.analyst.storage = userStorage;
    cmd.analyst.velocityTracker = new VelocityTracker(userStorage);
    cmd.operator.storage = userStorage;
    cmd.operator.velocityTracker = new VelocityTracker(userStorage);
    // Sheetsは共有（任意）
    await cmd.analyst.sheets.initialize().catch(() => {});
    // スケジュール復元
    const saved = await userStorage.loadScheduledPosts();
    if (saved) cmd.operator.scheduledPosts = saved;
    // 認証情報設定（VelocityTrackerも含む）
    cmd.analyst.setCredentials(user.accessToken, user.userId);
    cmd.analyst.velocityTracker.setCredentials(user.accessToken);
    cmd.operator.setCredentials(user.accessToken, user.userId);
    cmd.operator.velocityTracker.setCredentials(user.accessToken);
    cmd.initialized = true;
    commanderCache.set(user.userId, cmd);
    return cmd;
  }

  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET || 'threads-dashboard-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));
  app.use(express.static(path.join(__dirname, 'public')));

  // 認証ミドルウェア
  const requireAuth = (req, res, next) => {
    if (req.session?.userId) {
      const user = userStore.getUser(req.session.userId);
      if (user) {
        req.currentUser = user;
        return next();
      }
    }
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  };

  // OAuth設定
  const CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || `http://localhost:${PORT}/auth/callback`;
  const SCOPES = 'threads_basic,threads_content_publish,threads_read_replies,threads_manage_insights';

  // ===== 認証ルート =====
  app.get('/auth/login', (req, res) => {
    const authUrl = `https://threads.net/oauth/authorize?client_id=${config.threads.appId}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&scope=${SCOPES}&response_type=code`;
    res.redirect(authUrl);
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) return res.redirect('/login?error=denied');
    try {
      // 短期トークン取得
      const params = new URLSearchParams({
        client_id: config.threads.appId,
        client_secret: config.threads.appSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: CALLBACK_URL,
      });
      const tokenRes = await axios.post(
        'https://graph.threads.net/oauth/access_token',
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const { access_token: shortToken } = tokenRes.data;

      // 長期トークンに交換
      const longRes = await axios.get('https://graph.threads.net/access_token', {
        params: {
          grant_type: 'th_exchange_token',
          client_secret: config.threads.appSecret,
          access_token: shortToken,
        },
      });
      const accessToken = longRes.data.access_token;

      // ユーザー情報取得（idは文字列として取得 - 数値変換すると精度が失われる）
      const meRes = await axios.get('https://graph.threads.net/v1.0/me', {
        params: { fields: 'id,username,name', access_token: accessToken },
      });
      const userId = String(meRes.data.id); // /me の id は文字列で返る

      await userStore.upsertUser(userId, {
        userId,
        accessToken,
        username: meRes.data.username || userId,
        name: meRes.data.name || meRes.data.username || userId,
      });

      // キャッシュ済みCommanderの認証情報も最新トークンに更新
      if (commanderCache.has(userId)) {
        const cachedCmd = commanderCache.get(userId);
        cachedCmd.analyst.setCredentials(accessToken, userId);
        cachedCmd.analyst.velocityTracker.setCredentials(accessToken);
        cachedCmd.operator.setCredentials(accessToken, userId);
        cachedCmd.operator.velocityTracker.setCredentials(accessToken);
      }

      req.session.userId = userId;
      res.redirect('/');
    } catch (e) {
      console.error('OAuth error:', e.response?.data || e.message);
      res.redirect('/login?error=oauth_failed');
    }
  });

  app.get('/auth/logout', (req, res) => {
    // キャッシュからも除去
    if (req.session?.userId) commanderCache.delete(req.session.userId);
    req.session.destroy(() => res.redirect('/login'));
  });

  app.get('/auth/me', requireAuth, (req, res) => {
    const { accessToken, ...safeUser } = req.currentUser;
    res.json({ success: true, user: safeUser });
  });

  // ===== ページルート =====
  app.get('/', (req, res) => {
    if (!req.session?.userId) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.get('/login', (req, res) => {
    if (req.session?.userId && userStore.getUser(req.session.userId)) {
      return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public/login.html'));
  });

  app.get('/privacy-policy.html', (req, res) => res.sendFile(path.join(__dirname, 'privacy-policy.html')));
  app.get('/terms-of-service.html', (req, res) => res.sendFile(path.join(__dirname, 'terms-of-service.html')));

  // アンインストールコールバック（許可取り消し時）
  app.post('/auth/uninstall', async (req, res) => {
    try {
      const userId = req.body?.user_id?.toString();
      if (userId) {
        await userStore.upsertUser(userId, { revokedAt: new Date().toISOString(), accessToken: null });
        commanderCache.delete(userId);
      }
    } catch { /* silent */ }
    res.sendStatus(200);
  });

  // データ削除リクエストコールバック（Meta仕様準拠）
  app.post('/auth/delete', async (req, res) => {
    try {
      const userId = req.body?.user_id?.toString();
      const confirmationCode = `del_${userId || 'unknown'}_${Date.now()}`;
      if (userId) {
        // ユーザーデータを削除
        await userStore.upsertUser(userId, {
          accessToken: null,
          deletedAt: new Date().toISOString(),
          username: null,
          name: null,
        });
        commanderCache.delete(userId);
        // ユーザー専用ストレージの削除（非同期）
        fs.rm(`./data/users/${userId}`, { recursive: true, force: true }).catch(() => {});
      }
      // Metaが要求するレスポンス形式
      res.json({
        url: `${CALLBACK_URL.replace('/auth/callback', '')}/deletion-status?code=${confirmationCode}`,
        confirmation_code: confirmationCode,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 削除ステータス確認ページ
  app.get('/deletion-status', (req, res) => {
    const code = req.query.code || '';
    res.send(`<html><body style="font-family:sans-serif;padding:40px"><h2>データ削除完了</h2><p>確認コード: <code>${code}</code></p><p>お客様のデータは削除されました。</p></body></html>`);
  });

  // ===== API エンドポイント（認証必須） =====
  app.get('/api/insights', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const data = await cmd.runAnalysis();
      res.json({ success: true, data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/schedule', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const posts = await cmd.operator.listScheduledPosts();
      res.json({ success: true, posts });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/plan', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const plan = await cmd.runContentPlanning(req.body);
      res.json({ success: true, plan });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/history', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const history = await cmd.operator.getPostHistory(20);
      res.json({ success: true, history });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // フォロワー履歴
  app.get('/api/followers-history', requireAuth, async (req, res) => {
    try {
      const histFile = path.join('data', 'users', req.currentUser.userId, 'followers_history.json');
      const raw = await fs.readFile(histFile, 'utf-8').catch(() => '[]');
      res.json({ success: true, history: JSON.parse(raw) });
    } catch (e) {
      res.json({ success: true, history: [] });
    }
  });

  // 投稿生成（Claude API - 共有キー）
  app.post('/api/generate-post', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const { topic, category, keywords } = req.body;
      const postPlan = { topic, categoryId: category, category, keywords: keywords?.split(',').map(k => k.trim()) || [], estimatedEngagement: 'high' };
      const content = await cmd.creator.generatePost(postPlan);
      res.json({ success: true, content });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 投稿スケジュール登録
  app.post('/api/schedule-post', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const { text, scheduledAt } = req.body;
      await cmd.operator.schedulePost([{ content: { text }, scheduledAt, topic: text.substring(0, 30) }]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // スケジュールキャンセル
  app.delete('/api/schedule/:jobId', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const result = cmd.operator.cancelScheduledPost(req.params.jobId);
      res.json({ success: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // レポート生成
  app.post('/api/report', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const result = await cmd.runReport(req.body);
      const htmlFile = path.basename(result.htmlPath);
      const excelFile = path.basename(result.excelPath);
      res.json({
        success: true,
        htmlPath: result.htmlPath,
        excelPath: result.excelPath,
        htmlFile,
        excelFile,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // レポートファイルダウンロード
  app.get('/api/report/download/:filename', async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filepath = path.join(__dirname, 'reports', filename);
      await fs.access(filepath);
      res.download(filepath, filename);
    } catch (e) {
      res.status(404).json({ success: false, error: 'ファイルが見つかりません' });
    }
  });

  // レポートHTML表示
  app.get('/api/report/view/:filename', async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filepath = path.join(__dirname, 'reports', filename);
      await fs.access(filepath);
      res.sendFile(filepath);
    } catch (e) {
      res.status(404).send('レポートが見つかりません');
    }
  });

  // レポートPDFダウンロード（puppeteerでサーバー生成）
  app.get('/api/report/pdf/:filename', async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const htmlPath = path.join(__dirname, 'reports', filename);
      await fs.access(htmlPath);

      const { default: puppeteer } = await import('puppeteer');
      const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      const htmlContent = await fs.readFile(htmlPath, 'utf-8');
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
      });
      await browser.close();

      const pdfFilename = filename.replace('.html', '.pdf');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
      res.send(Buffer.from(pdfBuffer));
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 速度追跡データ
  app.get('/api/velocity', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const summary = await cmd.operator.velocityTracker.buildSummary();
      const activeIds = await cmd.operator.storage.loadActiveVelocityList();
      res.json({ success: true, summary, activeCount: activeIds.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // キャッシュ済みインサイト（高速）
  // ?force=1 を付けると強制再取得してキャッシュを上書きする
  app.get('/api/insights-cached', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const force = req.query.force === '1';
      if (!force) {
        const today = new Date().toISOString().split('T')[0];
        const userDataDir = cmd.analyst.storage.dataDir;
        const file = path.join(userDataDir, `insights_${today}.json`);
        const raw = await fs.readFile(file, 'utf-8').catch(() => null);
        if (raw) return res.json({ success: true, data: JSON.parse(raw), cached: true });
      }
      const data = await cmd.runAnalysis();
      res.json({ success: true, data, cached: false });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ===== 秘書API =====
  const { Secretary } = await import('./src/secretary.js');
  const secretary = new Secretary();

  app.post('/api/secretary/chat', requireAuth, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ success: false, error: 'メッセージが空です' });

      const sessionId = req.session.userId;

      // キャッシュ済みインサイトをコンテキストとして渡す
      let insightsSummary = null;
      try {
        const cmd = await getCommanderForUser(req.currentUser);
        const today = new Date().toISOString().split('T')[0];
        const file = path.join(cmd.analyst.storage.dataDir, `insights_${today}.json`);
        const raw = await fs.readFile(file, 'utf-8').catch(() => null);
        if (raw) insightsSummary = secretary.buildInsightsSummary(JSON.parse(raw));
      } catch { /* インサイトなしでも続行 */ }

      const stream = await secretary.chat(sessionId, message, { insightsSummary });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      stream.on('text', (text) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });

      stream.on('finalMessage', () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      });

      stream.on('error', (e) => {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/secretary/clear', requireAuth, (req, res) => {
    secretary.clearHistory(req.session.userId);
    res.json({ success: true });
  });

  // ===== ヘルスチェック =====
  app.get('/api/health', (req, res) => {
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    res.json({
      status: 'ok',
      uptime: Math.floor(uptime),
      uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // トークン残日数
  app.get('/api/token-status', requireAuth, async (req, res) => {
    try {
      const { TokenManager } = await import('./src/tokenManager.js');
      const { Notifier } = await import('./src/notifier.js');
      const tm = new TokenManager(userStore, new Notifier());
      const status = tm.getTokenStatus(req.currentUser.userId);
      res.json({ success: true, ...status });
    } catch (e) {
      res.json({ success: true, status: 'unknown', daysLeft: null });
    }
  });

  // ===== トレンドリサーチ API =====
  const { TrendResearcher } = await import('./src/trendResearcher.js');

  app.get('/api/trend/my-patterns', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const today = new Date().toISOString().split('T')[0];
      const userDataDir = cmd.analyst.storage.dataDir;
      const insightFile = path.join(userDataDir, `insights_${today}.json`);
      const raw = await fs.readFile(insightFile, 'utf-8').catch(() => null);
      const insightData = raw ? JSON.parse(raw) : await cmd.runAnalysis();
      const posts = insightData?.posts || insightData?.data?.posts || [];

      const researcher = new TrendResearcher(cmd.analyst.storage);
      const result = await researcher.analyzeMyPostPatterns(posts);
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ベンチマーク候補アカウントをAIが推薦
  app.get('/api/trend/recommend-competitors', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      // 最新インサイトを取得（キャッシュ優先）
      const today = new Date().toISOString().split('T')[0];
      const insightFile = path.join(cmd.analyst.storage.dataDir, `insights_${today}.json`);
      const raw = await fs.readFile(insightFile, 'utf-8').catch(() => null);
      const insightData = raw ? JSON.parse(raw) : await cmd.runAnalysis();
      const posts   = insightData?.posts || [];
      const metrics = insightData?.engagementMetrics || {};

      const researcher = new TrendResearcher(cmd.analyst.storage);
      const result = await researcher.recommendCompetitors(posts, metrics);
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 競合リスト取得
  app.get('/api/trend/competitors', requireAuth, async (req, res) => {
    try {
      const { CompetitorTracker } = await import('./src/competitorTracker.js');
      const tracker = new CompetitorTracker();
      const list = await tracker.listCompetitors();
      res.json({ success: true, competitors: list });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 競合を追加
  app.post('/api/trend/competitors', requireAuth, async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) return res.status(400).json({ success: false, error: 'usernameが必要です' });
      const { CompetitorTracker } = await import('./src/competitorTracker.js');
      const tracker = new CompetitorTracker();
      const list = await tracker.addCompetitor(username);
      res.json({ success: true, competitors: list });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  // 競合を削除
  app.delete('/api/trend/competitors/:username', requireAuth, async (req, res) => {
    try {
      const { CompetitorTracker } = await import('./src/competitorTracker.js');
      const tracker = new CompetitorTracker();
      const list = await tracker.removeCompetitor(req.params.username);
      res.json({ success: true, competitors: list });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 競合データを更新（スクレイピング）
  app.post('/api/trend/competitors/:username/scrape', requireAuth, async (req, res) => {
    try {
      const maxScrolls = parseInt(req.body?.maxScrolls) || 15;
      const { CompetitorTracker } = await import('./src/competitorTracker.js');
      const tracker = new CompetitorTracker();
      const data = await tracker.scrapeProfile(req.params.username, { maxScrolls });
      res.json({ success: true, data });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 全競合を一括更新
  app.post('/api/trend/competitors/update-all', requireAuth, async (req, res) => {
    try {
      const { CompetitorTracker } = await import('./src/competitorTracker.js');
      const tracker = new CompetitorTracker();
      const results = await tracker.updateAll();
      res.json({ success: true, results });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ベンチマーク比較
  app.get('/api/trend/benchmark', requireAuth, async (req, res) => {
    try {
      const cmd = await getCommanderForUser(req.currentUser);
      const today = new Date().toISOString().split('T')[0];
      const insightFile = path.join(cmd.analyst.storage.dataDir, `insights_${today}.json`);
      const raw = await fs.readFile(insightFile, 'utf-8').catch(() => null);
      const insightData = raw ? JSON.parse(raw) : null;

      const { CompetitorTracker } = await import('./src/competitorTracker.js');
      const tracker = new CompetitorTracker();
      const benchmark = await tracker.buildBenchmark(insightData);
      res.json({ success: true, data: benchmark });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ===== 返信分析 API =====
  const { ReplyAnalyst } = await import('./src/replyAnalyst.js');

  // 投稿の返信一覧を取得
  app.get('/api/replies/:postId', requireAuth, async (req, res) => {
    try {
      const analyst = new ReplyAnalyst(req.currentUser.accessToken);
      // キャッシュ確認
      const cached = await analyst.loadAnalysis(req.params.postId);
      if (cached) return res.json({ success: true, data: cached, fromCache: true });

      const replies = await analyst.getReplies(req.params.postId, 50);
      res.json({ success: true, data: { postId: req.params.postId, replies, replyCount: replies.length } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 返信を詳細分析（Claude）
  app.post('/api/replies/:postId/analyze', requireAuth, async (req, res) => {
    try {
      const { postText } = req.body;
      const analyst = new ReplyAnalyst(req.currentUser.accessToken);
      const result = await analyst.analyzePost(req.params.postId, postText || '');
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ===== ニュースダイジェスト =====
  {
    const { NewsDigest } = await import('./src/newsDigest.js');
    const newsDigest = new NewsDigest();
    await newsDigest.initialize();

    // 記事取得（未送信のみ）
    app.get('/api/news/articles', requireAuth, async (req, res) => {
      try {
        const fresh = await newsDigest.getFreshArticles();
        res.json({ success: true, data: fresh });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // 選択した記事からThreads投稿を生成
    app.post('/api/news/generate', requireAuth, async (req, res) => {
      try {
        const { articles } = req.body;
        if (!Array.isArray(articles) || articles.length === 0) {
          return res.status(400).json({ success: false, error: '記事を選択してください' });
        }
        const posts = await newsDigest.generateThreadsPosts(articles);
        res.json({ success: true, data: posts });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // 生成した投稿を予約スケジュールに追加
    app.post('/api/news/schedule', requireAuth, async (req, res) => {
      try {
        const { posts } = req.body; // [{article, content, scheduledAt}, ...]
        if (!Array.isArray(posts) || posts.length === 0) {
          return res.status(400).json({ success: false, error: '投稿データがありません' });
        }

        const { Operator } = await import('./src/operator.js');
        const op = new Operator();
        op.setCredentials(req.currentUser.accessToken, req.currentUser.userId);
        await op.initialize();

        const scheduled = [];
        for (const p of posts) {
          const id = `news_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const newsPost = {
            id,
            article: p.article,
            content: p.content,
            scheduledAt: p.scheduledAt,
            status: 'scheduled',
            createdAt: new Date().toISOString(),
          };

          // 既存 Operator のスケジュール機能を利用
          if (p.scheduledAt) {
            await op.schedulePost([{
              scheduledAt: p.scheduledAt,
              topic: p.article?.title || 'AIニュース',
              content: p.content,
            }]);
          }

          scheduled.push(newsPost);
        }

        await newsDigest.saveScheduledNewsPosts(scheduled);

        // 送信済みとしてマーク（重複投稿防止）
        const articles = posts.map(p => p.article).filter(Boolean);
        if (articles.length) await newsDigest.markSent(articles);

        res.json({ success: true, data: scheduled });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // スケジュール済みニュース投稿一覧
    app.get('/api/news/scheduled', requireAuth, async (req, res) => {
      try {
        const posts = await newsDigest.loadScheduledNewsPosts();
        res.json({ success: true, data: posts });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // スケジュール削除
    app.delete('/api/news/scheduled/:id', requireAuth, async (req, res) => {
      try {
        await newsDigest.deleteScheduledNewsPost(req.params.id);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // 手動実行：ニュース取得→投稿生成→即時スケジュール登録（自動化のトリガー）
    app.post('/api/news/auto-run', requireAuth, async (req, res) => {
      try {
        const { scheduledAt } = req.body; // ISO文字列 or null（即時）
        const fresh = await newsDigest.getFreshArticles();
        if (fresh.length === 0) {
          return res.json({ success: true, message: '新着ニュースなし', data: [] });
        }
        const posts = await newsDigest.generateThreadsPosts(fresh.slice(0, 3));

        // scheduledAt が指定されていれば各投稿に付与（等間隔にずらす）
        const baseTime = scheduledAt ? new Date(scheduledAt) : null;
        const enriched = posts.map((p, i) => ({
          ...p,
          scheduledAt: baseTime
            ? new Date(baseTime.getTime() + i * 30 * 60 * 1000).toISOString() // 30分間隔
            : null,
        }));

        // Operator でスケジュール登録（scheduledAt がある場合）
        if (baseTime) {
          const { Operator } = await import('./src/operator.js');
          const op = new Operator();
          op.setCredentials(req.currentUser.accessToken, req.currentUser.userId);
          await op.initialize();
          for (const p of enriched) {
            if (p.scheduledAt) {
              await op.schedulePost([{
                scheduledAt: p.scheduledAt,
                topic: p.article?.title || 'AIニュース',
                content: p.content,
              }]);
            }
          }
        }

        await newsDigest.saveScheduledNewsPosts(enriched.map((p, i) => ({
          id: `news_auto_${Date.now()}_${i}`,
          ...p,
        })));
        await newsDigest.markSent(fresh.slice(0, 3));

        res.json({ success: true, data: enriched });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // ===== ニュース自動投稿 cron（毎朝8:10 JST） =====
    {
      const { default: cron } = await import('node-cron');
      cron.schedule('10 8 * * *', async () => {
        console.log('[NewsDigest] 毎朝自動ニュース取得・投稿生成開始');
        try {
          const fresh = await newsDigest.getFreshArticles();
          if (fresh.length === 0) {
            console.log('[NewsDigest] 新着ニュースなし、スキップ');
            return;
          }
          const posts = await newsDigest.generateThreadsPosts(fresh.slice(0, 3));
          const baseTime = new Date();
          baseTime.setMinutes(baseTime.getMinutes() + 10);

          const users = userStore.getAllUsers();
          for (const user of users) {
            try {
              const op = new (await import('./src/operator.js')).Operator();
              op.setCredentials(user.accessToken, user.userId);
              await op.initialize();
              for (let i = 0; i < posts.length; i++) {
                const scheduledAt = new Date(baseTime.getTime() + i * 30 * 60 * 1000).toISOString();
                await op.schedulePost([{
                  scheduledAt,
                  topic: posts[i].article?.title || 'AIニュース',
                  content: posts[i].content,
                }]);
              }
              console.log(`[NewsDigest] ${user.userId}: ${posts.length}件スケジュール登録`);
            } catch (e) {
              console.error(`[NewsDigest] ${user.userId} 失敗:`, e.message);
            }
          }

          await newsDigest.saveScheduledNewsPosts(posts.map((p, i) => ({
            id: `news_auto_${Date.now()}_${i}`,
            ...p,
          })));
          await newsDigest.markSent(fresh.slice(0, 3));
          console.log('[NewsDigest] 自動投稿スケジュール完了');
        } catch (e) {
          console.error('[NewsDigest] 自動実行エラー:', e.message);
        }
      }, { timezone: 'Asia/Tokyo' });
    }
  }

  // ===== Token管理 cron =====
  {
    const { TokenManager } = await import('./src/tokenManager.js');
    const { Notifier } = await import('./src/notifier.js');
    const notifier = new Notifier();
    const tokenManager = new TokenManager(userStore, notifier);

    const { default: cron } = await import('node-cron');
    // 毎日 08:00 JST にトークン期限チェック
    cron.schedule('0 8 * * *', async () => {
      console.log('[TokenManager] トークン期限チェック開始');
      await tokenManager.checkAllTokens().catch(e => console.error('[TokenManager]', e.message));
    }, { timezone: 'Asia/Tokyo' });

    // 起動時に1回チェック（テスト & 初期化）
    tokenManager.checkAllTokens().catch(() => {});
  }

  // ===== インサイトキャッシュ事前生成 cron =====
  {
    const { default: cron } = await import('node-cron');

    async function warmInsightsCacheForAllUsers() {
      const users = userStore.getAllUsers();
      if (users.length === 0) {
        console.log('[CacheWarm] 登録ユーザーなし、スキップ');
        return;
      }
      console.log(`[CacheWarm] インサイトキャッシュ更新開始 (${users.length}ユーザー)`);
      for (const user of users) {
        try {
          console.log(`[CacheWarm] ${user.userId} 処理中...`);
          const cmd = await getCommanderForUser(user);
          await cmd.runAnalysis();
          console.log(`[CacheWarm] ${user.userId} 完了`);
        } catch (e) {
          console.error(`[CacheWarm] ${user.userId} 失敗:`, e.message);
        }
      }
      console.log('[CacheWarm] 全ユーザー完了');
    }

    // 毎日 05:00 JST にキャッシュを事前生成（ユーザーがアクセスする前に完了させる）
    cron.schedule('0 5 * * *', () => {
      warmInsightsCacheForAllUsers().catch(e => console.error('[CacheWarm]', e.message));
    }, { timezone: 'Asia/Tokyo' });
  }

  app.listen(PORT, () => {
    console.log(chalk.green(`\n🌐 ダッシュボード起動: http://localhost:${PORT}`));
    console.log(chalk.gray('Ctrl+C で停止'));
  });

  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nダッシュボードを停止しました。'));
    process.exit(0);
  });
}

async function runInteractiveMenu(commander) {
  const { default: inquirer } = await import('inquirer');

  while (true) {
    console.log('');
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'アクションを選択してください:',
      choices: [
        { name: '📊 インサイト分析 (+ スプレッドシート保存)', value: 'analyze' },
        { name: '🤖 AI コンサルタント分析レポート生成', value: 'ai-analyze' },
        { name: '📅 コンテンツ計画立案', value: 'plan' },
        { name: '✍️  投稿コンテンツ作成', value: 'create' },
        { name: '🚀 投稿実行/スケジュール', value: 'post' },
        { name: '📋 レポート生成', value: 'report' },
        { name: '⏰ 自動運用スケジュール起動', value: 'schedule' },
        { name: '🔄 日次サイクル全実行', value: 'daily' },
        { name: '🌐 ウェブダッシュボード起動', value: 'dashboard' },
        new inquirer.Separator(),
        { name: '❌ 終了', value: 'exit' },
      ],
    }]);

    if (action === 'exit') {
      console.log(chalk.cyan('\nご利用ありがとうございました。\n'));
      break;
    }

    switch (action) {
      case 'analyze':
        await runAnalyze(commander, []);
        break;
      case 'ai-analyze':
        await runAIAnalyze(commander, []);
        break;
      case 'plan':
        await runPlan(commander, []);
        break;
      case 'create': {
        const strategy = await commander.runContentPlanning();
        const posts = await commander.creator.createDailyPosts(strategy);
        posts.forEach(p => {
          console.log(chalk.bold(`\n[${p.category}] ${p.topic}`));
          console.log(p.content?.text);
        });
        break;
      }
      case 'post':
        await runPost(commander, []);
        break;
      case 'report':
        await runReport(commander, []);
        break;
      case 'schedule':
        await runSchedule(commander);
        break;
      case 'daily':
        await commander.runDailyCycle();
        break;
      case 'dashboard':
        await runDashboard(commander);
        break;
    }
  }
}

main();
