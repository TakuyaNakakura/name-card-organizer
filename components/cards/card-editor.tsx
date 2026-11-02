"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { jsonBody, requestJson } from "@/lib/api-client";
import { contactFieldErrors } from "@/lib/contact-fields";
import type { TeamCard, ContactFields } from "@/lib/team-types";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
export function CardEditor({ card }: { card: TeamCard }) {
  const router = useRouter(),
    [fields, setFields] = useState<ContactFields>({
      fullName: card.fullName,
      organization: card.organization,
      jobTitle: card.jobTitle,
      email: card.email,
    });
  const [version, setVersion] = useState(card.version),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [saved, setSaved] = useState(JSON.stringify(fields));
  useUnsavedGuard(busy || JSON.stringify(fields) !== saved);
  const errors = contactFieldErrors(fields),
    labels = {
      fullName: "名前",
      organization: "所属",
      jobTitle: "役職",
      email: "メールアドレス",
    };
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || Object.keys(errors).length) return;
        setBusy(true);
        setError("");
        try {
          const next = await requestJson<TeamCard>(
            `/api/cards/${card.id}`,
            jsonBody({ ...fields, version }, "PATCH"),
          );
          setVersion(next.version);
          setSaved(JSON.stringify(fields));
          setMessage("更新しました。チーム全員に反映されます。");
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "更新できませんでした。");
        } finally {
          setBusy(false);
        }
      }}
    >
      {(Object.keys(labels) as (keyof ContactFields)[]).map((key) => (
        <div className="field" key={key}>
          <label htmlFor={`card-${key}`}>
            {labels[key]} <span className="optional">任意</span>
          </label>
          <input
            id={`card-${key}`}
            type={key === "email" ? "email" : "text"}
            value={fields[key]}
            disabled={!card.canEdit || busy}
            maxLength={500}
            aria-invalid={Boolean(errors[key])}
            aria-describedby={errors[key] ? `card-error-${key}` : undefined}
            onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
          />
          {errors[key] && (
            <p className="field-error" id={`card-error-${key}`}>
              {errors[key]}
            </p>
          )}
        </div>
      ))}
      {card.canEdit ? (
        <button
          type="submit"
          className="primary-button"
          disabled={busy || Object.keys(errors).length > 0}
        >
          {busy ? "更新中…" : "変更をチームに反映"}
        </button>
      ) : (
        <p className="notice">登録者または管理者だけが編集・削除できます。</p>
      )}
      {message && (
        <p className="success-banner" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}{" "}
          入力は画面に残っています。競合した場合は最新の内容と比較してください。
        </p>
      )}
    </form>
  );
}
