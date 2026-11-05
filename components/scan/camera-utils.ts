"use client";

import {
  areQuadsStable,
  normalizeQuadrilateral,
  scoreQuadrilateral,
  type Point,
  type Quadrilateral,
} from "@/lib/card-detection";

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
      height: { ideal: 1080 },
    },
    audio: false,
  },
  {
    video: {
      facingMode: { ideal: "environment" },
    },
    audio: false,
  },
  {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  },
  {
    video: true,
    audio: false,
  },
];

declare global {
  interface Window {
    cv?: OpenCvModule | Promise<OpenCvModule>;
  }
}

let cvRuntimePromise: Promise<OpenCvModule> | null = null;

function toBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.92,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to convert canvas to blob"));
          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

export async function loadImageElement(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  await image.decode();
  return { image, objectUrl };
}

function isOpenCvModule(value: unknown): value is OpenCvModule {
  return (
    Boolean(value) &&
    typeof (value as OpenCvModule).getBuildInformation === "function"
  );
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

export async function ensureCvRuntime() {
  if (cvRuntimePromise) {
    return cvRuntimePromise;
  }

  if (window.cv) {
    cvRuntimePromise = resolveOpenCvModule(window.cv);
    return cvRuntimePromise;
  }

  cvRuntimePromise = new Promise<OpenCvModule>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-opencv-runtime="true"]',
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
          { once: true },
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
      { once: true },
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
    y: values[index * 2 + 1],
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
      y: sum.y + point.y / points.length,
    }),
    { x: 0, y: 0 },
  );
}

function scoreQuadCandidate(
  quad: Quadrilateral,
  frameWidth: number,
  frameHeight: number,
) {
  const baseScore = scoreQuadrilateral(quad, frameWidth, frameHeight);
  if (baseScore <= 0) {
    return 0;
  }

  const center = calculatePointCentroid(quad.points);
  const normalizedDistance = Math.hypot(
    (center.x - frameWidth / 2) / Math.max(frameWidth / 2, 1),
    (center.y - frameHeight / 2) / Math.max(frameHeight / 2, 1),
  );
  const centeredBonus = Math.max(0, 1 - normalizedDistance) * 0.08;

  return Number((baseScore + centeredBonus).toFixed(3));
}

function extractQuadFromMinAreaRect(
  cv: OpenCvModule,
  contour: any,
): Quadrilateral | null {
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
        y: point.y,
      })),
    );
  } catch {
    return null;
  }
}

function extractBestQuadFromContour(
  cv: OpenCvModule,
  contour: any,
  frameWidth: number,
  frameHeight: number,
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
    score: scoreQuadCandidate(rotatedQuad, frameWidth, frameHeight),
  };
}

function detectQuadFromMask(
  cv: OpenCvModule,
  mask: any,
  frameWidth: number,
  frameHeight: number,
) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let bestQuad: Quadrilateral | null = null;
  let bestScore = 0;

  try {
    cv.findContours(
      mask,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);

      try {
        const area = cv.contourArea(contour);
        if (area < frameWidth * frameHeight * MIN_CONTOUR_AREA_RATIO) {
          continue;
        }

        const candidate = extractBestQuadFromContour(
          cv,
          contour,
          frameWidth,
          frameHeight,
        );
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

export function detectQuad(cv: OpenCvModule, canvas: HTMLCanvasElement) {
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
      cv.morphologyDefaultBorderValue(),
    );
    cv.morphologyEx(
      mergedEdges,
      mergedEdges,
      cv.MORPH_CLOSE,
      kernel,
      new cv.Point(-1, -1),
      2,
      cv.BORDER_CONSTANT,
      cv.morphologyDefaultBorderValue(),
    );

    cv.adaptiveThreshold(
      blurred,
      adaptive,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      31,
      8,
    );
    cv.morphologyEx(
      adaptive,
      adaptive,
      cv.MORPH_CLOSE,
      kernel,
      new cv.Point(-1, -1),
      2,
      cv.BORDER_CONSTANT,
      cv.morphologyDefaultBorderValue(),
    );

    const candidates = [mergedEdges, adaptive];
    let bestQuad: Quadrilateral | null = null;
    let bestScore = 0;

    for (const candidateMask of candidates) {
      const { quad, score } = detectQuadFromMask(
        cv,
        candidateMask,
        canvas.width,
        canvas.height,
      );
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

export async function warpPerspective(
  cv: OpenCvModule,
  source: HTMLCanvasElement,
  quad: Quadrilateral,
) {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad.points;
  const width = Math.round(
    Math.max(
      Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
      Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y),
    ),
  );
  const height = Math.round(
    Math.max(
      Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y),
      Math.hypot(bottomRight.x - topRight.x, bottomRight.y - topRight.y),
    ),
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
    bottomLeft.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    width,
    0,
    width,
    height,
    0,
    height,
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
      new cv.Scalar(),
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

// Detect on this immutable snapshot, never on the live analysis canvas. The
// live frame and its dimensions can change while canvas.toBlob is pending.
export async function correctCapturedCard(cv: OpenCvModule | null, source: HTMLCanvasElement) {
  if (!cv) throw new Error("画像補正の準備ができていません。読み込み完了後に撮影してください。");
  const sample = document.createElement("canvas");
  const scale = Math.min(640 / source.width, 1);
  sample.width = Math.max(1, Math.round(source.width * scale));
  sample.height = Math.max(1, Math.round(source.height * scale));
  const context = sample.getContext("2d");
  if (!context) throw new Error("撮影画像を確認できません。撮り直してください。");
  context.drawImage(source, 0, 0, sample.width, sample.height);
  const quad = detectQuad(cv, sample);
  if (!quad) throw new Error("名刺の四隅を確認できませんでした。名刺全体と周囲の余白を画面に入れて撮り直してください。");
  return warpPerspective(cv, source, mapQuadToSource(quad, source.width, source.height, sample.width, sample.height));
}

function resizeCanvasToMaxDimension(
  sourceCanvas: HTMLCanvasElement,
  maxDimension: number,
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

  context.drawImage(
    sourceCanvas,
    0,
    0,
    resizedCanvas.width,
    resizedCanvas.height,
  );
  return resizedCanvas;
}

export async function createUploadBlob(sourceCanvas: HTMLCanvasElement) {
  let maxDimension = MAX_UPLOAD_DIMENSION;
  let quality = INITIAL_UPLOAD_QUALITY;
  let workingCanvas = resizeCanvasToMaxDimension(sourceCanvas, maxDimension);
  let blob = await toBlob(workingCanvas, "image/jpeg", quality);

  while (
    blob.size > MAX_UPLOAD_BYTES &&
    (quality > MIN_UPLOAD_QUALITY || maxDimension > MIN_UPLOAD_DIMENSION)
  ) {
    if (quality > MIN_UPLOAD_QUALITY) {
      quality = Math.max(
        Number((quality - 0.06).toFixed(2)),
        MIN_UPLOAD_QUALITY,
      );
    } else {
      maxDimension = Math.max(
        Math.floor(maxDimension * 0.85),
        MIN_UPLOAD_DIMENSION,
      );
      workingCanvas = resizeCanvasToMaxDimension(sourceCanvas, maxDimension);
    }

    blob = await toBlob(workingCanvas, "image/jpeg", quality);
  }

  return blob;
}

export function mapQuadToSource(
  quad: Quadrilateral,
  sourceWidth: number,
  sourceHeight: number,
  analysisWidth: number,
  analysisHeight: number,
): Quadrilateral {
  const scaleX = sourceWidth / Math.max(analysisWidth, 1);
  const scaleY = sourceHeight / Math.max(analysisHeight, 1);

  return {
    points: quad.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })) as [Point, Point, Point, Point],
  };
}

function quadToPolygon(quad: Quadrilateral | null) {
  if (!quad) {
    return "";
  }

  return quad.points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function mapQuadToPreviewDisplay(
  quad: Quadrilateral,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): Quadrilateral {
  const scale = Math.min(
    frameWidth / Math.max(sourceWidth, 1),
    frameHeight / Math.max(sourceHeight, 1),
  );
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (frameWidth - renderedWidth) / 2;
  const offsetY = (frameHeight - renderedHeight) / 2;

  return {
    points: quad.points.map((point) => ({
      x: point.x * scale + offsetX,
      y: point.y * scale + offsetY,
    })) as [Point, Point, Point, Point],
  };
}

function canRetryCameraRequest(error: unknown) {
  return (
    error instanceof DOMException &&
    [
      "AbortError",
      "DevicesNotFoundError",
      "NotFoundError",
      "OverconstrainedError",
    ].includes(error.name)
  );
}

export async function requestCameraStream() {
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

export function getCameraFailureMessage(error: unknown) {
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
