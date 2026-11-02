"use client";
import { createAuthClient } from "better-auth/react";
import { useState } from "react";
const authClient = createAuthClient();
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
