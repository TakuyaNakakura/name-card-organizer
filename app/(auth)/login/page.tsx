import { sanitizeNextPath } from "@/lib/url";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = sanitizeNextPath(readValue(params.next), "/scan");
  const error = readValue(params.error);

  return (
    <div className="login-shell">
      <section className="panel login-card">
        <div className="panel__body stack">
          <div className="split-banner">
            <span className="brand__eyebrow">Private Access</span>
            <h1 className="brand__title">管理画面にログイン</h1>
            <p className="section-subtitle">
              このアプリは単一管理者向けです。設定したパスワードでログインしてください。
            </p>
          </div>
          {error ? (
            <div className="status-pill status-pill--warn">{error}</div>
          ) : null}
          <form className="stack" action="/api/auth/login" method="post">
            <input type="hidden" name="next" value={next} />
            <div className="field">
              <label htmlFor="password">パスワード</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <button className="primary-button" type="submit">
              ログイン
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
