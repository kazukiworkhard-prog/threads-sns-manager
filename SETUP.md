# Threads SNS 運用管理システム - セットアップガイド

## 必要要件

- Node.js 18.0.0 以上
- npm または yarn

---

## クイックスタート

```bash
# 1. パッケージインストール
npm install

# 2. 環境変数設定
cp .env.example .env
# .env ファイルを編集して各種APIキーを設定

# 3. 起動（対話メニュー）
npm start
```

---

## API設定

### Threads API (必須)

1. [Meta for Developers](https://developers.facebook.com/) にアクセス
2. アプリを作成 → 「Threads API」を追加
3. ユーザーID と アクセストークンを取得
4. `.env` に設定:
   ```
   THREADS_APP_ID=xxxx
   THREADS_APP_SECRET=xxxx
   THREADS_ACCESS_TOKEN=xxxx
   THREADS_USER_ID=xxxx
   ```

> **アクセストークンの更新**: Threads の Long-lived Token は60日間有効です。
> 期限切れ前に更新してください。

---

### Google Sheets API (推奨)

インサイトデータをリアルタイムでスプレッドシートに保存します。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. **Google Sheets API** を有効化
3. **サービスアカウント** を作成してJSONキーをダウンロード
4. `config/google_service_account.json` として保存
5. 新しいGoogleスプレッドシートを作成
6. スプレッドシートをサービスアカウントのメールアドレスと共有（編集者権限）
7. `.env` に設定:
   ```
   GOOGLE_SHEETS_SPREADSHEET_ID=スプレッドシートのID（URLの/d/以降の部分）
   GOOGLE_SERVICE_ACCOUNT_EMAIL=xxxx@project.iam.gserviceaccount.com
   ```

> APIが未設定の場合、データはローカルの `data/insights/csv/` に保存されます。

---

### Claude AI API (推奨)

高品質な日本語投稿文案を自動生成します。

1. [Anthropic Console](https://console.anthropic.com/) でAPIキーを取得
2. `.env` に設定:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxx
   ```

> 未設定の場合、内蔵テンプレートを使用して投稿文案を生成します。

---

## コマンド一覧

```bash
# 対話メニュー（全機能）
npm start

# インサイト分析のみ
npm run analyze
npm run analyze -- --detailed  # 詳細分析

# コンテンツ計画立案
npm run plan
npm run plan -- --posts=5  # 週5投稿で計画

# 投稿作成・スケジュール
npm run post

# レポート生成
npm run report

# 自動スケジュール起動（常駐プロセス）
npm run schedule

# ウェブダッシュボード起動
npm run dashboard  # http://localhost:3000

# セットアップウィザード
npm run setup
```

---

## スプレッドシート構成

Google Sheetsには以下のシートが自動作成されます:

| シート名 | 内容 |
|----------|------|
| 日次インサイト | フォロワー数・エンゲージメント・リーチなどの日次データ |
| 投稿パフォーマンス | 各投稿のいいね・返信・リポスト数 |
| コンテンツカレンダー | 投稿計画とスケジュール |
| トピックバンク | 使用済み・未使用トピックの管理 |
| 月次レポート | 月次サマリーデータ |
| オーディエンス分析 | フォロワーの国・年齢・性別分布 |

---

## 自動化スケジュール

`npm run schedule` を実行すると以下が自動化されます:

| 時刻 | 処理 |
|------|------|
| 毎日 06:00 | インサイト収集・スプレッドシート保存 |
| 毎週月曜 07:00 | 週次コンテンツ計画立案 |
| 毎月1日 09:00 | 月次レポート生成 |

---

## ファイル構成

```
Threads/
├── threads.js          # メインエントリーポイント
├── package.json
├── .env               # 環境変数（要作成）
├── .env.example       # 環境変数テンプレート
├── index.html         # ウェブダッシュボード
├── src/
│   ├── commander.js   # 司令塔・オーケストレーション
│   ├── analyst.js     # インサイト分析
│   ├── strategist.js  # コンテンツ戦略
│   ├── creator.js     # 投稿文案作成
│   ├── operator.js    # 投稿実行・スケジュール
│   ├── reporter.js    # レポート生成
│   ├── spreadsheet.js # Google Sheets連携
│   └── storage.js     # ローカルデータ保存
├── config/
│   └── config.js      # システム設定
├── data/
│   └── insights/      # ローカルデータ保存先
│       ├── csv/       # CSVファイル
│       ├── posts/     # 投稿記録
│       └── schedules/ # スケジュール情報
├── reports/           # 生成レポート保存先
│   ├── *.html         # HTMLレポート
│   └── *.xlsx         # Excelレポート
└── templates/         # レポートテンプレート
```

---

## よくある質問

**Q: APIに接続できない場合は？**
A: デモデータで動作します。実際のデータを取得するには `.env` の設定が必要です。

**Q: スプレッドシートに保存されない場合は？**
A: `data/insights/csv/` フォルダにCSVファイルとして保存されます。

**Q: アクセストークンが期限切れの場合は？**
A: Meta Developer Portalでトークンを更新して `.env` を更新してください。

---

*Threads SNS Manager v1.0*
