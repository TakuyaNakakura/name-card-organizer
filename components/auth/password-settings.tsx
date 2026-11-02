"use client";
import { useState } from "react";
import { jsonBody, requestJson } from "@/lib/api-client";
import { passwordHint } from "@/lib/credential-policy";

export function PasswordSettings({ required }: { required: boolean }) {
  const [currentPassword, setCurrent] = useState(""),
    [newPassword, setNew] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="panel stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setError("");
        if (newPassword !== confirmation) {
          setError("新しいパスワードと確認用の入力が一致しません。");
          return;
        }
        setBusy(true);
        try {
          await requestJson(
            "/api/account/password",
            jsonBody({ currentPassword, newPassword }),
          );
          setCurrent("");
          setNew("");
          setConfirmation("");
          window.location.assign("/login?reason=PASSWORD_CHANGED");
        } catch (e) {
          setError(e instanceof Error ? e.message : "変更できませんでした。");
          setBusy(false);
        }
      }}
    >
      <h2>{required ? "一時パスワードを変更" : "パスワードを変更"}</h2>
      <p>
        {required
          ? "名刺を利用する前に、自分だけが知っているパスワードへ変更してください。"
          : "変更すると、すべての端末からログアウトします。新しいパスワードでログインし直してください。"}
      </p>
      <p id="password-policy" className="hint">
        {passwordHint}
      </p>
      <div className="field">
        <label htmlFor="current-password">
          現在のパスワード <span className="required">必須</span>
        </label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">
          新しいパスワード <span className="required">必須</span>
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          aria-describedby="password-policy"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">
          新しいパスワード（確認） <span className="required">必須</span>
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "変更中…" : "変更してログアウト"}
      </button>
    </form>
  );
}
