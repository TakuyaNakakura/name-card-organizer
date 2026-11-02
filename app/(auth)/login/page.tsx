import { GoogleLoginButton } from "@/components/auth/auth-actions";
import { sanitizeNextPath } from "@/lib/url";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="login-page">
      <section className="panel login-panel">
        <p className="eyebrow">チームで使う名刺管理</p>
        <h1>名刺インボックス</h1>
        <p>
          名刺を読み取り、内容を確認してチームに共有できます。未登録の下書きは自分だけに表示されます。
        </p>
        {params.reason && (
          <p className="notice" role="status">
            招待済みのGoogleアカウントでログインしてください。招待の有効期限は7日間です。参加できない場合は管理者に連絡してください。
          </p>
        )}
        <GoogleLoginButton
          nextPath={sanitizeNextPath(params.next || "/cards")}
        />
        <p className="hint">
          名刺画像は保存先ストレージへ送信され、文字の読み取りにはGoogle Cloud
          Visionを使用します。共有する前に本人の情報と内容を確認してください。
        </p>
      </section>
    </main>
  );
}
