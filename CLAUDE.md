# CLAUDE.md — Threads SNS Manager

このプロジェクトで作業する際の指針。問題が発生したら末尾の「既知の問題」に追記すること。

## プロジェクト概要

Threads SNS の運用を自動化する管理システム。
- **オーナー**: 島村一輝 (@kzktone)
- **主要機能**: インサイト分析・コンテンツ生成・予約投稿・競合分析・レポート生成
- **起動**: `node threads.js dashboard` → http://localhost:3000

## アーキテクチャ

```
threads.js          ← CLIエントリ + Expressサーバー（全APIルート）
src/
  commander.js      ← オーケストレーター（全エージェントを統括）
  analyst.js        ← Threads APIデータ取得・集計
  strategist.js     ← コンテンツ計画（ルールベース）
  creator.js        ← 投稿文案生成（Claude API使用）
  operator.js       ← 投稿実行・予約スケジュール（node-cron）
  reporter.js       ← HTML/Excelレポート生成
  aiAnalyst.js      ← Claude APIによる分析レポート
  velocity.js       ← 投稿公開後7日間のエンゲージメント速度追跡
  trendResearcher.js← バズパターン分析・競合推薦（Claude API）
  replyAnalyst.js   ← 返信取得・分類・テンプレート生成
  competitorTracker.js ← 競合スクレイピング（Puppeteer）
  notifier.js       ← Slack通知
  tokenManager.js   ← トークン期限監視・自動更新
  secretary.js      ← AIアシスタント（ストリーミング）
  storage.js        ← JSON/CSV/Excel永続化
  userStore.js      ← マルチアカウント管理
config/config.js    ← 全設定・環境変数
public/js/dashboard.js ← フロントエンドJS（1500行超）
index.html          ← ダッシュボードUI（単一ファイル）
ecosystem.config.cjs← PM2設定
```

## 必須知識

### モジュールシステム
- `"type": "module"` → **ESM専用**。`require()` 不可、`import` のみ
- dynamic import: `const { Foo } = await import('./src/foo.js')`
- ファイル拡張子 `.js` を省略しない

### APIルートの追加場所
`threads.js` の `runDashboard()` 関数内、`app.listen()` の直前に追加する。
既存パターン: `app.METHOD('/api/path', requireAuth, async (req, res) => { ... })`

### データ保存先
```
data/
  insights/         ← insights_YYYY-MM-DD.json（日次）
  competitors/      ← list.json + {username}_YYYY-MM-DD.json
  trend/            ← pattern_YYYY-MM-DD.json, recommend_YYYY-MM-DD.json
  replies/          ← {postId}.json
  users.json        ← マルチアカウント認証情報
  users/{userId}/   ← ユーザー別ストレージ
```

### フロントエンドAPI呼び出し
```js
// dashboard.js の fetchAPI() を使う（認証・エラー処理込み）
const res = await fetchAPI('/trend/competitors');          // GET
await fetchAPI('/trend/competitors', {
  method: 'POST',
  body: JSON.stringify({ username }),
});
```

## 既知の問題（遭遇した順）

### Puppeteer
- `page.waitForTimeout()` は **v21で削除済み** → `await new Promise(r => setTimeout(r, ms))` を使う
- `headless: 'new'` → v24以降は `headless: true`
- Threads URLは `threads.net` → `threads.com` にリダイレクト。最初から `threads.com` を使う
- `page.evaluate(fn, arg)` の中は別コンテキスト。外部変数は引数で渡す: `page.evaluate((x) => { ... }, x)`

### ダッシュボード（index.html）
- `<script src="/js/dashboard.js">` は絶対パス。`file://` で開くと動かない。必ずサーバー経由で開く
- `initAuth()` が `/auth/me` にfetchするためサーバー必須
- ページ追加時は `navigate()` の `titles` オブジェクトと `if (page === ...)` チェーンの**両方**に追記が必要

### Claude API
- クレジット不足時は `400 credit balance too low` エラー → フォールバック処理を実装すること
- `config.claude.model` = `'claude-opus-4-6'`

### サーバー起動
- ポート競合: `npx kill-port 3000` で解消
- PM2運用: `pm2 start ecosystem.config.cjs`

## 開発フロー

### 新機能追加の手順
1. `src/` に新モジュール作成（ESM export class）
2. `threads.js` にAPIルート追加（`requireAuth` 必須）
3. `index.html` にナビゲーション項目・ページHTML追加
4. `dashboard.js` に `navigate()` 登録 + ページ関数追加
5. 動作確認: `node --input-type=module` でモジュール単体テスト → サーバー再起動

### サーバー再起動コマンド
```bash
npx kill-port 3000 --silent && node threads.js dashboard &
```

### モジュール単体テスト
```bash
node --input-type=module <<'EOF'
import { MyModule } from './src/myModule.js';
const m = new MyModule();
console.log(await m.someMethod());
EOF
```

## 利用可能なスキル

| スキル | 用途 |
|--------|------|
| `/add-module` | 新しいsrcモジュールをアーキテクチャに合わせて追加 |
| `/debug` | エラーメッセージ・スタックトレースから原因診断 |
| `/simplify` | 変更後のコードをレビュー・品質改善 |

## 環境変数（.env）

```
THREADS_ACCESS_TOKEN  # Threads long-lived token（60日で期限切れ）
THREADS_USER_ID
ANTHROPIC_API_KEY     # Claude API（未設定時はフォールバックあり）
SLACK_WEBHOOK_URL     # Slack通知（任意）
DASHBOARD_PORT=3000
```

## やってはいけないこと

- `page.waitForTimeout()` を使う（削除済み）
- `threads.net` のURLを使う（`threads.com` に変更）
- `page.evaluate()` 内で外部スコープの変数を直接参照する
- `file://` でindex.htmlを直接開く（サーバー必須）
- `src` 属性に絶対パス `/js/...` を使う（相対パスか動的配信にする）
- ESM環境で `require()` を使う
