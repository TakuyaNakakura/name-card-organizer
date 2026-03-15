# Name Card Organizer

カメラまたは画像アップロードから名刺を取り込み、OCR で名前とメールアドレスを抽出して保存する Next.js アプリです。

## 公開前に直すべき点

- Vercel 本番では `STORAGE_DRIVER=local` を使わない。永続ファイルが残らないため、必ず S3 互換ストレージへ切り替える。
- Vercel 本番では `OCR_PROVIDER=mock` を使わない。実 OCR を使う。
- 本番では `ADMIN_PASSWORD` ではなく `ADMIN_PASSWORD_HASH` を使う。
- `secrets/` やサービスアカウント JSON はコミットしない。既に共有済みの鍵はローテーションする。
- レート制限は入れているが、強い防御が必要なら Upstash Redis などの外部レートリミッタを追加する。

## セットアップ

1. `.env.example` を `.env.local` にコピーして値を設定
2. `docker compose up -d`
3. `npm install`
4. `npm run dev`

## Docker Compose でアプリも起動する

1. `.env.compose.example` を `.env.compose.local` にコピー
2. `.env.compose.local` の `SESSION_SECRET` と `ADMIN_PASSWORD` を変更
3. `docker compose --env-file .env.compose.local up --build`
4. ブラウザで `http://localhost:3000/login` を開く

compose 起動時の主要設定:

- `DATABASE_URL_DOCKER`: app コンテナから postgres コンテナへ接続する URL
- `APP_PORT`: ホスト側の公開ポート
- `OCR_PROVIDER`: `mock` または `google`
- `STORAGE_DRIVER`: `local` または `s3`
- `GOOGLE_CLOUD_CREDENTIALS_JSON`: Google Vision 用のサービスアカウント JSON を 1 行文字列で渡す場合に使用
- `GOOGLE_APPLICATION_CREDENTIALS_HOST`: サービスアカウント JSON ファイルをマウントする場合のホスト側パス

## 実カメラの動作確認

- 同じマシンのブラウザで確認するだけなら `http://localhost:3000` でも `getUserMedia` は使えます。
- スマホ実機から確認する場合は `https://` が必須です。`http://<MacのIP>:3000` ではカメラ権限が取れません。
- スマホ確認時は次のどちらかが必要です。
  - ローカルで信頼済み証明書を使う HTTPS リバースプロキシ
  - [ngrok](https://ngrok.com/) や [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) などの HTTPS トンネル
- 追加で必要な前提:
  - カメラ利用を許可する
  - スマホと Docker ホストを同じネットワークに置く
  - Safari / Chrome の最新系で確認する

## 本物の OCR の動作確認

- `OCR_PROVIDER=google`
- Google Cloud 側で Vision API を有効化
- 課金を有効化
- Vision API を呼べるサービスアカウントを作成
- 認証情報はどちらか一方を設定
- `GOOGLE_CLOUD_CREDENTIALS_JSON`: 1 行 JSON に整形できる場合だけ使う
- `GOOGLE_APPLICATION_CREDENTIALS`: JSON ファイルをコンテナへマウントする運用向け
- 必要に応じて `GOOGLE_CLOUD_PROJECT` を設定

compose で実 OCR を試す推奨手順:

- `OCR_PROVIDER=google`
- `GOOGLE_APPLICATION_CREDENTIALS_HOST=./secrets/google-vision-key.json`
- `docker-compose.google-ocr.yml` を追加して起動する
- スマホ実機で試すなら HTTPS 公開先を別途用意する

起動例:

```bash
docker compose \
  --env-file .env.compose.local \
  -f docker-compose.yml \
  -f docker-compose.google-ocr.yml \
  up --build
```

`.env.compose.local` には複数行 JSON をそのまま書かないでください。`GOOGLE_CLOUD_CREDENTIALS_JSON` を使う場合は 1 行にエスケープする必要があります。実運用と動作確認の両方で、JSON ファイルをマウントする方法の方が安全です。

## Vercel へ公開する

1. Vercel にリポジトリを接続する
2. `.env.vercel.example` を元に Vercel の Production Environment Variables を設定する
3. DB は Neon / Supabase / Vercel Postgres などの外部 PostgreSQL を使う
4. 画像保存先は Cloudflare R2 / AWS S3 などの S3 互換ストレージを使う
5. Google Vision のサービスアカウント JSON は Vercel env に入れる
6. 初回ログイン用パスワードはハッシュ化して登録する

Vercel 本番用の必須 env:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_PASSWORD_HASH`
- `OCR_PROVIDER=google`
- `STORAGE_DRIVER=s3`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `GOOGLE_CLOUD_CREDENTIALS_JSON`
- `ENFORCE_PUBLIC_DEPLOYMENT_GUARDS=true`

補足:

- Vercel では `Preview` と `Production` の両方で公開ガードが有効になる。`mock OCR`、`local storage`、平文 `ADMIN_PASSWORD`、短い `SESSION_SECRET` は起動時に拒否される。
- 公開用 env では `ADMIN_PASSWORD` を使わず、`ADMIN_PASSWORD_HASH` だけを登録する。

パスワードハッシュ生成:

```bash
npm run admin:hash -- 'replace-with-your-password'
```

Google サービスアカウント JSON を Vercel env に入れる 1 行 JSON へ変換:

```bash
npm run google-creds:minify -- ./secrets/google-vision-key.json
```

補足:

- Vercel ではローカルファイル保存が永続化されないため、`LOCAL_UPLOAD_DIR` は使わない。
- `MAX_SCAN_IMAGE_BYTES` とクライアント側圧縮で、Vercel Functions のアップロード制限に収まるようにしている。
- `.vercelignore` を追加して、ローカルの `secrets/` や `.env.local` が CLI デプロイに混ざらないようにしている。

## 必須環境変数

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_PASSWORD` または `ADMIN_PASSWORD_HASH`

## OCR

- `OCR_PROVIDER=google`: Google Cloud Vision を使用
- `OCR_PROVIDER=mock`: `MOCK_OCR_TEXT` の内容を OCR 結果として返す

## ストレージ

- `STORAGE_DRIVER=local`: `LOCAL_UPLOAD_DIR` に保存
- `STORAGE_DRIVER=s3`: S3 互換ストレージに保存

## テスト

- `npm test`
- `npm run test:e2e`
