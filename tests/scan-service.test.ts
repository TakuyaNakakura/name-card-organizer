import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  putObject: vi.fn(),
  recognize: vi.fn(),
  signDraftToken: vi.fn()
}));

vi.mock("@/lib/storage", () => ({
  buildAssetUrl: (key: string) => `/api/assets/${key}`,
  getStorage: () => ({
    putObject: mocks.putObject
  })
}));

vi.mock("@/lib/ocr", () => ({
  getOcrClient: () => ({
    recognize: mocks.recognize
  })
}));

vi.mock("@/lib/session", () => ({
  signDraftToken: mocks.signDraftToken
}));

import { scanBusinessCard } from "@/lib/scan-service";

describe("scanBusinessCard", () => {
  beforeEach(() => {
    mocks.putObject.mockReset();
    mocks.recognize.mockReset();
    mocks.signDraftToken.mockReset();
    mocks.putObject.mockResolvedValue(undefined);
    mocks.signDraftToken.mockResolvedValue("draft-token");
  });

  it("stores images and returns a draft with extracted contact fields", async () => {
    mocks.recognize.mockResolvedValue({
      rawText: "Jane Doe\njane@example.com",
      overallConfidence: 0.91,
      blocks: [
        {
          text: "Jane Doe",
          confidence: 0.97,
          bounds: { x: 30, y: 20, width: 180, height: 40 }
        },
        {
          text: "jane@example.com",
          confidence: 0.99,
          bounds: { x: 30, y: 90, width: 220, height: 24 }
        }
      ]
    });

    const draft = await scanBusinessCard({
      originalBuffer: Buffer.from("original"),
      originalMimeType: "image/jpeg",
      correctedBuffer: Buffer.from("corrected"),
      correctedMimeType: "image/jpeg"
    });

    expect(mocks.putObject).toHaveBeenCalledTimes(2);
    expect(mocks.recognize).toHaveBeenCalledWith({
      buffer: Buffer.from("corrected"),
      mimeType: "image/jpeg"
    });
    expect(mocks.signDraftToken).toHaveBeenCalledOnce();
    expect(draft).toMatchObject({
      draftToken: "draft-token",
      fullName: "Jane Doe",
      email: "jane@example.com",
      tempImageUrl: expect.stringContaining("/api/assets/drafts/")
    });
  });
});
