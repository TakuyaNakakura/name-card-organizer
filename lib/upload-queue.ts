import { RequestError } from "@/lib/api-client";

export const MAX_UPLOAD_FILES = 100;
export type UploadItem = {
  id: string;
  clientScanId: string;
  name: string;
  file: File | null;
  status: "pending" | "processing" | "succeeded" | "failed";
  attempts: number;
  error: string;
};

// Serial execution also respects the server's one-active-scan-per-member lease.
export async function runUploadQueue(
  items: UploadItem[],
  process: (item: UploadItem) => Promise<void>,
  changed: () => void,
  stopped: () => boolean,
) {
  for (const item of items) {
    if (stopped()) break;
    if (item.status !== "pending") continue;
    item.status = "processing";
    item.error = "";
    item.attempts++;
    changed();
    let halt = false;
    try {
      await process(item);
      item.status = "succeeded";
      item.file = null;
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : "画像の処理に失敗しました。";
      halt = (error instanceof Error && "code" in error && error.code === "IMAGE_CORRECTION_UNAVAILABLE") || error instanceof RequestError && (
        [401, 403, 429].includes(error.status) ||
        ["SCAN_BUSY", "OCR_QUOTA_EXCEEDED"].includes(error.code)
      );
    }
    changed();
    if (halt) break;
  }
}
