"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson, jsonBody } from "@/lib/api-client";
export function CardActions({
  id,
  version,
  restore = false,
}: {
  id: string;
  version: number;
  restore?: boolean;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="stack">
      <button
        className={restore ? "secondary-button" : "danger-button"}
        disabled={busy}
        onClick={async () => {
          if (
            !restore &&
            !window.confirm(
              "この名刺をチームの共有一覧からごみ箱に移動します。30日以内なら復元できます。",
            )
          )
            return;
          setBusy(true);
          setError("");
          try {
            if (restore)
              await requestJson(
                `/api/cards/${id}/restore`,
                jsonBody({ version }),
              );
            else {
              const response = await fetch(
                `/api/cards/${id}`,
                jsonBody({ version }, "DELETE"),
              );
              if (!response.ok) {
                const body = await response.json();
                throw new Error(
                  body?.error?.message || "削除できませんでした。",
                );
              }
            }
            if (restore) router.refresh();
            else router.push("/cards?trashed=1");
          } catch (e) {
            setError(e instanceof Error ? e.message : "処理できませんでした。");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "処理中…" : restore ? "名刺を復元" : "ごみ箱に移動"}
      </button>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
    </div>
  );
}
