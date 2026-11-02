import Link from "next/link";
import { requirePageSession } from "@/lib/http";
import { LogoutButton } from "@/components/auth/auth-actions";
import { Navigation } from "@/components/navigation";
export const dynamic = "force-dynamic";
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession("/cards", true);
  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">
        本文へ移動
      </a>
      <header className="site-header">
        <div className="shell__frame">
          <div className="row row--between">
            <Link href="/cards" className="brand">
              <span className="brand__eyebrow">{session.teamName}</span>
              <span className="brand__title">名刺インボックス</span>
            </Link>
            <div className="account">
              <span>
                {session.name}{" "}
                <span className="badge">
                  {session.role === "admin" ? "管理者" : "メンバー"}
                </span>
              </span>
              <LogoutButton />
              <Link href="/settings/account">アカウント</Link>
            </div>
          </div>
          <Navigation admin={session.role === "admin"} />
        </div>
      </header>
      <div
        className="shell__frame main-content"
        id="main-content"
        tabIndex={-1}
      >
        {children}
      </div>
      <footer className="site-footer shell__frame">
        登録した名刺はチーム内で共有されます。未登録の下書きは自分だけが閲覧できます。
      </footer>
    </div>
  );
}
