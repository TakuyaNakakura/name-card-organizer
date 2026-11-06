"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { MAX_UPLOAD_FILES, runUploadQueue, type UploadItem } from "@/lib/upload-queue";

const statusLabel = {
  pending: "未処理",
  processing: "読み取り中",
  succeeded: "保存済み",
  failed: "失敗",
};

export function ImageUploadQueue({ disabled, process, onBusyChange, onSelect, cropped, onCroppedChange }: {
  disabled: boolean;
  cropped: boolean;
  onCroppedChange: (cropped: boolean) => void;
  process: (item: UploadItem) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onSelect: (count: number) => void;
}) {
  const items = useRef<UploadItem[]>([]), stop = useRef(false), mounted = useRef(true), running = useRef(false);
  const [queue, setQueue] = useState<UploadItem[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = queue.filter((item) => item.status === "pending").length;
  const failed = queue.filter((item) => item.status === "failed").length;
  const succeeded = queue.filter((item) => item.status === "succeeded").length;
  const remaining = pending + failed;

  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => {
      if (running.current || items.current.some((item) => item.file)) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      mounted.current = false;
      stop.current = true;
      window.removeEventListener("beforeunload", unload);
    };
  }, []);

  async function run() {
    if (running.current) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    onBusyChange(true);
    try {
      await runUploadQueue(items.current, process, () => {
        if (mounted.current) setQueue(items.current.map((item) => ({ ...item })));
      }, () => stop.current || !mounted.current);
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  function select(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || disabled || running.current) return;
    if (files.length > MAX_UPLOAD_FILES) {
      setError(`一度に選択できる画像は${MAX_UPLOAD_FILES}枚までです。`);
      return;
    }
    setError("");
    items.current = files.map((file) => ({
      id: crypto.randomUUID(), clientScanId: crypto.randomUUID(), file, name: file.name,
      status: "pending", attempts: 0, error: "",
    }));
    setQueue(items.current.map((item) => ({ ...item })));
    onSelect(files.length);
    void run();
  }

  function resume() {
    if (disabled || running.current) return;
    for (const item of items.current) {
      if (item.status === "failed") item.status = "pending";
    }
    void run();
  }

  return <div className="stack">
    <label>
      <input type="checkbox" checked={cropped} disabled={disabled || busy}
        onChange={(event) => onCroppedChange(event.target.checked)} />
      名刺だけを長方形に切り抜いた画像
    </label>
    <p className="hint">チェックした画像は傾き補正を省略します。背景や傾きがある写真は、チェックを外して取り込んでください。</p>
    <div className="field">
      <label htmlFor="scan-image">画像を選択</label>
      <input id="scan-image" type="file" multiple accept="image/jpeg,image/png,image/webp"
        disabled={disabled || busy || remaining > 0} onChange={select} aria-describedby="upload-help" />
      <p id="upload-help" className="hint">
        JPEG・PNG・WebPを最大100枚までまとめて選択できます。1枚ずつ読み取り、下書きに保存します。
        個人100回/時・チーム150回/時、下書き100件の上限があります。
      </p>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {queue.length > 0 && <div className="stack" aria-label="画像の取り込み状況">
      <p role="status" aria-live="polite">
        {queue.length}枚中 保存済み{succeeded}枚・失敗{failed}枚・未処理{pending}枚{busy ? "（処理中）" : ""}
      </p>
      <progress aria-label="画像取り込みの進捗" max={queue.length} value={succeeded + failed} />
      <div className="actions">
        {busy ? <button className="secondary-button" onClick={() => { stop.current = true; }}>この画像の完了後に停止</button>
          : remaining > 0 && <>
            <button className="primary-button" disabled={disabled} onClick={resume}>未処理・失敗分を再開</button>
            <button className="secondary-button" disabled={disabled} onClick={() => { items.current = []; setQueue([]); }}>取り込みリストを閉じる</button>
          </>}
      </div>
      {remaining > 0 && <p className="hint">再開は利用者の操作で行います。失敗画像の再解析もOCR利用回数に含まれます。この画面を離れると未処理の写真は選び直しになります。保存済みの下書きは残ります。</p>}
      <details>
        <summary>ファイルごとの結果</summary>
        <ul>{queue.map((item) => <li key={item.id} style={{ overflowWrap: "anywhere" }}>
          {item.name}：{statusLabel[item.status]}{item.error && ` — ${item.error}`}
        </li>)}</ul>
      </details>
    </div>}
  </div>;
}
