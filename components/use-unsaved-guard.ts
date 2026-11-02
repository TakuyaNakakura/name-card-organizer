"use client";
import { useEffect, useRef } from "react";
export function useUnsavedGuard(dirty: boolean) {
  const latest = useRef(dirty);
  latest.current = dirty;
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (latest.current) e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      const anchor = (e.target as Element)?.closest?.("a");
      if (
        !latest.current ||
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const next = new URL(anchor.href, location.href);
      if (
        next.pathname === location.pathname &&
        next.search === location.search
      )
        return;
      if (
        !window.confirm(
          "未保存の入力があります。この画面を離れると、保存されていない変更は失われます。移動しますか？",
        )
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, []);
}
