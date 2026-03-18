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
import type { CardDraft } from "@/lib/types";

type OpenCvModule = Record<string, any>;
type CameraStatus =
  | "idle"
  | "starting"
  | "live"
  | "unsupported"
  | "secure-context-required"
  | "permission-denied"
  | "error";

type ScanMode = "single" | "batch";

const ANALYSIS_INTERVAL_MS = 220;
const AUTO_CAPTURE_DELAY_MS = 900;
const MIN_CONTOUR_AREA_RATIO = 0.035;
const MIN_ACCEPTABLE_QUAD_SCORE = 0.05;
const APPROX_EPSILON_FACTORS = [0.015, 0.02, 0.03, 0.04];
const MAX_UPLOAD_DIMENSION = 1800;
const MAX_UPLOAD_BYTES = 1_800_000;
const INITIAL_UPLOAD_QUALITY = 0.84;
const MIN_UPLOAD_QUALITY = 0.68;
const MIN_UPLOAD_DIMENSION = 1200;
const CAMERA_CONSTRAINT_CANDIDATES: MediaStreamConstraints[] = [
  {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  },
  {
    video: {
      facingMode: { ideal: "environment" }
    },
    audio: false
  },
  {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  },
  {
    video: true,
    audio: false
  }
];

declare global {
  interface Window {
    cv?: OpenCvModule | Promise<OpenCvModule>;
  }
}

let cvRuntimePromise: Promise<OpenCvModule> | null = null;

interface QueuedDraft {
  id: string;
  draftToken: string;
  originalImageUrl: string;
  correctedImageUrl: string;
  fullName: string;
  organization: string;
  jobTitle: string;
  email: string;
  confidence: number;
  warnings: string[];
  rawOcrText: string;
  saveError: string | null;
}

function toQueuedDraft(nextDraft: CardDraft): QueuedDraft {
  return {
    id: nextDraft.draftToken,
    draftToken: nextDraft.draftToken,
    originalImageUrl: nextDraft.originalImageUrl,
    correctedImageUrl: nextDraft.correctedImageUrl,
    fullName: nextDraft.fullName ?? "",
    organization: nextDraft.organization ?? "",
    jobTitle: nextDraft.jobTitle ?? "",
    email: nextDraft.email ?? "",
    confidence: nextDraft.confidence,
    warnings: nextDraft.warnings,
    rawOcrText: nextDraft.rawOcrText,
    saveError: null
  };
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

function isOpenCvModule(value: unknown): value is OpenCvModule {
  return Boolean(value) && typeof (value as OpenCvModule).getBuildInformation === "function";
}

function isPromiseLike<T>(value: unknown): value is Promise<T> {
  return Boolean(value) && typeof (value as Promise<T>).then === "function";
}

async function resolveOpenCvModule(candidate: unknown) {
  if (isOpenCvModule(candidate)) {
    window.cv = candidate;
    return candidate;
  }

  if (isPromiseLike<OpenCvModule>(candidate)) {
    const module = await candidate;
    if (!isOpenCvModule(module)) {
      throw new Error("OpenCV runtime resolved without expected API");
    }

    window.cv = module;
    return module;
  }

  throw new Error("OpenCV runtime did not initialize");
}

async function ensureCvRuntime() {
  if (cvRuntimePromise) {
    return cvRuntimePromise;
  }

  if (window.cv) {
    cvRuntimePromise = resolveOpenCvModule(window.cv);
    return cvRuntimePromise;
  }

  cvRuntimePromise = new Promise<OpenCvModule>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-opencv-runtime="true"]'
    );

    const handleReady = () => {
      void resolveOpenCvModule(window.cv).then(resolve).catch(reject);
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
    script.src = "/vendor/opencv.js";
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

  return cvRuntimePromise;
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

function calculatePointCentroid(points: Point[]) {
  return points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length
    }),
    { x: 0, y: 0 }
  );
}

function scoreQuadCandidate(quad: Quadrilateral, frameWidth: number, frameHeight: number) {
  const baseScore = scoreQuadrilateral(quad, frameWidth, frameHeight);
  if (baseScore <= 0) {
    return 0;
  }

  const center = calculatePointCentroid(quad.points);
  const normalizedDistance = Math.hypot(
    (center.x - frameWidth / 2) / Math.max(frameWidth / 2, 1),
    (center.y - frameHeight / 2) / Math.max(frameHeight / 2, 1)
  );
  const centeredBonus = Math.max(0, 1 - normalizedDistance) * 0.08;

  return Number((baseScore + centeredBonus).toFixed(3));
}

function extractQuadFromMinAreaRect(cv: OpenCvModule, contour: any): Quadrilateral | null {
  if (typeof cv.minAreaRect !== "function" || !cv.RotatedRect?.points) {
    return null;
  }

  try {
    const rect = cv.minAreaRect(contour);
    const points = cv.RotatedRect.points(rect) as Point[] | undefined;
    if (!Array.isArray(points) || points.length !== 4) {
      return null;
    }

    return normalizeQuadrilateral(
      points.map((point) => ({
        x: point.x,
        y: point.y
      }))
    );
  } catch {
    return null;
  }
}

function extractBestQuadFromContour(
  cv: OpenCvModule,
  contour: any,
  frameWidth: number,
  frameHeight: number
) {
  const perimeter = cv.arcLength(contour, true);
  let bestQuad: Quadrilateral | null = null;
  let bestScore = 0;

  for (const epsilonFactor of APPROX_EPSILON_FACTORS) {
    const approx = new cv.Mat();

    try {
      cv.approxPolyDP(contour, approx, perimeter * epsilonFactor, true);

      if (approx.rows !== 4 || !cv.isContourConvex(approx)) {
        continue;
      }

      const quad = extractQuadFromApprox(approx);
      if (!quad) {
        continue;
      }

      const score = scoreQuadCandidate(quad, frameWidth, frameHeight);
      if (score > bestScore) {
        bestQuad = quad;
        bestScore = score;
      }
    } finally {
      approx.delete();
    }
  }

  if (bestQuad) {
    return { quad: bestQuad, score: bestScore };
  }

  const rotatedQuad = extractQuadFromMinAreaRect(cv, contour);
  if (!rotatedQuad) {
    return { quad: null, score: 0 };
  }

  return {
    quad: rotatedQuad,
    score: scoreQuadCandidate(rotatedQuad, frameWidth, frameHeight)
  };
}

function detectQuadFromMask(
  cv: OpenCvModule,
  mask: any,
  frameWidth: number,
  frameHeight: number
) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let bestQuad: Quadrilateral | null = null;
  let bestScore = 0;

  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);

      try {
        const area = cv.contourArea(contour);
        if (area < frameWidth * frameHeight * MIN_CONTOUR_AREA_RATIO) {
          continue;
        }

        const candidate = extractBestQuadFromContour(cv, contour, frameWidth, frameHeight);
        if (candidate.score > bestScore) {
          bestQuad = candidate.quad;
          bestScore = candidate.score;
        }
      } finally {
        contour.delete();
      }
    }

    return { quad: bestQuad, score: bestScore };
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

function detectQuad(cv: OpenCvModule, canvas: HTMLCanvasElement) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const edgesStrong = new cv.Mat();
  const mergedEdges = new cv.Mat();
  const adaptive = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    cv.Canny(blurred, edges, 35, 120, 3, false);
    cv.Canny(blurred, edgesStrong, 60, 180, 3, false);
    cv.bitwise_or(edges, edgesStrong, mergedEdges);
    cv.dilate(
      mergedEdges,
      mergedEdges,
      kernel,
      new cv.Point(-1, -1),
      1,
      cv.BORDER_CONSTANT,
      cv.morphologyDefaultBorderValue()
    );
    cv.morphologyEx(
      mergedEdges,
      mergedEdges,
      cv.MORPH_CLOSE,
      kernel,
      new cv.Point(-1, -1),
      2,
      cv.BORDER_CONSTANT,
      cv.morphologyDefaultBorderValue()
    );

    cv.adaptiveThreshold(
      blurred,
      adaptive,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      31,
      8
    );
    cv.morphologyEx(
      adaptive,
      adaptive,
      cv.MORPH_CLOSE,
      kernel,
      new cv.Point(-1, -1),
      2,
      cv.BORDER_CONSTANT,
      cv.morphologyDefaultBorderValue()
    );

    const candidates = [mergedEdges, adaptive];
    let bestQuad: Quadrilateral | null = null;
    let bestScore = 0;

    for (const candidateMask of candidates) {
      const { quad, score } = detectQuadFromMask(cv, candidateMask, canvas.width, canvas.height);
      if (score > bestScore) {
        bestQuad = quad;
        bestScore = score;
      }
    }

    return bestScore >= MIN_ACCEPTABLE_QUAD_SCORE ? bestQuad : null;
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    edgesStrong.delete();
    mergedEdges.delete();
    adaptive.delete();
    kernel.delete();
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

function mapQuadToPreviewDisplay(
  quad: Quadrilateral,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number
): Quadrilateral {
  const scale = Math.min(frameWidth / Math.max(sourceWidth, 1), frameHeight / Math.max(sourceHeight, 1));
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (frameWidth - renderedWidth) / 2;
  const offsetY = (frameHeight - renderedHeight) / 2;

  return {
    points: quad.points.map((point) => ({
      x: point.x * scale + offsetX,
      y: point.y * scale + offsetY
    })) as [Point, Point, Point, Point]
  };
}

function canRetryCameraRequest(error: unknown) {
  return (
    error instanceof DOMException &&
    [
      "AbortError",
      "DevicesNotFoundError",
      "NotFoundError",
      "OverconstrainedError"
    ].includes(error.name)
  );
}

async function requestCameraStream() {
  let lastError: unknown = null;

  for (const constraints of CAMERA_CONSTRAINT_CANDIDATES) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (!canRetryCameraRequest(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to acquire camera stream");
}

function getCameraFailureMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "カメラを起動できませんでした。画像アップロードを試してください。";
  }

  switch (error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "カメラ権限が拒否されました。ブラウザ設定を確認してください。";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "利用できるカメラが見つかりません。別端末か画像アップロードを試してください。";
    case "NotReadableError":
    case "TrackStartError":
      return "カメラが他のアプリで使用中です。別タブや別アプリを閉じて再試行してください。";
    case "OverconstrainedError":
      return "背面カメラの取得条件が合いませんでした。再度起動すると別条件で試します。";
    default:
      return "カメラを起動できませんでした。画像アップロードを試してください。";
  }
}

export function ScanWorkbench() {
  const router = useRouter();
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameHandleRef = useRef<number | null>(null);
  const autoCaptureTimeoutRef = useRef<number | null>(null);
  const autoCaptureInFlightRef = useRef(false);
  const lastAnalysisAtRef = useRef(0);
  const lastQuadRef = useRef<Quadrilateral | null>(null);
  const stableCountRef = useRef(0);
  const cvRef = useRef<OpenCvModule | null>(null);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraMessage, setCameraMessage] = useState("カメラを起動すると名刺の枠を自動検出します。");
  const [cvReady, setCvReady] = useState(false);
  const [liveQuad, setLiveQuad] = useState<Quadrilateral | null>(null);
  const [lockedQuad, setLockedQuad] = useState<Quadrilateral | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>("batch");
  const [currentDraft, setCurrentDraft] = useState<QueuedDraft | null>(null);
  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [networkState, setNetworkState] = useState<
    "idle" | "uploading" | "saving"
  >("idle");
  const [previewSize, setPreviewSize] = useState({ width: 640, height: 480 });

  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame) {
      return;
    }

    const updateSize = () => {
      setPreviewSize({
        width: Math.max(Math.round(frame.clientWidth), 1),
        height: Math.max(Math.round(frame.clientHeight), 1)
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => {
        window.removeEventListener("resize", updateSize);
      };
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, []);

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
      if (autoCaptureTimeoutRef.current) {
        window.clearTimeout(autoCaptureTimeoutRef.current);
      }

      if (frameHandleRef.current) {
        cancelAnimationFrame(frameHandleRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (cameraStatus !== "live") {
      if (autoCaptureTimeoutRef.current) {
        window.clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
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

  const hasLockedQuad = Boolean(lockedQuad);

  useEffect(() => {
    if (
      cameraStatus !== "live" ||
      !hasLockedQuad ||
      networkState !== "idle" ||
      autoCaptureInFlightRef.current ||
      (scanMode === "single" && currentDraft !== null)
    ) {
      if (autoCaptureTimeoutRef.current) {
        window.clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
      return;
    }

    setCameraMessage("名刺枠をロックしました。まもなく自動撮影します。");
    autoCaptureTimeoutRef.current = window.setTimeout(() => {
      autoCaptureTimeoutRef.current = null;
      if (autoCaptureInFlightRef.current) {
        return;
      }

      autoCaptureInFlightRef.current = true;
      void handleCapture("auto");
    }, AUTO_CAPTURE_DELAY_MS);

    return () => {
      if (autoCaptureTimeoutRef.current) {
        window.clearTimeout(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
    };
  }, [cameraStatus, currentDraft, hasLockedQuad, networkState, scanMode]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("unsupported");
      setCameraMessage("このブラウザではカメラ取得がサポートされていません。");
      return;
    }

    if (!window.isSecureContext) {
      setCameraStatus("secure-context-required");
      setCameraMessage("カメラの利用には HTTPS 接続が必要です。");
      return;
    }

    setCameraStatus("starting");
    setSaveError(null);
    setLiveQuad(null);
    setLockedQuad(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    autoCaptureInFlightRef.current = false;
    if (autoCaptureTimeoutRef.current) {
      window.clearTimeout(autoCaptureTimeoutRef.current);
      autoCaptureTimeoutRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());

    try {
      const stream = await requestCameraStream();
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
      setCameraMessage(getCameraFailureMessage(error));
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
    const queuedDraft = toQueuedDraft(nextDraft);
    if (scanMode === "single") {
      setCurrentDraft(queuedDraft);
    } else {
      setQueuedDrafts((current) => [queuedDraft, ...current]);
    }
    setNetworkState("idle");
    setLiveQuad(null);
    setLockedQuad(null);
    lastQuadRef.current = null;
    stableCountRef.current = 0;
    autoCaptureInFlightRef.current = false;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setCameraMessage(
      scanMode === "single"
        ? "解析結果を確認して保存してください。"
        : cameraStatus === "live"
          ? "解析結果を追加しました。次の名刺をかざしてください。"
          : "解析結果を追加しました。続けて画像を選択できます。"
    );
  }

  function handleScanModeChange(nextMode: ScanMode) {
    if (nextMode === scanMode) {
      return;
    }

    setSaveError(null);
    if (nextMode === "batch" && currentDraft) {
      setQueuedDrafts((queue) => [currentDraft, ...queue]);
      setCurrentDraft(null);
    }

    setScanMode(nextMode);
  }

  function updateCurrentDraft(
    field: keyof Pick<QueuedDraft, "fullName" | "organization" | "jobTitle" | "email">,
    value: string
  ) {
    setCurrentDraft((draft) =>
      draft
        ? {
            ...draft,
            [field]: value,
            saveError: null
          }
        : draft
    );
  }

  function updateQueuedDraft(id: string, field: keyof Pick<QueuedDraft, "fullName" | "organization" | "jobTitle" | "email">, value: string) {
    setQueuedDrafts((current) =>
      current.map((draft) =>
        draft.id === id
          ? {
              ...draft,
              [field]: value,
              saveError: null
            }
          : draft
      )
    );
  }

  function removeQueuedDraft(id: string) {
    setQueuedDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  function discardCurrentDraft() {
    setCurrentDraft(null);
    setSaveError(null);
    setCameraMessage(
      cameraStatus === "live"
        ? "保存前の結果を破棄しました。次の名刺をかざしてください。"
        : "保存前の結果を破棄しました。続けて画像を選択できます。"
    );
  }

  async function saveQueuedDraft(draft: QueuedDraft) {
    const response = await fetch("/api/cards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draftToken: draft.draftToken,
        fullName: draft.fullName.trim() || null,
        organization: draft.organization.trim() || null,
        jobTitle: draft.jobTitle.trim() || null,
        email: draft.email.trim()
      })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; detail?: string | null }
        | null;
      throw new Error(
        [body?.error, body?.detail].filter(Boolean).join(" / ") || "保存に失敗しました"
      );
    }
  }

  async function handleCapture(source: "manual" | "auto" = "manual") {
    const video = videoRef.current;
    const canvas = analysisCanvasRef.current;

    if (!video || !canvas) {
      autoCaptureInFlightRef.current = false;
      return;
    }

    try {
      setCameraMessage(
        source === "auto" ? "名刺を自動撮影しました。解析しています。" : "名刺を撮影しました。解析しています。"
      );
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
    } finally {
      autoCaptureInFlightRef.current = false;
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

  async function handleSaveAll() {
    if (queuedDrafts.length === 0) {
      return;
    }

    setNetworkState("saving");
    setSaveError(null);

    const nextQueue: QueuedDraft[] = [];
    let savedCount = 0;

    for (const draft of queuedDrafts) {
      if (!draft.email.trim()) {
        nextQueue.push({
          ...draft,
          saveError: "メールアドレスを入力してください。"
        });
        continue;
      }

      try {
        await saveQueuedDraft(draft);
        savedCount += 1;
      } catch (error) {
        console.error(error);
        nextQueue.push({
          ...draft,
          saveError:
            error instanceof Error ? error.message : "保存できませんでした。入力値を確認してください。"
        });
      }
    }

    setQueuedDrafts(nextQueue);
    setNetworkState("idle");

    if (nextQueue.length === 0) {
      startTransition(() => {
        router.push("/cards");
      });
      return;
    }

    if (savedCount > 0) {
      setSaveError(`${savedCount}件保存しました。未保存の名刺を確認してください。`);
      return;
    }

    setSaveError("保存できませんでした。入力値を確認してください。");
  }

  async function handleSaveCurrent() {
    if (!currentDraft) {
      return;
    }

    if (!currentDraft.email.trim()) {
      setCurrentDraft((draft) =>
        draft
          ? {
              ...draft,
              saveError: "メールアドレスを入力してください。"
            }
          : draft
      );
      setSaveError("保存できませんでした。入力値を確認してください。");
      return;
    }

    setNetworkState("saving");
    setSaveError(null);

    try {
      await saveQueuedDraft(currentDraft);
      setCurrentDraft(null);
      startTransition(() => {
        router.push("/cards");
      });
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "保存できませんでした。入力値を確認してください。";
      setCurrentDraft((draft) =>
        draft
          ? {
              ...draft,
              saveError: message
            }
          : draft
      );
      setSaveError(message);
      setNetworkState("idle");
    }
  }

  const activeQuad = lockedQuad ?? liveQuad;
  const overlayQuad = activeQuad
    ? mapQuadToPreviewDisplay(
        activeQuad,
        analysisCanvasRef.current?.width || 640,
        analysisCanvasRef.current?.height || 480,
        previewSize.width,
        previewSize.height
      )
    : null;
  const singleReviewLocked = scanMode === "single" && currentDraft !== null;
  const scanInputDisabled = networkState !== "idle" || singleReviewLocked;

  return (
    <div className="grid grid--two">
      <section className="panel">
        <div className="panel__body stack">
          <div>
            <h2 className="section-title">1. 撮影またはアップロード</h2>
            <p className="section-subtitle">
              カメラで名刺を画面いっぱいに収めると、輪郭を検出して自動撮影します。
            </p>
          </div>
          <div className="preview-frame" ref={previewFrameRef}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={
                cameraStatus === "live" || cameraStatus === "starting"
                  ? undefined
                  : "preview-media--hidden"
              }
            />
            {cameraStatus === "starting" ? (
              <div className="preview-empty">
                <p>カメラを起動しています...</p>
              </div>
            ) : cameraStatus === "live" ? null : previewUrl ? (
              <img alt="アップロードした名刺のプレビュー" src={previewUrl} />
            ) : (
              <div className="preview-empty">
                <p>カメラを起動するか画像を選択してください</p>
              </div>
            )}
            <svg
              className="preview-overlay"
              viewBox={`0 0 ${previewSize.width} ${previewSize.height}`}
              preserveAspectRatio="none"
            >
              {overlayQuad ? <polygon points={quadToPolygon(overlayQuad)} /> : null}
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
              onClick={() => void handleCapture("manual")}
              type="button"
              disabled={cameraStatus !== "live" || scanInputDisabled}
            >
              手動で撮影
            </button>
            <label
              className={scanInputDisabled ? "ghost-button button-disabled" : "ghost-button"}
              htmlFor="upload-card"
            >
              画像を選択
            </label>
            <input
              id="upload-card"
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              disabled={scanInputDisabled}
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
            <h2 className="section-title">2. スキャン結果を確認</h2>
            <p className="section-subtitle">
              単発で確認しながら保存するか、連続で読み取って最後にまとめて保存するかを切り替えられます。
            </p>
          </div>

          <div className="segmented-control" role="tablist" aria-label="スキャンモード">
            <button
              className={scanMode === "single" ? "segmented-control__button is-active" : "segmented-control__button"}
              type="button"
              onClick={() => handleScanModeChange("single")}
              aria-pressed={scanMode === "single"}
            >
              単発スキャン
            </button>
            <button
              className={scanMode === "batch" ? "segmented-control__button is-active" : "segmented-control__button"}
              type="button"
              onClick={() => handleScanModeChange("batch")}
              aria-pressed={scanMode === "batch"}
            >
              連続スキャン
            </button>
          </div>

          {saveError ? <div className="status-pill status-pill--warn">{saveError}</div> : null}

          {scanMode === "single" ? (
            <div className="stack">
              {queuedDrafts.length > 0 ? (
                <div className="split-banner">
                  <p className="section-subtitle">
                    連続スキャンで読み取った未保存の名刺が {queuedDrafts.length} 件あります。まとめて保存する場合は連続スキャンへ戻してください。
                  </p>
                  <div className="inline">
                    <span className="status-pill">未保存 {queuedDrafts.length}件</span>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => handleScanModeChange("batch")}
                    >
                      連続スキャンへ切り替え
                    </button>
                  </div>
                </div>
              ) : null}

              {currentDraft ? (
                <div className="draft-queue-card stack">
                  <div className="inline">
                    <span className="status-pill">抽出確度 {Math.round(currentDraft.confidence * 100)}%</span>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={networkState !== "idle"}
                      onClick={discardCurrentDraft}
                    >
                      破棄して再スキャン
                    </button>
                  </div>
                  <img
                    alt="補正済みの名刺プレビュー"
                    className="review-image"
                    src={currentDraft.correctedImageUrl}
                  />
                  {currentDraft.warnings.length > 0 ? (
                    <ul className="warning-list">
                      {currentDraft.warnings.map((warning) => (
                        <li key={`${currentDraft.id}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="status-pill">抽出候補を確認してください</div>
                  )}
                  {currentDraft.saveError ? (
                    <div className="status-pill status-pill--warn">{currentDraft.saveError}</div>
                  ) : null}
                  <div className="field">
                    <label htmlFor="single-fullName">名前</label>
                    <input
                      id="single-fullName"
                      value={currentDraft.fullName}
                      onChange={(event) => updateCurrentDraft("fullName", event.target.value)}
                      placeholder="山田 太郎"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="single-organization">所属</label>
                    <input
                      id="single-organization"
                      value={currentDraft.organization}
                      onChange={(event) => updateCurrentDraft("organization", event.target.value)}
                      placeholder="株式会社サンプル 営業部"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="single-jobTitle">役職</label>
                    <input
                      id="single-jobTitle"
                      value={currentDraft.jobTitle}
                      onChange={(event) => updateCurrentDraft("jobTitle", event.target.value)}
                      placeholder="部長 / Manager"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="single-email">メールアドレス</label>
                    <input
                      id="single-email"
                      value={currentDraft.email}
                      onChange={(event) => updateCurrentDraft("email", event.target.value)}
                      placeholder="name@example.com"
                      type="email"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="single-rawOcrText">OCR テキスト</label>
                    <textarea
                      id="single-rawOcrText"
                      readOnly
                      value={currentDraft.rawOcrText}
                    />
                  </div>
                  <div className="inline">
                    <button
                      className="primary-button"
                      type="button"
                      disabled={networkState !== "idle"}
                      onClick={() => void handleSaveCurrent()}
                    >
                      {networkState === "saving" ? "保存中..." : "この名刺を保存"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="split-banner">
                  <p className="section-subtitle">
                    単発スキャンでは、1枚ずつ確認して保存します。保存前の結果がある間は次の撮影を止めます。
                  </p>
                  <div className="inline muted">
                    <span>処理状態:</span>
                    <strong>{networkState === "uploading" ? "OCR 実行中" : "待機中"}</strong>
                  </div>
                </div>
              )}
            </div>
          ) : queuedDrafts.length > 0 ? (
            <div className="stack">
              <div className="inline">
                <span className="status-pill">未保存 {queuedDrafts.length}件</span>
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    networkState !== "idle" ||
                    queuedDrafts.some((draft) => draft.email.trim().length === 0)
                  }
                  onClick={handleSaveAll}
                >
                  {networkState === "saving" ? "まとめて保存中..." : "まとめて保存"}
                </button>
              </div>

              {queuedDrafts.map((draft, index) => (
                <div className="draft-queue-card stack" key={draft.id}>
                  <div className="inline">
                    <span className="status-pill">名刺 {queuedDrafts.length - index}</span>
                    <span className="status-pill">抽出確度 {Math.round(draft.confidence * 100)}%</span>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={networkState === "saving"}
                      onClick={() => removeQueuedDraft(draft.id)}
                    >
                      削除
                    </button>
                  </div>
                  <img
                    alt="補正済みの名刺プレビュー"
                    className="review-image"
                    src={draft.correctedImageUrl}
                  />
                  {draft.warnings.length > 0 ? (
                    <ul className="warning-list">
                      {draft.warnings.map((warning) => (
                        <li key={`${draft.id}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="status-pill">抽出候補を確認してください</div>
                  )}
                  {draft.saveError ? (
                    <div className="status-pill status-pill--warn">{draft.saveError}</div>
                  ) : null}
                  <div className="field">
                    <label htmlFor={`fullName-${draft.id}`}>名前</label>
                    <input
                      id={`fullName-${draft.id}`}
                      value={draft.fullName}
                      onChange={(event) => updateQueuedDraft(draft.id, "fullName", event.target.value)}
                      placeholder="山田 太郎"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`organization-${draft.id}`}>所属</label>
                    <input
                      id={`organization-${draft.id}`}
                      value={draft.organization}
                      onChange={(event) =>
                        updateQueuedDraft(draft.id, "organization", event.target.value)
                      }
                      placeholder="株式会社サンプル 営業部"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`jobTitle-${draft.id}`}>役職</label>
                    <input
                      id={`jobTitle-${draft.id}`}
                      value={draft.jobTitle}
                      onChange={(event) => updateQueuedDraft(draft.id, "jobTitle", event.target.value)}
                      placeholder="部長 / Manager"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`email-${draft.id}`}>メールアドレス</label>
                    <input
                      id={`email-${draft.id}`}
                      value={draft.email}
                      onChange={(event) => updateQueuedDraft(draft.id, "email", event.target.value)}
                      placeholder="name@example.com"
                      type="email"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`rawOcrText-${draft.id}`}>OCR テキスト</label>
                    <textarea
                      id={`rawOcrText-${draft.id}`}
                      readOnly
                      value={draft.rawOcrText}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="split-banner">
              <p className="section-subtitle">
                まだ未保存の名刺はありません。撮影またはアップロードすると、結果が右側に順番に追加されます。
              </p>
              <div className="inline muted">
                <span>処理状態:</span>
                <strong>
                  {networkState === "uploading"
                    ? "OCR 実行中"
                    : networkState === "saving"
                      ? "まとめて保存中"
                      : "待機中"}
                </strong>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
