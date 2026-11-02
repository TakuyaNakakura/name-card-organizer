"use client";
import { useEffect, useId, useRef, useState } from "react";
import { jsonBody, requestJson } from "@/lib/api-client";
import { contactFieldErrors } from "@/lib/contact-fields";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import type { ContactFields, TeamDraft, TeamCard } from "@/lib/team-types";

const fieldLabels = {
  fullName: "名前",
  organization: "所属",
  jobTitle: "役職",
  email: "メールアドレス",
} as const;
const contact = (d: ContactFields): ContactFields => ({
  fullName: d.fullName,
  organization: d.organization,
  jobTitle: d.jobTitle,
  email: d.email,
});
export function DraftReview({
  draft,
  onChange,
  onRemove,
  onDirty,
  onRegistered,
  selection,
}: {
  draft: TeamDraft;
  onChange: (d: TeamDraft) => void;
  onRemove: (id: string) => void;
  onDirty?: (id: string, dirty: boolean) => void;
  onRegistered?: (c: TeamCard) => void;
  selection?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  const id = useId(),
    [fields, setFields] = useState(contact(draft)),
    [status, setStatus] = useState("保存済み"),
    [error, setError] = useState(""),
    [acting, setActing] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0),
    [serverDraft, setServerDraft] = useState<TeamDraft | null>(null);
  const [persistedRevision, setPersistedRevision] = useState(0);
  const version = useRef(draft.version),
    saved = useRef(JSON.stringify(contact(draft))),
    latest = useRef(fields),
    saving = useRef(false),
    mounted = useRef(true);
  const callbacks = useRef({ onChange, onDirty });
  callbacks.current = { onChange, onDirty };
  latest.current = fields;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (acting) return;
    if (JSON.stringify(fields) === saved.current) {
      callbacks.current.onDirty?.(draft.id, saving.current);
      setStatus(saving.current ? "下書きを保存中…" : "保存済み");
      return;
    }
    callbacks.current.onDirty?.(draft.id, true);
    setStatus("未保存の変更があります");
    if (saving.current) return;
    const timer = setTimeout(async () => {
      if (!mounted.current) return;
      saving.current = true;
      setStatus("下書きを保存中…");
      try {
        const next = await requestJson<TeamDraft>(
          `/api/drafts/${draft.id}`,
          jsonBody({ ...fields, version: version.current }, "PATCH"),
        );
        version.current = next.version;
        saved.current = JSON.stringify(fields);
        callbacks.current.onChange(next);
        setError("");
        setPersistedRevision((v) => v + 1);
        const dirty = JSON.stringify(latest.current) !== saved.current;
        callbacks.current.onDirty?.(draft.id, dirty);
        setStatus(dirty ? "未保存の変更があります" : "保存済み");
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "下書きを保存できませんでした。入力内容は画面に残っています。",
        );
        setStatus("保存に失敗しました");
      } finally {
        saving.current = false;
        callbacks.current.onDirty?.(
          draft.id,
          JSON.stringify(latest.current) !== saved.current,
        );
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [fields, draft.id, saveAttempt, persistedRevision, acting]);
  const dirty = JSON.stringify(fields) !== saved.current,
    errors = contactFieldErrors(fields),
    canRegister =
      draft.status === "ready" &&
      !dirty &&
      !saving.current &&
      !Object.keys(errors).length;
  useUnsavedGuard(dirty || acting || saving.current);
  async function action(kind: "register" | "discard" | "retry") {
    if (acting || saving.current || (dirty && kind !== "discard")) return;
    if (
      kind === "discard" &&
      !window.confirm(
        "この下書きと画像を破棄しますか？チームには共有されません。",
      )
    )
      return;
    setActing(true);
    setError("");
    callbacks.current.onDirty?.(draft.id, true);
    let removed = false;
    try {
      if (kind === "register") {
        const card = await requestJson<TeamCard>(
          "/api/cards",
          jsonBody({ draftId: draft.id, version: version.current }),
        );
        onRegistered?.(card);
        onRemove(draft.id);
        removed = true;
      } else if (kind === "discard") {
        const r = await fetch(`/api/drafts/${draft.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error("破棄できませんでした。");
        onRemove(draft.id);
        removed = true;
      } else {
        const next = await requestJson<TeamDraft>(
          `/api/drafts/${draft.id}/retry`,
          { method: "POST" },
        );
        version.current = next.version;
        saved.current = JSON.stringify(contact(next));
        latest.current = contact(next);
        setFields(contact(next));
        onChange(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作できませんでした。");
    } finally {
      setActing(false);
      callbacks.current.onDirty?.(
        draft.id,
        !removed && JSON.stringify(latest.current) !== saved.current,
      );
    }
  }
  return (
    <article className="draft-card stack" aria-labelledby={`${id}-title`}>
      <div className="row row--between">
        <h3 id={`${id}-title`}>
          {draft.fullName || draft.organization || "読み取った名刺"}
        </h3>
        <span className="badge">自分だけの下書き</span>
      </div>
      {selection && (
        <label className="selection">
          <input
            type="checkbox"
            checked={selection.checked}
            disabled={acting || draft.status !== "ready"}
            onChange={(e) => selection.onChange(e.target.checked)}
          />
          まとめて登録する対象に含める
        </label>
      )}
      <p className="hint">
        最終更新から7日間保持。期限：
        {new Date(draft.expiresAt).toLocaleString("ja-JP")}
      </p>
      <div className="review-grid">
        {draft.correctedImageUrl && (
          <a href={draft.correctedImageUrl} target="_blank" rel="noreferrer">
            <img
              className="card-preview"
              src={draft.correctedImageUrl}
              alt="読み取った名刺。画像を開いて拡大"
            />
          </a>
        )}
        <div className="stack">
          {(Object.keys(fieldLabels) as (keyof ContactFields)[]).map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`${id}-${key}`}>
                {fieldLabels[key]} <span className="optional">任意</span>
              </label>
              <input
                id={`${id}-${key}`}
                type={key === "email" ? "email" : "text"}
                value={fields[key]}
                maxLength={500}
                disabled={acting || draft.status === "processing"}
                aria-invalid={Boolean(errors[key])}
                aria-describedby={
                  errors[key] ? `${id}-${key}-error` : undefined
                }
                onChange={(e) => {
                  callbacks.current.onDirty?.(draft.id, true);
                  setFields({ ...fields, [key]: e.target.value });
                }}
              />
              {errors[key] && (
                <p className="field-error" id={`${id}-${key}-error`}>
                  {errors[key]}
                </p>
              )}
            </div>
          ))}
          <p className="hint">
            名前・所属・メールアドレスのいずれか1つを入力すると登録できます。
          </p>
        </div>
      </div>
      {draft.warnings.length > 0 && (
        <div className="notice">
          <strong>確認してください</strong>
          <ul>
            {draft.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {draft.errorMessage && (
        <p className="error-banner">{draft.errorMessage}</p>
      )}
      {draft.status === "processing" && (
        <p className="notice" role="status">
          処理中、または通信が中断されています。90秒以上待ってから再解析できます。再解析にはOCR料金が発生します。
        </p>
      )}
      {error && (
        <div className="error-banner stack" role="alert">
          <p>{error} 入力内容はこの画面に残っています。</p>
          <div className="actions">
            <button
              className="secondary-button"
              disabled={acting}
              onClick={() => setSaveAttempt((v) => v + 1)}
            >
              下書き保存を再試行
            </button>
            <button
              className="secondary-button"
              disabled={acting}
              onClick={async () => {
                try {
                  setServerDraft(
                    await requestJson<TeamDraft>(`/api/drafts/${draft.id}`),
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "取得できませんでした。",
                  );
                }
              }}
            >
              最新の下書きと比較
            </button>
          </div>
          {serverDraft && (
            <div className="stack">
              <p>現在DBに保存されている内容</p>
              <dl>
                {(Object.keys(fieldLabels) as (keyof ContactFields)[]).map(
                  (k) => (
                    <div key={k}>
                      <dt>{fieldLabels[k]}</dt>
                      <dd>{serverDraft[k] || "未入力"}</dd>
                    </div>
                  ),
                )}
              </dl>
              <button
                className="secondary-button"
                onClick={() => {
                  if (
                    window.confirm(
                      "比較した内容を、現在入力している内容で置き換えますか？",
                    )
                  ) {
                    version.current = serverDraft.version;
                    setServerDraft(null);
                    setSaveAttempt((v) => v + 1);
                  }
                }}
              >
                比較したうえで入力内容を保存
              </button>
            </div>
          )}
        </div>
      )}
      <p className="hint" role="status">
        {status}
        {acting ? " / 処理中…" : ""}
      </p>
      <details>
        <summary>OCRで読み取ったテキスト</summary>
        <pre className="ocr-text">
          {draft.rawOcrText || "まだ読み取り結果はありません。"}
        </pre>
      </details>
      <div className="actions">
        <button
          className="primary-button"
          disabled={!canRegister || acting}
          onClick={() => void action("register")}
        >
          確認してチームに登録
        </button>
        {(draft.status === "failed" || draft.status === "processing") && (
          <button
            className="secondary-button"
            disabled={acting || dirty || saving.current}
            onClick={() => void action("retry")}
          >
            再解析する（OCR料金が発生）
          </button>
        )}
        <button
          className="danger-button"
          disabled={acting || saving.current || draft.status === "processing"}
          onClick={() => void action("discard")}
        >
          下書きを破棄
        </button>
      </div>
    </article>
  );
}
