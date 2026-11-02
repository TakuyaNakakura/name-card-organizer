"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { areQuadsStable, type Quadrilateral } from "@/lib/card-detection";
import {
  captured,
  freshCaptureGate,
  observeCaptureGate,
} from "@/lib/scan-state";
import { jsonBody, requestJson } from "@/lib/api-client";
import { contactFieldErrors } from "@/lib/contact-fields";
import type { TeamDraft, TeamCard } from "@/lib/team-types";
import { DraftReview } from "@/components/drafts/draft-review";
import {
  createUploadBlob,
  detectQuad,
  ensureCvRuntime,
  getCameraFailureMessage,
  loadImageElement,
  mapQuadToPreviewDisplay,
  mapQuadToSource,
  requestCameraStream,
  warpPerspective,
} from "./camera-utils";

export function ScanWorkbench({
  initialDrafts = [],
}: {
  initialDrafts?: TeamDraft[];
}) {
  const video = useRef<HTMLVideoElement>(null),
    frame = useRef<HTMLDivElement>(null),
    analysis = useRef<HTMLCanvasElement>(null),
    stream = useRef<MediaStream | null>(null);
  const cv = useRef<Record<string, any> | null>(null),
    gate = useRef({ ...freshCaptureGate }),
    inFlight = useRef(false),
    stable = useRef({ quad: null as Quadrilateral | null, count: 0, since: 0 });
  const activeQuad = useRef<Quadrilateral | null>(null),
    captureAction = useRef<() => void>(() => {}),
    mounted = useRef(true);
  const [camera, setCamera] = useState<"idle" | "starting" | "live" | "error">(
      "idle",
    ),
    [cvStatus, setCvStatus] = useState("読み込み中");
  const [mode, setMode] = useState<"single" | "batch">("single"),
    [paused, setPaused] = useState(false),
    [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState(initialDrafts);
  const [message, setMessage] = useState(
      "名刺全体を画面に入れ、端末を静止してください。",
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [quad, setQuad] = useState<Quadrilateral | null>(null),
    [locked, setLocked] = useState(false),
    [waiting, setWaiting] = useState(false),
    [preview, setPreview] = useState("");
  const [size, setSize] = useState({ width: 640, height: 480 }),
    [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialDrafts.filter((d) => d.status === "ready").map((d) => d.id)),
  );
  const current = useRef({
    mode,
    paused,
    busy,
    draftCount: drafts.length,
    dirty: dirtyIds.size,
  });
  current.current = {
    mode,
    paused,
    busy,
    draftCount: drafts.length,
    dirty: dirtyIds.size,
  };
  const inputBlocked =
    busy || dirtyIds.size > 0 || (mode === "single" && drafts.length > 0);

  useEffect(() => {
    mounted.current = true;
    ensureCvRuntime()
      .then((module) => {
        if (mounted.current) {
          cv.current = module;
          setCvStatus("読み込み完了");
        }
      })
      .catch(() => {
        if (mounted.current)
          setCvStatus("読み込み失敗。手動撮影・画像選択は利用できます");
      });
    return () => {
      mounted.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: r.width, height: r.height });
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (camera !== "live") return;
    let handle = 0,
      last = 0;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (
        now - last < 220 ||
        !video.current?.videoWidth ||
        !analysis.current ||
        !cv.current
      )
        return;
      last = now;
      const canvas = analysis.current,
        v = video.current,
        scale = Math.min(640 / v.videoWidth, 1);
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(v, 0, 0, canvas.width, canvas.height);
      let next: Quadrilateral | null = null;
      try {
        next = detectQuad(cv.current, canvas);
      } catch {
        setCvStatus("枠検出に失敗。手動撮影は利用できます");
        return;
      }
      setQuad(next);
      activeQuad.current = next;
      gate.current = observeCaptureGate(gate.current, Boolean(next));
      setWaiting(gate.current.waitingForRemoval);
      const previous = stable.current;
      if (next && areQuadsStable(previous.quad, next)) {
        previous.count++;
        previous.quad = next;
      } else {
        stable.current = { quad: next, count: next ? 1 : 0, since: now };
      }
      const isLocked = Boolean(next) && stable.current.count >= 3;
      setLocked(isLocked);
      const state = current.current;
      if (
        state.busy ||
        state.paused ||
        state.dirty ||
        gate.current.waitingForRemoval ||
        (state.mode === "single" && state.draftCount > 0)
      )
        return;
      if (isLocked && now - stable.current.since >= 900 && !inFlight.current)
        captureAction.current();
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [camera]);
  async function refreshDrafts() {
    try {
      const data = await requestJson<{ items: TeamDraft[] }>("/api/drafts");
      if (mounted.current) setDrafts(data.items);
    } catch {
      setNotice(
        "下書きの再取得ができませんでした。「自分の下書き」から確認できます。",
      );
    }
  }
  function updateDraft(next: TeamDraft) {
    setDrafts((list) => list.map((d) => (d.id === next.id ? next : d)));
  }
  function removeDraft(id: string) {
    setDrafts((list) => list.filter((d) => d.id !== id));
    markDirty(id, false);
  }
  function markDirty(id: string, dirty: boolean) {
    setDirtyIds((old) => {
      const next = new Set(old);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async function startCamera() {
    if (busy || inFlight.current) return;
    if (!window.isSecureContext) {
      setError("カメラの利用にはHTTPS接続が必要です。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "このブラウザではカメラを利用できません。画像選択をお試しください。",
      );
      return;
    }
    setCamera("starting");
    setError("");
    stream.current?.getTracks().forEach((t) => t.stop());
    try {
      const next = await requestCameraStream();
      if (!mounted.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = next;
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play();
      }
      setCamera("live");
    } catch (e) {
      setCamera("error");
      setError(getCameraFailureMessage(e));
    }
  }
  async function submitScan(original: Blob, corrected: Blob) {
    const form = new FormData();
    form.set("clientScanId", crypto.randomUUID());
    form.set("originalImage", original, "original.jpg");
    form.set("correctedImage", corrected, "corrected.jpg");
    const draft = await requestJson<TeamDraft>("/api/scans", {
      method: "POST",
      body: form,
    });
    if (mounted.current) {
      setDrafts((list) => [draft, ...list.filter((d) => d.id !== draft.id)]);
      setSelectedIds((old) => new Set([...old, draft.id]));
      setMessage("読み取りが完了しました。内容を確認してください。");
      setNotice("下書きを保存しました。まだチームには共有されていません。");
      if (current.current.mode === "single")
        requestAnimationFrame(() =>
          document.getElementById("scan-review-title")?.focus(),
        );
    }
  }
  async function capture() {
    if (
      inputBlocked ||
      inFlight.current ||
      camera !== "live" ||
      !video.current?.videoWidth
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    gate.current = captured();
    setWaiting(true);
    try {
      const source = document.createElement("canvas"),
        v = video.current;
      source.width = v.videoWidth;
      source.height = v.videoHeight;
      const context = source.getContext("2d");
      if (!context) throw new Error("撮影画像を取得できません。");
      context.drawImage(v, 0, 0);
      const original = await createUploadBlob(source),
        q = activeQuad.current;
      const corrected =
        q && cv.current && analysis.current
          ? await createUploadBlob(
              await warpPerspective(
                cv.current,
                source,
                mapQuadToSource(
                  q,
                  source.width,
                  source.height,
                  analysis.current.width,
                  analysis.current.height,
                ),
              ),
            )
          : original;
      setMessage("名刺を撮影しました。読み取り中です…");
      await submitScan(original, corrected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "撮影に失敗しました。");
      await refreshDrafts();
    } finally {
      inFlight.current = false;
      setBusy(false);
      stable.current = { quad: null, count: 0, since: 0 };
    }
  }
  captureAction.current = () => {
    void capture();
  };
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || inputBlocked || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    gate.current = captured();
    setWaiting(true);
    try {
      const { image, objectUrl } = await loadImageElement(file);
      setPreview(objectUrl);
      const source = document.createElement("canvas");
      const uploadScale = Math.min(
        1800 / image.naturalWidth,
        1800 / image.naturalHeight,
        1,
      );
      source.width = Math.max(1, Math.round(image.naturalWidth * uploadScale));
      source.height = Math.max(
        1,
        Math.round(image.naturalHeight * uploadScale),
      );
      const ctx = source.getContext("2d");
      if (!ctx) throw new Error("画像を取得できません。");
      ctx.drawImage(image, 0, 0, source.width, source.height);
      const original = await createUploadBlob(source);
      let corrected = original;
      if (cv.current) {
        const small = document.createElement("canvas"),
          scale = Math.min(640 / source.width, 1);
        small.width = Math.round(source.width * scale);
        small.height = Math.round(source.height * scale);
        small
          .getContext("2d")
          ?.drawImage(image, 0, 0, small.width, small.height);
        const q = detectQuad(cv.current, small);
        if (q)
          corrected = await createUploadBlob(
            await warpPerspective(
              cv.current,
              source,
              mapQuadToSource(
                q,
                source.width,
                source.height,
                small.width,
                small.height,
              ),
            ),
          );
      }
      await submitScan(original, corrected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像の処理に失敗しました。");
      await refreshDrafts();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function registerAll() {
    const ready = drafts.filter(
      (d) =>
        selectedIds.has(d.id) &&
        d.status === "ready" &&
        !Object.keys(contactFieldErrors(d)).length,
    );
    if (ready.length > 50) {
      setError("まとめて登録できるのは50件までです。対象を減らしてください。");
      return;
    }
    if (
      !ready.length ||
      busy ||
      dirtyIds.size ||
      !window.confirm(
        `${ready.length}件の名刺をチーム全員に共有します。内容を確認しましたか？`,
      )
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await requestJson<{
        results: {
          draftId: string;
          ok: boolean;
          error?: { message: string };
        }[];
      }>(
        "/api/cards/batch",
        jsonBody({
          items: ready.map((d) => ({ draftId: d.id, version: d.version })),
        }),
      );
      const saved = new Set(
        response.results.filter((r) => r.ok).map((r) => r.draftId),
      );
      setDrafts((list) => list.filter((d) => !saved.has(d.id)));
      setNotice(
        `${saved.size}件をチームに登録しました。未登録の下書きはこの画面に残っています。`,
      );
      const errors = response.results
        .filter((r) => !r.ok)
        .map((r) => r.error?.message);
      if (errors.length) setError(errors.join(" / "));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "登録できませんでした。下書きは残っています。",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const overlay = quad
    ? mapQuadToPreviewDisplay(
        quad,
        analysis.current?.width || 640,
        analysis.current?.height || 480,
        size.width,
        size.height,
      )
    : null;
  const guide = busy
    ? "撮影・読み取り処理中です。"
    : paused
      ? "自動撮影を一時停止しています。"
      : mode === "single" && drafts.length
        ? "下書きを登録または破棄すると、次の撮影を開始できます。"
        : waiting
          ? "撮影済みです。名刺をいったん画面から外し、次の名刺に交換してください。"
          : locked
            ? "名刺を認識しました。そのまま静止すると自動撮影します。"
            : message;
  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="scan-camera-title">
        <h2 id="scan-camera-title">1. 名刺を読み取る</h2>
        <fieldset
          className="mode-selector"
          disabled={busy || dirtyIds.size > 0}
        >
          <legend>スキャンモード</legend>
          <div className="actions">
            <label>
              <input
                type="radio"
                name="scan-mode"
                checked={mode === "single"}
                onChange={() => setMode("single")}
              />
              単発スキャン
            </label>
            <label>
              <input
                type="radio"
                name="scan-mode"
                checked={mode === "batch"}
                onChange={() => setMode("batch")}
              />
              連続スキャン
            </label>
          </div>
          <p className="hint">
            {mode === "single"
              ? "1枚ずつ内容を確認してから次の名刺を読み取ります。"
              : "名刺を入れ替えて連続で読み取り、最後にまとめて登録できます。"}{" "}
            モードを変えても下書きは消えません。
          </p>
        </fieldset>
        <div className="scan-camera-grid">
          <div className="preview-frame" ref={frame}>
            <video
              ref={video}
              autoPlay
              playsInline
              muted
              className={
                camera === "live" || camera === "starting"
                  ? ""
                  : "preview-media--hidden"
              }
            />
            {camera !== "live" &&
              camera !== "starting" &&
              (preview ? (
                <img src={preview} alt="選択した名刺" />
              ) : (
                <div className="preview-empty">
                  カメラを起動するか、画像を選択してください。
                </div>
              ))}
            <svg
              className="preview-overlay"
              aria-hidden="true"
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              {overlay && (
                <polygon
                  points={overlay.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={locked ? "#4dffb1" : "#ffdc00"}
                  strokeWidth={4}
                />
              )}
            </svg>
          </div>
          <div className="stack">
            <p className="notice" role="status" aria-live="polite">
              {guide}
            </p>
            <div className="actions">
              <button
                className="primary-button"
                disabled={busy || camera === "starting"}
                onClick={() => void startCamera()}
              >
                {camera === "live" ? "カメラ再起動" : "カメラを起動"}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setPaused((v) => !v)}
              >
                {paused ? "自動撮影を再開" : "自動撮影を一時停止"}
              </button>
              <button
                className="secondary-button"
                disabled={inputBlocked || camera !== "live"}
                onClick={() => void capture()}
              >
                手動で撮影
              </button>
            </div>
            <div className="field">
              <label htmlFor="scan-image">画像を選択</label>
              <input
                id="scan-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={inputBlocked}
                onChange={(e) => void upload(e)}
              />
            </div>
            <p className="hint">
              OpenCV：{cvStatus}
              <br />
              検出：{locked ? "名刺枠ロック済み" : "未ロック"}
            </p>
            <p className="hint">
              明るい場所で、背景と名刺に色の差をつけてください。画像はGoogle
              Cloud Visionで処理します。失敗時の再解析は自動では実行しません。
            </p>
          </div>
        </div>
        <canvas ref={analysis} hidden />
      </section>
      <section className="stack" aria-labelledby="scan-review-title">
        <div className="row row--between">
          <h2 id="scan-review-title" tabIndex={-1}>
            2. 下書きを確認して共有する（{drafts.length}件）
          </h2>
          <Link href="/drafts">自分の下書きを開く</Link>
        </div>
        <p>
          未登録の下書きは自分だけが閲覧できます。内容を編集すると自動保存されます。登録後はチーム全員に共有されます。
        </p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success-banner" role="status">
            {notice} <Link href="/cards">共有名刺一覧へ</Link>
          </p>
        )}
        {mode === "batch" && drafts.length > 0 && (
          <button
            className="primary-button"
            disabled={
              busy ||
              dirtyIds.size > 0 ||
              !drafts.some(
                (d) =>
                  selectedIds.has(d.id) &&
                  d.status === "ready" &&
                  !Object.keys(contactFieldErrors(d)).length,
              )
            }
            onClick={() => void registerAll()}
          >
            確認済みの名刺をまとめて登録（
            {
              drafts.filter(
                (d) =>
                  selectedIds.has(d.id) &&
                  d.status === "ready" &&
                  !Object.keys(contactFieldErrors(d)).length,
              ).length
            }
            件）
          </button>
        )}
        {!drafts.length && (
          <div className="empty-state">
            <h3>まだ下書きはありません</h3>
            <p>
              カメラで撮影するか画像を選択すると、読み取り結果をここに表示します。
            </p>
          </div>
        )}
        {drafts.map((d) => (
          <DraftReview
            key={d.id}
            draft={d}
            onChange={updateDraft}
            onRemove={removeDraft}
            onDirty={markDirty}
            selection={
              mode === "batch"
                ? {
                    checked: selectedIds.has(d.id),
                    onChange: (checked) =>
                      setSelectedIds((old) => {
                        const next = new Set(old);
                        if (checked) next.add(d.id);
                        else next.delete(d.id);
                        return next;
                      }),
                  }
                : undefined
            }
            onRegistered={(c: TeamCard) =>
              setNotice(
                `${c.fullName || c.organization || "名刺"}をチームに登録しました。`,
              )
            }
          />
        ))}
      </section>
    </div>
  );
}
