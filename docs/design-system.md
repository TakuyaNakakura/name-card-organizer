# Local Design System

デジタル庁デザインシステム (DADS) v2.18.2 を基にした、このサービス専用のローカル実装です。公式ライブラリそのもの、またはデジタル庁の公式サービスではありません。

- 基準: https://design.digital.go.jp/dads/guidance/local-design-system/
- ボタン: https://design.digital.go.jp/dads/components/button/
- 公式HTML実装: https://github.com/digital-go-jp/design-system-example-components-html
- 参照コミット: `caa50d731cf515cfa5eae0093121f11ac5299235`
- 参照ソース: `src/components/button/button.css`, `src/components/input-text/input-text.css`, `src/global.css`
- 改変: ReactのネイティブHTML要素と既存クラスへ適用。ボタンの階層、48px以上の高さ、黒4pxアウトラインと黄のフォーカス、白背景・青のキー色、入力ラベルとエラー関連付けを採用。レイアウトは名刺の画像確認に最適化。
- モード選択は単純な2択なので、独自ARIAウィジェットではなくネイティブラジオグループ。矢印キーで選択でき、処理中はfieldsetごと無効化。
- 日本語フォント: `@fontsource-variable/noto-sans-jp` により同一オリジン配信。外部Google Fontsへのリクエストは不要。
- `app/globals.css` で色・角丸・共通コントロールを定義。パネルの見た目だけでなく、ラベル、見出し階層、スキップリンク、現在ページ、状態通知、エラーの意味を統一。
- MITライセンス: `licenses/dads-LICENSE.txt`。Noto Sans JPのライセンスは配布パッケージ内のOFLを参照。

リリース前に320px幅・200%ズーム・キーボード・iPhone VoiceOver/Android TalkBackで確認してください。自動チェックだけでDADS/WCAG/JIS適合を宣言しません。
