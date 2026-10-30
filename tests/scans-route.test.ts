// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  scanBusinessCard: vi.fn()
}));

vi.mock("@/lib/http", () => ({
  requireSession: mocks.requireSession,
  getClientAddress: () => "test-client"
}));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: () => ({ limited: false }) }));
vi.mock("@/lib/scan-service", () => ({ scanBusinessCard: mocks.scanBusinessCard }));

import { POST } from "@/app/api/scans/route";
import { ScanProcessingError } from "@/lib/scan-errors";

function scanRequest() {
  const form = new FormData();
  form.append("originalImage", new File(["image"], "original.jpg", { type: "image/jpeg" }));
  form.append("correctedImage", new File(["image"], "corrected.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost/api/scans", { method: "POST", body: form });
}

describe("POST /api/scans", () => {
  beforeEach(() => {
    mocks.requireSession.mockReset().mockResolvedValue(undefined);
    mocks.scanBusinessCard.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns a safe JSON billing failure with a request ID", async () => {
    mocks.scanBusinessCard.mockRejectedValue(new ScanProcessingError("ocr", Object.assign(new Error("Billing disabled: private-project"), { code: 7 })));
    const response = await POST(scanRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "OCR_BILLING_DISABLED", stage: "ocr", requestId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("private-project");
    expect(console.error).toHaveBeenCalledWith("Business card scan failed", expect.objectContaining({ requestId: body.requestId, code: body.code }));
  });

  it("returns the existing successful draft unchanged", async () => {
    const draft = { draftToken: "draft-token", email: "test@example.com" };
    mocks.scanBusinessCard.mockResolvedValue(draft);
    const response = await POST(scanRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
  });

  it("rejects expired sessions before invoking external services", async () => {
    mocks.requireSession.mockRejectedValue(new Error("Unauthorized"));
    expect((await POST(scanRequest())).status).toBe(401);
    expect(mocks.scanBusinessCard).not.toHaveBeenCalled();
  });

  it("returns JSON for malformed uploads", async () => {
    const response = await POST(new Request("http://localhost/api/scans", { method: "POST", body: "broken" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_UPLOAD" });
    expect(mocks.scanBusinessCard).not.toHaveBeenCalled();
  });
});
