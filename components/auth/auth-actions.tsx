"use client";
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { useState } from "react";
import { usernameHint } from "@/lib/credential-policy";
const authClient = createAuthClient({
  plugins: [usernameClient({ displayUsername: false })],
});

export function PasswordLoginForm({ nextPath }: { nextPath: string }) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const result = await authClient.signIn.username({
            username: username.trim(),
            password,
          });
          if (result.error) {
            setError(
              result.error.status === 429
                ? "試行回数が上限に達しました。しばらく待ってから再試行してください。"
                : "ユーザーIDまたはパスワードが正しくないか、利用が停止されています。",
            );
          } else {
            window.location.assign(nextPath);
            return;
          }
        } catch {
          setError("接続できませんでした。もう一度お試しください。");
        }
        setBusy(false);
      }}
    >
      <div className="field">
        <label htmlFor="login-username">
          ユーザーID <span className="required">必須</span>
        </label>
        <input
          id="login-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={32}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-describedby="username-hint"
        />
        <p id="username-hint" className="hint">
          {usernameHint}
        </p>
      </div>
      <div className="field">
        <label htmlFor="login-password">
          パスワード <span className="required">必須</span>
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "ログイン中…" : "ログイン"}
      </button>
      <p className="hint">
        アカウントの追加・パスワードの再発行はチーム管理者に依頼してください。
      </p>
    </form>
  );
}
export function GoogleLoginButton({ nextPath }: { nextPath: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        className="primary-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await authClient.signIn.social({
              provider: "google",
              callbackURL: nextPath,
              errorCallbackURL: "/login?reason=NOT_INVITED",
            });
            if (result.error) {
              setError(
                "ログインを開始できませんでした。Google認証の設定を管理者に確認してください。",
              );
              setBusy(false);
            }
          } catch {
            setError("接続できませんでした。もう一度お試しください。");
            setBusy(false);
          }
        }}
      >
        {busy ? "Googleに接続中…" : "Googleアカウントでログイン"}
      </button>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
    </>
  );
}
export function LogoutButton() {
  return (
    <button
      className="ghost-button"
      onClick={async () => {
        const result = await authClient.signOut();
        if (!result.error) window.location.assign("/login");
      }}
    >
      ログアウト
    </button>
  );
}
