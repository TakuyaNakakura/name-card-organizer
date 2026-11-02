# Name Card Organizer

Googleアカウントで参加する、招待制のチーム向け名刺管理アプリです。Next.js App Router / PostgreSQL / Google Cloud Vision / S3互換ストレージを使用します。

## 利用フロー

カメラの自動撮影または画像選択 → OCR → 自分専用の下書きに自動保存 → 内容を確認・編集 → チーム全員に共有。

- 単発・連続スキャンを切り替え可能。切り替えで下書きは消えません。
- 撮影後は名刺を画面から外すまで次の自動撮影を待ちます。一時停止・手動撮影も可能です。
- 名前・所属・役職・メールアドレスを抽出。メールなしでも、名前・所属・メールのいずれか1項目があれば登録できます。
- 下書きは本人のみ閲覧可能。最終編集から7日間保持。まとめて登録した際の失敗分は残ります。
- 登録済み名刺はチームで共有。編集・削除・復元は登録者と管理者のみです。
- 検索・登録者/日付絞り込み・25件ページング・Excel対応CSV・30日間のごみ箱・操作履歴。
- [デジタル庁デザインシステムを基にしたローカル実装](docs/design-system.md)。

## Docker Composeで起動

Node.js 24 LTS / Docker Composeが基準です。`.env.team.example` を参照し、`.env.team.local` に必要な値を設定してください。秘密情報はGitに含めません。

最低限の設定は `BETTER_AUTH_SECRET`（32文字以上のランダム値）、`BETTER_AUTH_URL=http://localhost:3000`、Google OAuthの `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`、初期管理者の `BOOTSTRAP_ADMIN_EMAIL` です。秘密値の生成例は `openssl rand -base64 48` です。

Google OAuthクライアントは「ウェブアプリケーション」で作成し、リダイレクトURIに `http://localhost:3000/api/auth/callback/google` を登録します。Vision用サービスアカウントとは別の認証情報です。

```sh
docker compose --env-file .env.team.local up -d postgres
docker compose --env-file .env.team.local build app
docker compose --env-file .env.team.local run --rm migrate
docker compose --env-file .env.team.local run --rm bootstrap
docker compose --env-file .env.team.local up -d app
docker compose --env-file .env.team.local logs --tail=100 app
```

`http://localhost:3000/login` を開き、指定した管理者のGoogleアカウントでログインしてください。初期化は一度だけです。追加メンバーは「メンバー」画面から招待し、ログインURLを本人に伝えます。招待メールの自動送信はありません。

DBはホストの `55433`、アプリは `3000` です。スマートフォンのカメラにはHTTPSが必要です。HTTPSトンネル等のURLを `BETTER_AUTH_URL` とGoogleのリダイレクトURIにも設定してください。`APP_PORT` を変更した場合もURLを一致させます。

## 実際のOCRとR2

Google CloudでVision APIと課金を有効化し、`OCR_PROVIDER=google` と `GOOGLE_CLOUD_CREDENTIALS_JSON` を設定します。JSONは1行に整形し、dotenv内では全体をシングルクォートで囲みます。ファイルマウント方式は既存の `docker-compose.google-ocr.yml` も使用可能です。

R2は非公開バケットを使用し、`STORAGE_DRIVER=s3`、`S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`、`S3_REGION=auto`、`S3_BUCKET`、R2のS3アクセスキー `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` を設定します。一般のCloudflare APIトークンとは異なります。バケット全体を公開したり、ブラウザへキーを渡したりしません。

OCRは1画像につき `DOCUMENT_TEXT_DETECTION` を1回実行します。SDKの自動再試行は無効です。失敗時の再解析は本人の操作で行い、追加のOCR利用として数えます。Google側の予算アラートも別途設定してください。

## 検証

検証DBは専用の `name_card_test` / ポート `55434` / 一時ボリュームです。既存の開発DBや本番Neonへは接続しません。

```sh
docker compose -f docker-compose.test.yml up -d postgres
docker compose -f docker-compose.test.yml build test
docker compose -f docker-compose.test.yml run --rm test
```

ブラウザE2Eは上記DBを起動した状態でNode.js 24から実行します。

```sh
npm ci
npx playwright install chromium
npm run build
npm run test:e2e
```

E2Eは検証DBに短命の実セッションを作成します。公開アプリに認証バイパスやテストログインAPIは追加しません。OpenCVによる枠検出には模擬カメラ動画を使用し、OCRはモックです。実Google OAuth、Vision、R2、iPhone Safari / Android Chromeの最終確認は別途必要です。

## Vercelへの切り替え

[チーム版の導入・移行・ロールバック手順](docs/team-deployment.md) を確認してください。旧管理者パスワード方式の環境変数は使いません。旧 `public.cards` を自動変更するコードは廃止し、新版は `name_card` / `name_card_auth` のみを使用します。

このブランチをデプロイするだけでは旧データは移りません。本番のバックアップ、明示的なマイグレーション、初期管理者の招待、新認証の設定が必要です。運用切り替えや本番DBの操作は自動実行しません。

[実装計画](docs/team-use-implementation-plan.md) / [実装・検証状況](docs/team-implementation-status.md)
