"use client";

import type { Route } from "next";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface DeleteCardButtonProps {
  cardId: string;
}

export function DeleteCardButton({ cardId }: DeleteCardButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmed = window.confirm("この名刺を削除しますか？");
    if (!confirmed) {
      return;
    }

    setError(null);

    const response = await fetch(`/api/cards/${cardId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; detail?: string | null }
        | null;
      setError(
        [body?.error, body?.detail].filter(Boolean).join(" / ") || "削除できませんでした"
      );
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("highlight");
    const nextHref = nextSearchParams.size
      ? `${pathname}?${nextSearchParams.toString()}`
      : pathname;

    startTransition(() => {
      router.replace(nextHref as Route);
      router.refresh();
    });
  }

  return (
    <div className="stack stack--sm card-row__actions">
      <button
        className="danger-button"
        type="button"
        onClick={handleDelete}
        disabled={isPending}
      >
        {isPending ? "削除中..." : "削除"}
      </button>
      {error ? <span className="status-pill status-pill--warn">{error}</span> : null}
    </div>
  );
}
