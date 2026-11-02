# ID・パスワード版の導入

## 変更範囲

`codex/team-password-login` はGoogle版 `codex/team-workflow` を基にした別ブランチです。名刺の単発/連続撮影・下書き・まとめて登録・チーム共有・検索・CSV・ごみ箱・デジタル庁デザインシステムの画面を引き継ぎます。

同じVercelプロジェクト・Neonリソース・非公開R2バケット・Visionサービスアカウントを利用できます。新しい認証サービスやメール送信サービスは不要です。ただしアプリ更新だけではDB移行されません。以下の明示的な初期化が必要です。実際のVercel設定・本番データはこの実装で変更していません。

## Vercelの設定

| 項目                                                    | 対応                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                          | 専用の名刺DBを維持。他サービスと共有しない。最小権限のruntimeロールを推奨（後述）                             |
| `OCR_PROVIDER=google` / `GOOGLE_CLOUD_CREDENTIALS_JSON` | 現行値を維持                                                                                                  |
| `STORAGE_DRIVER=s3` / `S3_*`                            | 現行の非公開R2設定を維持                                                                                      |
| `SESSION_SECRET`                                        | 32文字以上の既存ランダム値を流用可。`BETTER_AUTH_SECRET` が設定済みならそちらが優先。両方を不用意に変更しない |
| `TEAM_AUTH_MODE`                                        | `password` を追加。未指定もpasswordだが、明示を推奨                                                           |
| `BETTER_AUTH_URL`                                       | 現在の本番originを追加。例 `https://your-app.vercel.app`。末尾パスなし                                        |
| `CRON_SECRET`                                           | 未設定なら32文字以上の別のランダム値を追加。日次クリーンアップ認証用                                          |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`             | ID方式では不要。Visionの認証情報とは別物                                                                      |
| `ADMIN_PASSWORD_HASH`                                   | 旧版の共有パスワード用。新版では不使用。ロールバック期間終了後に削除                                          |

VercelのNode.jsは24.x、ビルドは通常の `npm run build` のままです。`DATABASE_MIGRATION_URL`、`BOOTSTRAP_ADMIN_PASSWORD`、`ADMIN_PASSWORD`（平文）、`E2E_BYPASS_AUTH=true` は稼働Vercelに置かないでください。公開ガードで拒否します。秘密情報を `NEXT_PUBLIC_` にしないでください。

ProductionとPreviewには別DBを使います。PreviewにはPreview自身の `BETTER_AUTH_URL` を設定し、Preview検証で本番を初期化しないでください。`codex/team-workflow` のpushに伴う自動Previewと、mainのProduction更新は別です。

## 初回導入（旧共有パスワード版から）

1. 現行デプロイ、Neon、R2をバックアップします。名刺用の専用DBであることを確認し、まずNeonの別ブランチでリハーサルしてください。
2. Node.js 24で `npm ci`。運用端末だけの `.env.upgrade.local` を作成します。この名前はGit管理対象外です。

```dotenv
DATABASE_MIGRATION_URL=運用用owner接続URL
TEAM_AUTH_MODE=password
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_NAME=管理者
BOOTSTRAP_ADMIN_PASSWORD=自分だけが知っている12文字以上のパスワード
TEAM_NAME=共有名刺チーム
```

3. 次を運用端末で実行します。`002_team` と `003_password_login` をトランザクション内で適用します。旧 `public.cards` に変更しません。DBアプリ権限はGoogle版と同じ `db/runtime-grants.sql` で制限できます。接続先DBは維持しつつruntimeロールへ切り替える場合は、Vercelの接続URLのロールも更新してください。

```sh
node --env-file=.env.upgrade.local scripts/migrate.mjs
node --env-file=.env.upgrade.local scripts/bootstrap-team.mjs
```

4. bootstrapの `Team ID` を控えます。初期管理者のパスワードは出力しません。チームが既にあれば新規bootstrapは拒否します。初期化用の平文パスワードは作業後に環境ファイルから削除してください。
5. 下記の旧データ移行をリハーサルし、Previewで管理者ログイン・メンバー追加・OCR・共有・CSV・削除/復元を確認します。
6. 本番切り替え前に旧版の書き込みを止め、最新のエクスポート/移行/照合を行います。その後、レビュー済みブランチをmainへマージしてProductionを更新します。旧デプロイの直接URLも保護し、新旧へ同時書き込みさせないでください。

## 旧名刺を残して移す

既にGoogleチーム版を利用している場合はこのコピーは不要です。旧共有パスワード版の `public.cards` から新しい `name_card.cards` へ移す場合だけ行います。

1. `.env.upgrade.local` に次を追加します。`secrets/` ディレクトリは事前に作成し、出力をGitや第三者に渡さないでください。

```dotenv
LEGACY_DATABASE_URL=旧名刺専用DBの読み取り用接続URL
LEGACY_EXPORT_FILE=secrets/legacy-cards.json
EXPORT_LEGACY_CARDS=YES
LEGACY_IMPORT_FILE=secrets/legacy-cards.json
IMPORT_TEAM_ID=bootstrapで表示したTeam_ID
IMPORT_OWNER_USERNAME=admin
STORAGE_DRIVER=s3
# 同じ非公開R2を読み書きするS3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEYも指定
```

2. `node --env-file=.env.upgrade.local scripts/export-legacy-cards.mjs` を実行。固定の旧スキーマから読み取り専用トランザクションで出力します。別サービスの列構造なら停止し、推測修復しません。最大10,000件。ファイルは0600で新規作成のみ（上書き不可）。新しい差分エクスポートには別ファイル名を使ってください。
3. JSONが名刺だけであること・件数・フィールド・日時を確認します。**CSVは原文や画像情報が欠けるので移行用には使いません。**
4. `node --env-file=.env.upgrade.local scripts/import-legacy-cards.mjs` はまずdry run。問題なければ同ファイルに `APPLY_LEGACY_IMPORT=YES` を追加し、再実行します。移行画像は新しいprefixへ複製し、元画像を消しません。同じIDは二重登録しません。
5. 件数・全フィールド・画像・CSVを照合。旧登録者は不明として表示し、管理者のみ編集可能です。切り替え後に旧名刺が空に見える場合は、旧テーブルの削除ではなくこの移行未実施を確認してください。

## Googleチーム版から認証だけ変更

`name_card` の既存名刺・下書き・登録者IDはそのまま使えます。`003_password_login` は列とインデックスの追加のみです。

1. バックアップ後に `scripts/migrate.mjs` を実行します。
2. 運用端末の環境ファイルに `BOOTSTRAP_EXISTING_ADMIN_EMAIL=既存の有効な管理者メール`、希望の `BOOTSTRAP_ADMIN_USERNAME`、`BOOTSTRAP_ADMIN_PASSWORD`、`TEAM_AUTH_MODE=password` を設定して `scripts/bootstrap-team.mjs` を実行します。明示した既存管理者だけに認証情報を追加し、名刺・下書きの所有者は変えません。
3. 既にパスワードがある場合は上書きを拒否します。最後の管理者がパスワードを忘れた場合の運用端末からの復旧に限り、`BOOTSTRAP_EXISTING_ADMIN_EMAIL` の代わりに `BOOTSTRAP_EXISTING_ADMIN_USERNAME=admin` など既存IDを指定し、`BOOTSTRAP_ADMIN_USERNAME` にも同じID、新しい `BOOTSTRAP_ADMIN_PASSWORD` と `BOOTSTRAP_RESET_PASSWORD=YES` を明示します。この値・初期パスワード・migration接続URLはVercelへ置きません。
4. Vercelを `TEAM_AUTH_MODE=password` で更新し、管理者がIDでログインします。「メンバー」で既存GoogleメンバーにIDと一時パスワードを割り当てます。ユーザー自体を作り直さないので、過去の下書き・編集権限を維持します。
5. Google方式を選び直す場合は `TEAM_AUTH_MODE=google` とOAuthの設定が必要です。パスワード専用アカウントはGoogleへ自動リンクされないため、その人たちはログインできなくなります。単なる設定変更で全員が戻れるとは限りません。

## 日々の運用と安全対策

- 管理者が「メンバー」でID・表示名・権限を指定し、サーバー生成の一時パスワードを本人へ安全に伝えます。共有IDは使わず、一人に一つ発行します。公開自己登録・メール送信・メールでのパスワードリセットはありません。
- 一時パスワードの状態では名刺APIを利用できず、「アカウント」で本人が変更する必要があります。本人の変更・管理者の再発行は全端末をログアウトさせます。最後の管理者の停止/降格は不可です。
- IDは3〜32文字のASCII、大小文字を区別しません。パスワードは12〜128文字、ハッシュ保存（Better Authのscrypt）。12文字以上でも単純な値は避け、パスワードマネージャーを推奨します。
- ログインは同一IPで毎分20回・15分枠60回、同一IDで15分枠10回。アカウントの存在に関係なくDBで原子的に数え、Vercelインスタンス間で共有します。変更は本人毎15分10回、作成/再発行は管理者毎15分30回。上限は成功分も含みます。IDへの試行集中では本人も一時的に待つ必要があります。
- パスワードの平文はDB・操作履歴・ログに残しません。一時パスワードは発行直後の管理画面だけに保持し、「閉じる」で消します。忘れたら再発行してください。
- DBセッション・HttpOnly/SameSite cookie・CSRFチェック・無効メンバーの毎回確認を利用します。旧JWT cookieは受け入れず、共有パスワードhashも個人パスワードへ変換しません。
- MFA・SSO・自動メール配送は未対応です。外部公開時はHTTPSとパスワード管理に加え、必要に応じVercel側のアクセス制限を設定してください。以前からの依存関係の残課題は `security-update-next15.md` を参照してください。

認証には既存依存の[Better Auth Username plugin](https://better-auth.com/docs/plugins/username)を使用し、新しい認証ライブラリは追加していません。パスワード変更/再発行はアプリ側で権限確認・更新・セッション失効・監査をまとめてトランザクション化しています。

## Vercelビルド

`vercel.json` の `buildCommand` は `npm run build` を指定しています。`prebuild` によるOpenCVランタイムの配信準備を含めてビルドするため、`next build` の直接実行へ変更しないでください。

`.vercelignore` はテスト本体とPlaywright/Vitestの設定ファイルをまとめて除外します。テストディレクトリだけを除外すると、残った `playwright.config.ts` の `tests/e2e/support` 参照が解決できず、Vercelだけで型検査が失敗します。アプリの型検査を無効にして回避しません。通常のCI・Dockerビルドではテスト一式を保持して検証します。

修正を反映する際は、古いデプロイの再実行ではなく、修正コミットを含む最新のPreviewを確認してください。型検査を通過した後も、この文書の環境変数・DB準備は別途必要です。

## API契約

名刺・下書きのAPIはGoogleチーム版から変更していません。認証とメンバー画面の呼び出し元を次の契約へ更新しました。

| API | ID方式での入力・出力 |
| --- | --- |
| `POST /api/auth/sign-in/username` | `{username,password}`。Better AuthのDBセッションcookieを発行。公開自己登録は不可 |
| `POST /api/members` | 管理者のみ。`{username,name,role}` → `{userId,username,temporaryPassword}`（201）。Google方式では従来の `{email,role}` による招待を維持 |
| `POST /api/members/:id/credentials` | 管理者のみ。既存IDがなければ `{username}` を指定。ID設定済みなら `{}` でも可。新しい一時パスワードを返し、本人の全セッションを失効 |
| `POST /api/account/password` | 本人のみ。`{currentPassword,newPassword}` → `{ok:true}`。全セッションを失効し、再ログインが必要 |

一時パスワードの変更前に名刺等を利用すると、共通エラー形式で403 `PASSWORD_CHANGE_REQUIRED` を返し、画面は `/settings/account` に案内します。新しい更新APIもOriginを検証し、秘密を返すレスポンスはno-storeです。

## ロールバック

コードのロールバックはDBの削除を伴いません。`003` の追加列を残したままGoogle版コードへ戻すことはできますが、Google資格情報のない新メンバーはログインできません。

旧共有パスワード版へ切り戻す場合、旧 `public.cards` と旧画像は残っています。ただし新版で登録・編集・削除した差分は自動的に旧版へ反映されません。書き込み・cleanupを止めて両方をバックアップし、差分と権限を照合してから切り戻してください。通常は新スキーマを保持した修正リリースを優先します。旧テーブルやスキーマをDROPしないでください。
