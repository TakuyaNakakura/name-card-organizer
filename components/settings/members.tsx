"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { jsonBody, requestJson } from "@/lib/api-client";
type Member = {
  user_id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "suspended";
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};
export function MemberSettings({
  members,
  invitations,
}: {
  members: Member[];
  invitations: Invitation[];
}) {
  const router = useRouter(),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("member"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(task: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      setNotice(message);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-banner" role="status">
          {notice}
        </p>
      )}
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => requestJson("/api/members", jsonBody({ email, role })),
            "招待を作成しました。ログインURLを本人に伝えてください。メールは自動送信されません。",
          );
        }}
      >
        <h2>Googleアカウントを招待</h2>
        <p>
          招待されたメールアドレスと一致し、Googleで確認済みのアカウントだけが参加できます。有効期限は7日間です。
        </p>
        <div className="field">
          <label htmlFor="invite-email">
            メールアドレス <span className="required">必須</span>
          </label>
          <input
            id="invite-email"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="invite-role">権限</label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="member">メンバー</option>
            <option value="admin">管理者</option>
          </select>
        </div>
        <button className="primary-button" disabled={busy}>
          招待を作成
        </button>
      </form>
      <section className="stack">
        <h2>参加中のメンバー</h2>
        {members.map((m) => (
          <article className="panel stack" key={m.user_id}>
            <h3>{m.name}</h3>
            <p>{m.email}</p>
            <p>
              {m.role === "admin" ? "管理者" : "メンバー"} /{" "}
              {m.status === "active" ? "有効" : "停止中"}
            </p>
            <div className="actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      requestJson(
                        `/api/members/${m.user_id}`,
                        jsonBody(
                          {
                            role: m.role === "admin" ? "member" : "admin",
                            status: m.status,
                          },
                          "PATCH",
                        ),
                      ),
                    "権限を変更しました。",
                  )
                }
              >
                {m.role === "admin" ? "メンバーに変更" : "管理者に変更"}
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      m.status === "active"
                        ? "このメンバーを停止し、ログイン中のセッションを失効させますか？"
                        : "このメンバーを再度有効にしますか？",
                    )
                  )
                    void run(
                      () =>
                        requestJson(
                          `/api/members/${m.user_id}`,
                          jsonBody(
                            {
                              role: m.role,
                              status:
                                m.status === "active" ? "suspended" : "active",
                            },
                            "PATCH",
                          ),
                        ),
                      "メンバーの状態を変更しました。",
                    );
                }}
              >
                {m.status === "active" ? "利用を停止" : "利用を再開"}
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="stack">
        <h2>招待の履歴</h2>
        {invitations.map((i) => (
          <article className="panel row row--between" key={i.id}>
            <div>
              <h3>{i.email}</h3>
              <p>
                {i.role === "admin" ? "管理者" : "メンバー"} /{" "}
                {i.revoked_at
                  ? "取消済み"
                  : i.accepted_at
                    ? "参加済み"
                    : new Date(i.expires_at) < new Date()
                      ? "期限切れ"
                      : `招待中（${new Date(i.expires_at).toLocaleDateString("ja-JP")}まで）`}
              </p>
            </div>
            {!i.revoked_at && !i.accepted_at && (
              <button
                className="danger-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await fetch(`/api/invitations/${i.id}`, {
                      method: "DELETE",
                    });
                    if (!r.ok) throw new Error("招待を取り消せませんでした。");
                  }, "招待を取り消しました。")
                }
              >
                招待を取り消す
              </button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
