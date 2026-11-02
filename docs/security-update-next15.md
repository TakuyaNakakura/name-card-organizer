# Next.js 15 セキュリティ更新

確認日: 2026-11-02。ユーザー承認に基づき、Next.js 15系内で更新しました。本番デプロイ・本番DB操作・資格情報の変更はしていません。

## 変更

- Next.js: `15.5.12` → `15.5.28`。`package.json` も正確なバージョンへ固定し、lockfileを更新。
- Next.js配下のPostCSS: `8.4.31` → `8.5.32`。Next.js 15.5.28自体が旧版を固定しているため、`overrides.next.postcss` で8系の修正版を指定。
- Sharp: 既存の `0.35.5` を維持。Next.jsからもこの修正版が解決されることを試験。
- バージョン下限と実際の解決先を確認する試験を3件追加。Next.jsの15系・PostCSSの8系を維持しつつ、脆弱な版への戻りを検出。
- アプリの機能・API契約・DBスキーマ・環境変数・ポートは変更なし。ReactやTypeScriptも更新していません。

Next.jsの公式通知は15.5.28を修正版として案内しています。[Next.js公式セキュリティ通知](https://nextjs.org/blog/nextjs-security-update-october-14-2026)

PostCSSの指摘にはsource mapを介したファイル開示が含まれ、後続修正は8.5.23で提供されています。[PostCSSの公式アドバイザリ](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp)

今後Next.jsを更新するときはPostCSSのoverrideも再評価してください。Next.js側が安全なPostCSSを採用した場合は、互換性と監査結果を確認して不要なoverrideを除去します。

## 監査結果

`npm audit --omit=dev --audit-level=high` は終了コード0。

| 対象 | Critical | High | Moderate |
| --- | --- | --- | --- |
| 更新前の本番依存 | 1 | 1 | 6 |
| 更新後の本番依存 | 0 | 0 | 6 |
| 更新後の全依存（開発用を含む） | 2 | 1 | 7 |

本番依存の残件は `gaxios`, `gcp-metadata`, `glob`, `google-gax`, `minimatch`, `rimraf` のModerate指摘です。開発依存には `vitest`, `tinypool` のCritical、`vite` のHigh、`@vitest/mocker` のModerateが残っています。今回のNext.js更新とは分けて評価・対応する必要があります。「脆弱性がすべて0件になった」という結果ではありません。

## 互換性検証

- Next.js 15.5.28のホスト本番ビルドと、Node 24 / AlpineのDockerイメージビルド。
- Node 24コンテナの単体/API試験42件、専用PostgreSQLの結合試験11件。
- モバイル向けE2E 8件。認可済みセッションでの読み取り・下書きの自動保存・単発/連続・一括登録・一覧・編集・CSV・ごみ箱復元を確認。
- E2Eのカメラは模擬動画、枠検出は実OpenCV、OCRはモック。実Google認証・Vision・R2・実機の最終試験は今回も未実施。
- GitHub Actionsの定義は維持。本番依存のHigh以上を検出する監査コマンドはローカルでも検証。GitHubへのpush/CI実行はしていません。

テストDBは `name_card_test` のみを使用します。稼働中サービスや本番Neonへ接続しません。ロールバックのために脆弱な15.5.12をそのまま再公開しないでください。今回DB変更はないため、DBの切り戻しは不要です。
