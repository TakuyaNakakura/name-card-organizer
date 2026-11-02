# チーム版導入・移行手順

この文書はGoogle招待方式（`TEAM_AUTH_MODE=google`）のガイドです。`codex/team-password-login` の標準はID・パスワード方式です。[こちらの導入手順](password-team-deployment.md)を優先してください。

## 重要な変更

- パスワード共有ログイン・旧JWT cookie・OCR原文入りdraftTokenは廃止。Google認証とDBセッションに置き換えました。
- メンバー資格は毎回DBで確認。停止でセッションを削除し、最後の管理者は停止・降格不可。
- `public.cards` へのDDL/DMLは行いません。アプリの `name_card`、認証の `name_card_auth` を明示的に移行します。
- 通常のAPIと画像は `private, no-store`。画像URLはDB上のasset IDで、R2キーの直接指定は拒否します。
- 最初にログインした人を管理者にする機能はありません。運用担当者がメールアドレスを指定して初期招待を作ります。

## Vercelの環境変数

Production / Previewでそれぞれ専用DB・OAuth許可URL・非公開ストレージを使用します。Previewを本番DBに接続しないでください。

| 変数                                        | 設定                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | 専用Neonのruntimeロール接続URL。別サービスと共有しない。Vercel統合管理の変数ならresourceの接続先を変更      |
| `BETTER_AUTH_URL`                           | 公開URLの正確なorigin。例 `https://your-app.vercel.app`                                                     |
| `BETTER_AUTH_SECRET`                        | 32文字以上のランダム値。Googleのキーとは別。変更時は既存セッション・暗号化済みOAuth情報に注意               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuthのウェブクライアント                                                                            |
| `OCR_PROVIDER`                              | `google`                                                                                                    |
| `GOOGLE_CLOUD_CREDENTIALS_JSON`             | Vision用サービスアカウントJSON。Vercelの入力欄には1行JSONをそのまま入力し、dotenv用の外側の引用符は付けない |
| `STORAGE_DRIVER`                            | `s3`                                                                                                        |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET`   | R2のS3エンドポイント / `auto` / 非公開バケット                                                              |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 対象バケットに限定した読み書き・削除キー。`NEXT_PUBLIC_` は絶対に付けない                                   |
| `CRON_SECRET`                               | 別の32文字以上のランダム値。Vercel CronのAuthorization認証に利用                                            |

`DATABASE_MIGRATION_URL` は運用端末だけで使用し、Vercelの稼働アプリには設定しません。公開設定ガードで拒否します。`BOOTSTRAP_ADMIN_EMAIL` は初期化用だけです。

`ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` / `SESSION_SECRET` / `E2E_BYPASS_AUTH` は新版で不要です。特にバイパスは公開環境で禁止します。Google OAuthの承認済みリダイレクトURIは `<BETTER_AUTH_URL>/api/auth/callback/google` です。OAuth同意画面がテスト公開なら、参加予定のGoogleアカウントをテストユーザーへ追加します。

## スキーマ導入

1. 現行デプロイ・DB・画像をバックアップし、復元手順を確認します。Neonの復旧可能期間も確認してください。
2. Neonの専用ブランチ等でリハーサルします。旧公開デプロイの接続先・別サービスの接続先は変えません。
3. 運用端末にowner相当の `DATABASE_MIGRATION_URL` を設定し、`npm run db:migrate` を実行します。接続URLの暗黙フォールバックはありません。適用済みファイルはチェックサムで検証します。`001_init.sql` は旧資料として残し、新導入では自動実行しません。
4. DB管理画面で専用のLOGINロール `name_card_app` を作成し、秘密のパスワードを設定します。ownerで `db/runtime-grants.sql` を適用します。このロールを他サービスのロールへ所属させないでください。
5. runtimeロールの接続URLを `DATABASE_URL` に設定します。新スキーマだけにCRUD権限を与え、スキーマCREATE権限・旧public.cardsへのアクセスを与えません。認証もschema修飾SQLなので、Neonのpoolerにsearch_path設定は不要です。
6. `BOOTSTRAP_ADMIN_EMAIL` と任意の `TEAM_NAME` を設定し、`npm run team:bootstrap` を一度実行します。7日以内に指定のGoogleアカウントでログインしてください。既にチームがあれば再初期化は拒否されます。
7. 管理者は「メンバー」画面で2人目を招待します。Googleのメール確認済み属性と、招待メールの一致が必要です。

ローカルComposeではruntimeもpostgres ownerの便宜的設定です。本番でこの権限構成を使わず、必ず別ロールにしてください。

## 旧名刺の非破壊移行

1. 旧アプリの読み書きを止める前に、まずスナップショットのリハーサルを行います。新旧両方のバックアップを保持します。
2. 旧名刺アプリの `CardRecord[]` 形式のJSONを書き出し、**名刺だけ**であることを運用担当者が確認します。別サービスと混在したpublic.cards全体を推測で読み取りません。
3. 秘密のJSONファイルをGit管理外に置きます。フィールドは `id,fullName,organization,jobTitle,email,originalImageUrl,correctedImageUrl,rawOcrText,extractionConfidence,status,createdAt,updatedAt`。画像は旧 `/api/assets/drafts/<uuid>/original.jpg` 等のローカルパスのみ許可します。外部URLは取得しません。
4. 運用端末で `LEGACY_IMPORT_FILE`、`IMPORT_TEAM_ID`、`IMPORT_OWNER_EMAIL`、`DATABASE_MIGRATION_URL`、旧画像を読めるストレージ設定を指定し、`npm run db:import-legacy` を実行します。初回は常にdry runです。指定したメールは移行先の有効な管理者である必要があります。
5. 内容を確認後だけ `APPLY_LEGACY_IMPORT=YES` を設定して再実行します。画像は新しい `teams/<team>/imports/` へ複製し、旧画像を変更・削除しません。同じIDは再取り込みしません。DBコミット成否が不明な失敗時は画像を自動削除せず停止します。
6. ID・件数・日時・全フィールド・CSV・画像を照合します。旧登録者は不明のためnullにし、「旧版から移行」と表示します。移行担当者は操作履歴に残り、過去の登録者とは区別されます。移行名刺の編集・削除は管理者のみです。
7. 本番切り替えでは旧アプリの書き込みを止め、最終差分の移行と照合後に新版の書き込みを再開します。旧デプロイへURLを知っている人が書き込めないよう保護してください。

入力JSONのキー名が異なる旧DBは、バックアップから運用担当者が明示的に変換してください。このインポーターは旧DBの列やNOT NULL制約を変更しません。

## 保持とクリーンアップ

- `vercel.json` は1日1回（18:00 UTC / 日本時間03:00）に `/api/maintenance/cleanup` を実行します。`CRON_SECRET` のBearer認証が必須です。ProductionでCronが有効かVercel側でも確認します。
- 1回の画像削除上限は25件。期限切れが多い場合は監視し、外部の認証付きジョブから追加実行するか、プランに応じ頻度を調整します。期限到来時に閲覧は拒否し、物理削除はジョブ完了後です。
- 下書き7日・ごみ箱30日。登録済み名刺の画像は元の下書きの期限に関係なく保持します。R2でprefix単位の自動削除ルールを設定しないでください。
- 削除失敗時はDB参照を残し、次回再試行。失敗件数と最終実行日時は「運用状況」へ表示します。36時間未実行なら警告します。
- OCRはユーザー毎時30回・チーム毎時150回。DBで原子的に消費し、同一人物の処理中スキャンは1件まで。OCRの中断leaseは90秒です。予算アラート・障害通知・バックアップはクラウド側で別途設定します。

## ロールバック

新版の書き込み前なら、旧DB・画像・デプロイを保全した状態で切り戻せます。共有パスワード版をチーム向けに無保護で再公開しないでください。

新版で登録・編集・削除を始めた後は、旧接続URLへ戻すだけでは新データが失われます。書き込みとcleanupを停止して両方をバックアップし、まず新スキーマを維持した修正リリースを優先します。旧方式へ戻す場合も新旧差分・削除状態・画像・権限を照合してから移送します。`DROP SCHEMA` や旧public.cardsの削除は行いません。

## リリース前に残る外部作業

Google OAuth / Vision / R2の本番疎通、実機撮影、2〜3人のパイロット、バックアップ復元、5人同時・5,000件の性能計測、VoiceOver/TalkBack、依存関係の脆弱性対応を完了してください。露出した可能性のある旧キーは利用先を確認してローテーションします。今回、本番資格情報の失効や本番デプロイは実行していません。
