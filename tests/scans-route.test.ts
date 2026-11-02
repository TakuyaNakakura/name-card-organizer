// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ApiError } from "@/lib/api-error";
const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createTeamScan: vi.fn(),
}));
vi.mock("@/lib/http", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/team-scan-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team-scan-service")>()),
  createTeamScan: mocks.createTeamScan,
}));
import { POST } from "@/app/api/scans/route";
async function request(type = "image/png", invalid = false) {
  const form = new FormData();
  form.set("clientScanId", randomUUID());
  const image = invalid
    ? Buffer.from("not an image")
    : await sharp({
        create: { width: 400, height: 250, channels: 3, background: "#fff" },
      })
        .png()
        .toBuffer();
  for (const field of ["originalImage", "correctedImage"])
    form.set(
      field,
      new File([new Uint8Array(image)], `${field}.png`, { type }),
    );
  return new Request("http://localhost/api/scans", {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: form,
  });
}
describe("POST /api/scans team contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    mocks.requireSession.mockResolvedValue({
      userId: "user",
      teamId: randomUUID(),
      role: "member",
    });
  });
  it("decodes images and returns a durable draft rather than an OCR JWT", async () => {
    const draft = { id: randomUUID(), status: "ready", version: 2 };
    mocks.createTeamScan.mockResolvedValue(draft);
    const response = await POST(await request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
    expect(mocks.createTeamScan).toHaveBeenCalledOnce();
  });
  it("returns structured safe provider errors", async () => {
    mocks.createTeamScan.mockRejectedValue(
      new ApiError(
        502,
        "OCR_BILLING_DISABLED",
        "OCRの課金設定を確認してください。",
      ),
    );
    const response = await POST(await request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "OCR_BILLING_DISABLED", requestId: expect.any(String) },
    });
  });
  it("rejects expired sessions before touching OCR", async () => {
    mocks.requireSession.mockRejectedValue(
      new ApiError(401, "UNAUTHENTICATED", "ログインしてください。"),
    );
    expect((await POST(await request())).status).toBe(401);
    expect(mocks.createTeamScan).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes", async () => {
    const req = await request();
    req.headers.set("origin", "https://attacker.invalid");
    expect((await POST(req)).status).toBe(403);
    expect(mocks.createTeamScan).not.toHaveBeenCalled();
  });
  it("rejects spoofed image contents and MIME types", async () => {
    expect((await POST(await request("image/png", true))).status).toBe(422);
    expect((await POST(await request("image/jpeg"))).status).toBe(422);
    expect(mocks.createTeamScan).not.toHaveBeenCalled();
  });
  it("rejects invalid multipart uploads", async () => {
    const req = new Request("http://localhost/api/scans", {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: "broken",
    });
    expect((await POST(req)).status).toBe(400);
  });
});
