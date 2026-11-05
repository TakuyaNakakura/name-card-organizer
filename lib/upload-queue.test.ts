import { describe, expect, it } from "vitest";
import { RequestError } from "@/lib/api-client";
import { runUploadQueue, type UploadItem } from "@/lib/upload-queue";

function tasks(count: number): UploadItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index), clientScanId: `scan-${index}`, name: `${index}.png`,
    file: new File(["image"], `${index}.png`, { type: "image/png" }),
    status: "pending", error: "", attempts: 0,
  }));
}

describe("image upload queue", () => {
  it("processes 100 files serially and releases successful file references", async () => {
    const items = tasks(100), seen: string[] = [];
    let active = 0, peak = 0;
    await runUploadQueue(items, async (item) => {
      active++;
      peak = Math.max(active, peak);
      await Promise.resolve();
      seen.push(item.id);
      active--;
    }, () => {}, () => false);
    expect(peak).toBe(1);
    expect(seen).toEqual(items.map((item) => item.id));
    expect(items.every((item) => item.status === "succeeded" && item.file === null)).toBe(true);
  });

  it("retains failures and retries them explicitly without rerunning successful images", async () => {
    const items = tasks(3), seen: string[] = [];
    await runUploadQueue(items, async (item) => {
      seen.push(item.id);
      if (item.id === "1") throw new Error("broken image");
    }, () => {}, () => false);
    expect(items.map((item) => item.status)).toEqual(["succeeded", "failed", "succeeded"]);
    expect(items[1].file).not.toBeNull();
    items[1].status = "pending";
    await runUploadQueue(items, async (item) => { seen.push(item.id); }, () => {}, () => false);
    expect(seen).toEqual(["0", "1", "2", "1"]);
    expect(items[1].clientScanId).toBe("scan-1");
    expect(items[1].attempts).toBe(2);
  });

  it.each([
    new RequestError("quota", 429, "SCAN_LIMIT"),
    new RequestError("draft cap", 429, "DRAFT_LIMIT"),
    new RequestError("expired", 401),
    new RequestError("busy", 409, "SCAN_BUSY"),
    new RequestError("provider quota", 502, "OCR_QUOTA_EXCEEDED"),
  ])("halts on %s and preserves unprocessed files", async (error) => {
    const items = tasks(3);
    await runUploadQueue(items, async (item) => { if (item.id === "1") throw error; }, () => {}, () => false);
    expect(items.map((item) => item.status)).toEqual(["succeeded", "failed", "pending"]);
    expect(items[2].attempts).toBe(0);
    expect(items[2].file).not.toBeNull();
  });

  it("stops after the active image, retaining later images for resume", async () => {
    const items = tasks(3);
    let stopped = false;
    await runUploadQueue(items, async () => { stopped = true; }, () => {}, () => stopped);
    expect(items.map((item) => item.status)).toEqual(["succeeded", "pending", "pending"]);
  });
});
