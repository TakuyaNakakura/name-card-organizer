"use client";
import { useEffect } from "react";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page failed", { digest: error.digest });
  }, [error]);
  return (
    <main className="panel stack">
      <h1>画面を表示できませんでした</h1>
      <p role="alert">
        接続状態を確認し、もう一度お試しください。管理者はDBの移行状況と接続設定を確認してください。
      </p>
      {error.digest && <p className="hint">問い合わせID：{error.digest}</p>}
      <button className="primary-button" onClick={reset}>
        再試行
      </button>
    </main>
  );
}
