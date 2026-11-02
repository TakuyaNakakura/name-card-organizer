# Name Card Organizer

管理者が発行したユーザーID・パスワードで参加する、少人数チーム向け名刺管理アプリです。Googleログインも設定で選べます。Next.js App Router / PostgreSQL / Google Cloud Vision / S3互換ストレージを使用します。

このブランチは `codex/team-password-login`。Google招待方式の版は `codex/team-workflow` に保存しています。[Vercelを維持したアップグレード手順](docs/password-team-deployment.md)を参照してください。

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

最低限の設定は `TEAM_AUTH_MODE=password`、`BETTER_AUTH_SECRET`（32文字以上のランダム値）、`BETTER_AUTH_URL=http://localhost:3000`、`BOOTSTRAP_ADMIN_USERNAME`（3〜32文字）と `BOOTSTRAP_ADMIN_PASSWORD`（12〜128文字）です。秘密値の生成例は `openssl rand -base64 48` です。既存の `SESSION_SECRET` が32文字以上なら `BETTER_AUTH_SECRET` の代わりに利用できます。

Google OAuthの設定は不要です。初期管理者のパスワードは初期化用コンテナにだけ渡し、稼働アプリには渡しません。初期化後は `.env.team.local` の `BOOTSTRAP_ADMIN_PASSWORD` を削除してください。

```sh
docker compose --env-file .env.team.local up -d postgres
docker compose --env-file .env.team.local build app migrate bootstrap
docker compose --env-file .env.team.local run --rm migrate
docker compose --env-file .env.team.local run --rm bootstrap
docker compose --env-file .env.team.local up -d app
docker compose --env-file .env.team.local logs --tail=100 app
```

`http://localhost:3000/login` を開き、設定した管理者ID・パスワードでログインしてください。初期化は一度だけです。追加メンバーは「メンバー」画面で作成し、表示された一時パスワードを本人に安全な方法で伝えます。初回ログインで変更が必須です。忘れた場合は管理者が再発行できます。本人の変更・管理者の再発行では全端末のセッションが失効します。

DBはホストの `55433`、アプリは `3000` です。スマートフォンのカメラにはHTTPSが必要です。HTTPSトンネル等のURLを `BETTER_AUTH_URL` に設定してください。`APP_PORT` を変更した場合もURLを一致させます。

Google方式を使う場合は `TEAM_AUTH_MODE=google`、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`、`BOOTSTRAP_ADMIN_EMAIL` を指定します。OAuthクライアントは「ウェブアプリケーション」とし、リダイレクトURIに `<BETTER_AUTH_URL>/api/auth/callback/google` を登録します。Vision用サービスアカウントとは別です。既存GoogleチームをID方式へ切り替える手順も[導入ガイド](docs/password-team-deployment.md)にあります。

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

[ID・パスワード版の導入・移行・ロールバック手順](docs/password-team-deployment.md) を確認してください。既存のNeon・R2・Visionを引き続き利用できます。旧共有パスワードの `ADMIN_PASSWORD_HASH` は個人アカウントへ自動変換しません。旧 `public.cards` を自動変更するコードは廃止し、新版は `name_card` / `name_card_auth` のみを使用します。

このブランチをデプロイするだけでは旧データは移りません。本番のバックアップ、明示的なマイグレーション、初期管理者の作成が必要です。旧名刺の読み取り専用JSONエクスポートと、確認後の非破壊インポートを用意しています。運用切り替えや本番DBの操作は自動実行しません。

[実装計画](docs/team-use-implementation-plan.md) / [実装・検証状況](docs/team-implementation-status.md)
