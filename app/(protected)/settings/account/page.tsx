import { PasswordSettings } from "@/components/auth/password-settings";
import { getTeamAuthMode } from "@/lib/auth-config";
import { requirePageSession } from "@/lib/http";
export default async function AccountPage() {
  const session = await requirePageSession("/settings/account", true);
  return (
    <main className="stack">
      <header className="page-heading">
        <h1>アカウント</h1>
        <p>
          {session.name}
          {session.username ? ` / ユーザーID: ${session.username}` : ""}
        </p>
      </header>
      {getTeamAuthMode() === "password" ? (
        <PasswordSettings required={Boolean(session.passwordChangeRequired)} />
      ) : (
        <p className="notice">
          Googleアカウントでログインしています。パスワードはGoogleで管理してください。
        </p>
      )}
    </main>
  );
}
