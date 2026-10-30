import { describe, expect, it } from "vitest";

import { getScanFailure, getScanResponseError, ScanProcessingError } from "@/lib/scan-errors";

describe("scan failures", () => {
  it("distinguishes billing failures without exposing provider details", () => {
    const cause = Object.assign(new Error("billing must be enabled for private-project; secret=private-key"), { code: 7 });
    const failure = getScanFailure(new ScanProcessingError("ocr", cause));

    expect(failure).toMatchObject({ code: "OCR_BILLING_DISABLED", stage: "ocr", status: 502 });
    expect(JSON.stringify(failure)).not.toContain("private-project");
    expect(JSON.stringify(failure)).not.toContain("private-key");
  });

  it("distinguishes storage permission failures from OCR failures", () => {
    const cause = Object.assign(new Error("Forbidden"), { name: "AccessDenied" });
    expect(getScanFailure(new ScanProcessingError("storage", cause))).toMatchObject({
      code: "STORAGE_ACCESS_DENIED", stage: "storage", status: 502
    });
    expect(getScanFailure(new ScanProcessingError("ocr", Object.assign(new Error("Quota exceeded"), { code: 8 })))).toMatchObject({
      code: "OCR_QUOTA_EXCEEDED"
    });
  });

  it("handles non-JSON platform errors instead of hiding the HTTP status", async () => {
    const error = await getScanResponseError(new Response("Internal Server Error", { status: 500 }));
    expect(error).toContain("HTTP 500");
    expect(error).not.toContain("Internal Server Error");
    expect(await getScanResponseError(new Response("Request too large", { status: 413 }))).toContain("画像が大きすぎ");
  });

  it("preserves the safe failure description and correlation ID", async () => {
    const response = Response.json({ error: "OCR の課金が無効です", code: "OCR_BILLING_DISABLED", requestId: "test-request-id" }, { status: 502 });
    expect(await getScanResponseError(response)).toBe("OCR の課金が無効です / OCR_BILLING_DISABLED / 問い合わせID: test-request-id");
  });
});
