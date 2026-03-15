import Link from "next/link";

export default function ProtectedLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="shell">
      <div className="shell__frame">
        <header className="topbar">
          <div className="brand">
            <span className="brand__eyebrow">Name Card Organizer</span>
            <h1 className="brand__title">名刺インボックス</h1>
          </div>
          <nav className="nav">
            <Link href="/scan">スキャン</Link>
            <Link href="/cards">一覧</Link>
            <form action="/api/auth/logout" method="post">
              <button className="ghost-button" type="submit">
                ログアウト
              </button>
            </form>
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}
