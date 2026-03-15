"use client";

import {
  useEffect,
  useRef,
  useState,
  startTransition,
  type ChangeEvent
} from "react";
import { useRouter } from "next/navigation";

import {
  areQuadsStable,
  normalizeQuadrilateral,
  scoreQuadrilateral,
  type Point,
  type Quadrilateral
} from "@/lib/card-detection";
import type { CardDraft, CardRecord } from "@/lib/types";

type OpenCvModule = Record<string, any>;
type CameraStatus =
  | "idle"
  | "starting"
  | "live"
  | "unsupported"
  | "permission-denied"
  | "error";

const ANALYSIS_INTERVAL_MS = 220;
const MAX_UPLOAD_DIMENSION = 1800;
const MAX_UPLOAD_BYTES = 1_800_000;
const INITIAL_UPLOAD_QUALITY = 0.84;
const MIN_UPLOAD_QUALITY = 0.68;
const MIN_UPLOAD_DIMENSION = 1200;

declare global {
  interface Window {
    cv?: OpenCvModule;
  }
}

function toBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.92
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to convert canvas to blob"));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

async function loadImageElement(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  await image.decode();
  return { image, objectUrl };
}

async function ensureCvRuntime() {
  if (window.cv && typeof window.cv.getBuildInformation === "function") {
    return window.cv;
  }

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-opencv-runtime="true"]'
    );

    const handleReady = () => {
      const cv = window.cv;
      if (!cv) {
        reject(new Error("OpenCV runtime did not initialize"));
        return;
      }

      if (typeof cv.getBuildInformation === "function") {
        resolve();
        return;
      }

      const previous = cv.onRuntimeInitialized;
      cv.onRuntimeInitialized = () => {
        previous?.();
        resolve();
      };
    };

    if (existingScript) {
      if (window.cv) {
        handleReady();
      } else {
        existingScript.addEventListener("load", handleReady, { once: true });
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Failed to load OpenCV runtime")),
          { once: true }
        );
      }

      return;
    }

    const script = document.createElement("script");
    script.src = "/api/opencv/runtime";
    script.async = true;
    script.dataset.opencvRuntime = "true";
    script.addEventListener("load", handleReady, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load OpenCV runtime")),
      { once: true }
    );
    document.body.append(script);
  });

  return window.cv as OpenCvModule;
}

function extractQuadFromApprox(approx: any): Quadrilateral | null {
  const values = Array.from(approx.data32S ?? []) as number[];
  if (values.length < 8) {
    return null;
  }

  const points = Array.from({ length: 4 }, (_, index) => ({
    x: values[index * 2],
    y: values[index * 2 + 1]
  }));

  try {
    return normalizeQuadrilateral(points);
  } catch {
    return null;
  }
}

function detectQuad(cv: OpenCvModule, canvas: HTMLCanvasElement) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 70, 180, 3, false);
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );

    let bestQuad: Quadrilateral | null = null;
    let bestScore = 0;

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const approx = new cv.Mat();

      try {
        const area = cv.contourArea(contour);
        if (area < canvas.width * canvas.height * 0.08) {
          continue;
        }

        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, perimeter * 0.02, true);

        if (approx.rows !== 4 || !cv.isContourConvex(approx)) {
          continue;
        }

        const quad = extractQuadFromApprox(approx);
        if (!quad) {
          continue;
        }

        const score = scoreQuadrilateral(quad, canvas.width, canvas.height);
        if (score > bestScore) {
          bestScore = score;
          bestQuad = quad;
        }
      } finally {
        contour.delete();
        approx.delete();
      }
    }

    return bestScore >= 0.08 ? bestQuad : null;
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

async function warpPerspective(
  cv: OpenCvModule,
  source: HTMLCanvasElement,
  quad: Quadrilateral
) {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad.points;
  const width = Math.round(
    Math.max(
      Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
      Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y)
    )
  );
  const height = Math.round(
    Math.max(
      Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y),
      Math.hypot(bottomRight.x - topRight.x, bottomRight.y - topRight.y)
    )
  );

  const src = cv.imread(source);
  const destination = new cv.Mat();
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeft.x,
    topLeft.y,
    topRight.x,
    topRight.y,
    bottomRight.x,
    bottomRight.y,
    bottomLeft.x,
    bottomLeft.y
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    width,
    0,
    width,
    height,
    0,
    height
  ]);
  const matrix = cv.getPerspectiveTransform(srcTri, dstTri);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = Math.max(width, 1);
  outputCanvas.height = Math.max(height, 1);

  try {
    cv.warpPerspective(
      src,
      destination,
      matrix,
      new cv.Size(outputCanvas.width, outputCanvas.height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar()
    );
    cv.imshow(outputCanvas, destination);
    return outputCanvas;
  } finally {
    src.delete();
    destination.delete();
    srcTri.delete();
    dstTri.delete();
    matrix.delete();
  }
}

function resizeCanvasToMaxDimension(
  sourceCanvas: HTMLCanvasElement,
  maxDimension: number
) {
  const longestSide = Math.max(sourceCanvas.width, sourceCanvas.height);
  if (longestSide <= maxDimension) {
    return sourceCanvas;
  }

  const scale = maxDimension / longestSide;
  const resizedCanvas = document.createElement("canvas");
  resizedCanvas.width = Math.max(Math.round(sourceCanvas.width * scale), 1);
  resizedCanvas.height = Math.max(Math.round(sourceCanvas.height * scale), 1);
  const context = resizedCanvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context is unavailable");
  }

  context.drawImage(sourceCanvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
  return resizedCanvas;
}

async function createUploadBlob(sourceCanvas: HTMLCanvasElement) {
  let maxDimension = MAX_UPLOAD_DIMENSION;
  let quality = INITIAL_UPLOAD_QUALITY;
  let workingCanvas = resizeCanvasToMaxDimension(sourceCanvas, maxDimension);
  let blob = await toBlob(workingCanvas, "image/jpeg", quality);

  while (
    blob.size > MAX_UPLOAD_BYTES &&
    (quality > MIN_UPLOAD_QUALITY || maxDimension > MIN_UPLOAD_DIMENSION)
  ) {
    if (quality > MIN_UPLOAD_QUALITY) {
      quality = Math.max(Number((quality - 0.06).toFixed(2)), MIN_UPLOAD_QUALITY);
    } else {
      maxDimension = Math.max(Math.floor(maxDimension * 0.85), MIN_UPLOAD_DIMENSION);
      workingCanvas = resizeCanvasToMaxDimension(sourceCanvas, maxDimension);
    }

    blob = await toBlob(workingCanvas, "image/jpeg", quality);
  }

  return blob;
}

function mapQuadToSource(
  quad: Quadrilateral,
  sourceWidth: number,
  sourceHeight: number,
  analysisWidth: number,
  analysisHeight: number
): Quadrilateral {
  const scaleX = sourceWidth / Math.max(analysisWidth, 1);
  const scaleY = sourceHeight / Math.max(analysisHeight, 1);

  return {
    points: quad.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY
    })) as [Point, Point, Point, Point]
  };
}

function quadToPolygon(quad: Quadrilateral | null) {
  if (!quad) {
    return "";
  }

  return quad.points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function ScanWorkbench() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameHandleRef = useRef<number | null>(null);
  const lastAnalysisAtRef = useRef(0);
  const lastQuadRef = useRef<Quadrilateral | null>(null);
  const stableCountRef = useRef(0);
  const cvRef = useRef<OpenCvModule | null>(null);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraMessage, setCameraMessage] = useState("カメラを起動すると名刺の枠を自動検出します。");
  const [cvReady, setCvReady] = useState(false);
  const [liveQuad, setLiveQuad] = useState<Quadrilateral | null>(null);
  const [lockedQuad, setLockedQuad] = useState<Quadrilateral | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [networkState, setNetworkState] = useState<
    "idle" | "uploading" | "saving"
  >("idle");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    let cancelled = false;

    ensureCvRuntime()
      .then((cv) => {
        if (cancelled) {
          return;
        }

        cvRef.current = cv;
        setCvReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setCameraMessage("OpenCV の読み込みに失敗しました。画像アップロードは利用できます。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (frameHandleRef.current) {
        cancelAnimationFrame(frameHandleRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!draft) {
      setFullName("");
      setEmail("");
      return;
    }

    setFullName(draft.fullName ?? "");
    setEmail(draft.email ?? "");
  }, [draft]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (cameraStatus !== "live") {
      return;
    }

    const tick = (timestamp: number) => {
      const video = videoRef.current;
      const canvas = analysisCanvasRef.current;
      const cv = cvRef.current;

      if (video && canvas && cv) {
        if (timestamp - lastAnalysisAtRef.current >= ANALYSIS_INTERVAL_MS) {
          lastAnalysisAtRef.current = timestamp;

          const sourceWidth = video.videoWidth;
          const sourceHeight = video.videoHeight;
          if (sourceWidth && sourceHeight) {
            const scale = Math.min(640 / sourceWidth, 1);
            canvas.width = Math.max(Math.round(sourceWidth * scale), 1);
            canvas.height = Math.max(Math.round(sourceHeight * scale), 1);

            const context = canvas.getContext("2d");
            if (context) {
              context.drawImage(video, 0, 0, canvas.width, canvas.height);

              const nextQuad = detectQuad(cv, canvas);
              setLiveQuad(nextQuad);

              if (nextQuad && areQuadsStable(lastQuadRef.current, nextQuad)) {
                stableCountRef.current += 1;
              } else {
                stableCountRef.current = nextQuad ? 1 : 0;
              }

              if (nextQuad && stableCountRef.current >= 3) {
                setLockedQuad(nextQuad);
                setCameraMessage("名刺枠をロックしました。撮影できます。");
              } else if (!nextQuad) {
                setLockedQuad(null);
                setCameraMessage("名刺全体が入るようにカメラ位置を調整してください。");
              } else {
                setLockedQuad(null);
                setCameraMessage(
                  "枠を安定化しています。名刺をまっすぐ保ってください。"
                );
              }

              lastQuadRef.current = nextQuad;
            }
          }
        }
      }

      frameHandleRef.current = requestAnimationFrame(tick);
    };

    frameHandleRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameHandleRef.current) {
        cancelAnimationFrame(frameHandleRef.current);
      }
    };
  }, [cameraStatus]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("unsupported");
      setCameraMessage("このブラウザではカメラ取得がサポートされていません。");
      return;
    }

    setCameraStatus("starting");
    setSaveError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        throw new Error("Video element is unavailable");
      }

      video.srcObject = stream;
      await video.play();
      setCameraStatus("live");
      setCameraMessage(
        cvReady
          ? "名刺全体が画面に入るように合わせてください。"
          : "OpenCV を読み込み中です。読み込み後に枠検出を開始します。"
      );
    } catch (error) {
      console.error(error);
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setCameraStatus(denied ? "permission-denied" : "error");
      setCameraMessage(
        denied
          ? "カメラ権限が拒否されました。ブラウザ設定を確認してください。"
          : "カメラを起動できませんでした。画像アップロードを試してください。"
      );
    }
  }

  async function submitScan(originalBlob: Blob, correctedBlob: Blob) {
    setNetworkState("uploading");
    setSaveError(null);

    const formData = new FormData();
    formData.append("originalImage", originalBlob, "original.jpg");
    formData.append("correctedImage", correctedBlob, "corrected.jpg");

    const response = await fetch("/api/scans", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error || "名刺の解析に失敗しました");
    }

    const nextDraft = (await response.json()) as CardDraft;
    setDraft(nextDraft);
    setNetworkState("idle");
  }

  async function handleCapture() {
    const video = videoRef.current;
    const canvas = analysisCanvasRef.current;

    if (!video || !canvas) {
      return;
    }

    try {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = video.videoWidth;
      sourceCanvas.height = video.videoHeight;
      const context = sourceCanvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas context is unavailable");
      }

      context.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
      const originalBlob = await createUploadBlob(sourceCanvas);
      const activeQuad = lockedQuad ?? liveQuad;
      const correctedBlob =
        activeQuad && cvRef.current
          ? await createUploadBlob(
              await warpPerspective(
                cvRef.current,
                sourceCanvas,
                mapQuadToSource(
                  activeQuad,
                  sourceCanvas.width,
                  sourceCanvas.height,
                  canvas.width,
                  canvas.height
                )
              )
            )
          : originalBlob;

      await submitScan(originalBlob, correctedBlob);
    } catch (error) {
      console.error(error);
      setNetworkState("idle");
      setSaveError(
        error instanceof Error ? error.message : "撮影画像の処理に失敗しました"
      );
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSaveError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    try {
      const { image, objectUrl } = await loadImageElement(file);
      setPreviewUrl(objectUrl);
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const sourceContext = sourceCanvas.getContext("2d");
      if (!sourceContext) {
        throw new Error("Canvas context is unavailable");
      }

      sourceContext.drawImage(image, 0, 0);
      const originalBlob = await createUploadBlob(sourceCanvas);

      let correctedBlob = originalBlob;
      if (cvRef.current) {
        const analysisCanvas = document.createElement("canvas");
        const scale = Math.min(640 / image.naturalWidth, 1);
        analysisCanvas.width = Math.max(Math.round(image.naturalWidth * scale), 1);
        analysisCanvas.height = Math.max(Math.round(image.naturalHeight * scale), 1);
        const analysisContext = analysisCanvas.getContext("2d");
        if (analysisContext) {
          analysisContext.drawImage(
            image,
            0,
            0,
            analysisCanvas.width,
            analysisCanvas.height
          );
          const quad = detectQuad(cvRef.current, analysisCanvas);
          if (quad) {
            correctedBlob = await createUploadBlob(
              await warpPerspective(
                cvRef.current,
                sourceCanvas,
                mapQuadToSource(
                  quad,
                  sourceCanvas.width,
                  sourceCanvas.height,
                  analysisCanvas.width,
                  analysisCanvas.height
                )
              )
            );
          }
        }
      }

      await submitScan(originalBlob, correctedBlob);
    } catch (error) {
      console.error(error);
      setSaveError(
        error instanceof Error ? error.message : "アップロード画像の処理に失敗しました"
      );
      setNetworkState("idle");
    } finally {
      event.target.value = "";
    }
  }

  async function handleSave() {
    if (!draft) {
      return;
    }

    setNetworkState("saving");
    setSaveError(null);

    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          draftToken: draft.draftToken,
          fullName: fullName.trim() || null,
          email: email.trim()
        })
      });

      if (!response.ok) {
        throw new Error("保存に失敗しました");
      }

      const card = (await response.json()) as CardRecord;
      startTransition(() => {
        router.push(`/cards?highlight=${card.id}`);
      });
    } catch (error) {
      console.error(error);
      setNetworkState("idle");
      setSaveError("保存できませんでした。入力値を確認してください。");
    }
  }

  return (
    <div className="grid grid--two">
      <section className="panel">
        <div className="panel__body stack">
          <div>
            <h2 className="section-title">1. 撮影またはアップロード</h2>
            <p className="section-subtitle">
              カメラで名刺を画面いっぱいに収めると、輪郭を検出して補正します。
            </p>
          </div>
          <div className="preview-frame">
            {cameraStatus === "live" ? (
              <video ref={videoRef} playsInline muted />
            ) : previewUrl ? (
              <img alt="アップロードした名刺のプレビュー" src={previewUrl} />
            ) : (
              <div className="preview-empty">
                <p>カメラを起動するか画像を選択してください</p>
              </div>
            )}
            <svg
              className="preview-overlay"
              viewBox={`0 0 ${analysisCanvasRef.current?.width || 640} ${
                analysisCanvasRef.current?.height || 480
              }`}
              preserveAspectRatio="none"
            >
              {(lockedQuad ?? liveQuad) ? (
                <polygon points={quadToPolygon(lockedQuad ?? liveQuad)} />
              ) : null}
            </svg>
          </div>
          <canvas ref={analysisCanvasRef} hidden />
          <div className="inline">
            <button
              className="primary-button"
              onClick={startCamera}
              type="button"
              disabled={cameraStatus === "starting"}
            >
              {cameraStatus === "live" ? "カメラ再起動" : "カメラを起動"}
            </button>
            <button
              className="secondary-button"
              onClick={handleCapture}
              type="button"
              disabled={cameraStatus !== "live" || networkState !== "idle"}
            >
              撮影して解析
            </button>
            <label className="ghost-button" htmlFor="upload-card">
              画像を選択
            </label>
            <input
              id="upload-card"
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={handleUpload}
            />
          </div>
          <div className={lockedQuad ? "status-pill" : "status-pill status-pill--warn"}>
            {cameraMessage}
          </div>
          <ul className="info-list">
            <li>OpenCV 状態: {cvReady ? "読み込み完了" : "読み込み中"}</li>
            <li>検出状態: {lockedQuad ? "名刺枠ロック済み" : "未ロック"}</li>
            <li>
              入力方法: {cameraStatus === "live" ? "カメラ" : previewUrl ? "画像アップロード" : "未選択"}
            </li>
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body stack">
          <div>
            <h2 className="section-title">2. 抽出結果を確認</h2>
            <p className="section-subtitle">
              OCR で抽出した名前とメールアドレスを確認して保存します。
            </p>
          </div>

          {saveError ? <div className="status-pill status-pill--warn">{saveError}</div> : null}

          {draft ? (
            <div className="stack">
              <img
                alt="補正済みの名刺プレビュー"
                className="review-image"
                src={draft.correctedImageUrl}
              />
              {draft.warnings.length > 0 ? (
                <ul className="warning-list">
                  {draft.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <div className="status-pill">抽出候補を確認してください</div>
              )}
              <div className="field">
                <label htmlFor="fullName">名前</label>
                <input
                  id="fullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="山田 太郎"
                />
              </div>
              <div className="field">
                <label htmlFor="email">メールアドレス</label>
                <input
                  id="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  type="email"
                />
              </div>
              <div className="inline">
                <span className="status-pill">
                  抽出確度 {Math.round(draft.confidence * 100)}%
                </span>
                <button
                  className="primary-button"
                  type="button"
                  disabled={networkState !== "idle" || email.trim().length === 0}
                  onClick={handleSave}
                >
                  {networkState === "saving" ? "保存中..." : "保存する"}
                </button>
              </div>
              <div className="field">
                <label htmlFor="rawOcrText">OCR テキスト</label>
                <textarea
                  id="rawOcrText"
                  readOnly
                  value={draft.rawOcrText}
                />
              </div>
            </div>
          ) : (
            <div className="split-banner">
              <p className="section-subtitle">
                まだ解析結果はありません。撮影またはアップロード後に候補がここに表示されます。
              </p>
              <div className="inline muted">
                <span>処理状態:</span>
                <strong>
                  {networkState === "uploading" ? "OCR 実行中" : "待機中"}
                </strong>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
