export type ScanStage = "storage" | "ocr" | "processing";

export class ScanProcessingError extends Error {
  constructor(readonly stage: ScanStage, cause: unknown) {
    super(`Scan failed during ${stage}`, { cause });
    this.name = "ScanProcessingError";
  }
}

export function getScanFailure(error: unknown) {
  const stage = error instanceof ScanProcessingError ? error.stage : "processing";
  const cause = error instanceof ScanProcessingError ? error.cause : error;
  const provider = cause as { code?: unknown; name?: string; message?: string } | null;
  const providerCode = provider?.code;
  const message = `${provider?.name ?? ""} ${provider?.message ?? ""}`;
  let code = "SCAN_PROCESSING_FAILED";
  let description = "読み取り結果の処理に失敗しました。もう一度スキャンしてください。";

  if (stage === "storage") {
    code = "STORAGE_FAILED";
    description = "名刺画像の保存に失敗しました。ストレージの接続設定を確認してください。";
    if (/NoSuchBucket/i.test(message)) {
      code = "STORAGE_BUCKET_NOT_FOUND";
      description = "画像保存先のバケットが見つかりません。S3_BUCKET を確認してください。";
    } else if (/AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|Unauthorized/i.test(message)) {
      code = "STORAGE_ACCESS_DENIED";
      description = "画像保存先へアクセスできません。R2 のキーと書き込み権限を確認してください。";
    }
  } else if (stage === "ocr") {
    code = "OCR_FAILED";
    description = "OCR サービスで解析に失敗しました。Google Vision の設定を確認してください。";
    if (/billing|BILLING_DISABLED/i.test(message)) {
      code = "OCR_BILLING_DISABLED";
      description = "Google OCR の課金が有効ではありません。Google Cloud の課金設定を確認してください。";
    } else if (/SERVICE_DISABLED|has not been used|api.*disabled/i.test(message)) {
      code = "OCR_API_DISABLED";
      description = "Google Cloud Vision API が無効です。Google Cloud で API を有効にしてください。";
    } else if (providerCode === 16 || /invalid_grant|invalid.*jwt|default credentials|private.key|JSON/i.test(message)) {
      code = "OCR_AUTHENTICATION_FAILED";
      description = "Google OCR の認証に失敗しました。サービスアカウントの認証情報を確認してください。";
    } else if (providerCode === 7 || /PERMISSION_DENIED/i.test(message)) {
      code = "OCR_PERMISSION_DENIED";
      description = "Google OCR の利用権限がありません。サービスアカウントの権限を確認してください。";
    } else if (providerCode === 8 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
      code = "OCR_QUOTA_EXCEEDED";
      description = "Google OCR の利用上限に達しました。時間をおくか、割り当てを確認してください。";
    } else if (providerCode === 4 || /DEADLINE_EXCEEDED|timeout/i.test(message)) {
      code = "OCR_TIMEOUT";
      description = "Google OCR の応答がタイムアウトしました。時間をおいて再試行してください。";
    } else if (providerCode === 3 || /INVALID_ARGUMENT|invalid image/i.test(message)) {
      code = "OCR_INVALID_IMAGE";
      description = "OCR が画像を読み込めませんでした。撮り直すか、別の画像を選択してください。";
    }
  }

  return { error: description, code, stage, status: stage === "processing" ? 500 : 502 };
}

export async function getScanResponseError(response: Response): Promise<string> {
  if (response.status === 401 || response.redirected) {
    return "ログインの有効期限が切れました。再ログインしてからスキャンしてください。";
  }
  if (response.status === 413) {
    return "送信する画像が大きすぎます。名刺に近づいて撮り直すか、小さい画像を選択してください。";
  }
  if (response.status === 504) {
    return "解析がタイムアウトしました。時間をおいて再試行してください。";
  }
  if (response.status === 429) {
    return "スキャン回数の上限に達しました。時間をおいて再試行してください。";
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: unknown; code?: unknown; requestId?: unknown }
    | null;
  const description = typeof body?.error === "string"
    ? body.error
    : `名刺の解析に失敗しました（HTTP ${response.status}）。`;
  const code = typeof body?.code === "string" ? body.code : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  return [description, code, requestId ? `問い合わせID: ${requestId}` : ""].filter(Boolean).join(" / ");
}
