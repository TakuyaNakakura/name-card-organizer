// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ annotate: vi.fn() }));
vi.mock("@google-cloud/vision", () => ({
  ImageAnnotatorClient: class {
    batchAnnotateImages = mocks.annotate;
  },
  protos: {},
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("OCR_PROVIDER", "google");
  vi.stubEnv("GOOGLE_CLOUD_CREDENTIALS_JSON", "");
  mocks.annotate.mockReset();
});
it("sends one DOCUMENT_TEXT_DETECTION feature with a bounded timeout and no SDK retries", async () => {
  mocks.annotate.mockResolvedValue([
    {
      responses: [
        {
          fullTextAnnotation: {
            text: "山田 花子\nhanako@example.test",
            pages: [],
          },
        },
      ],
    },
  ]);
  const { getOcrClient } = await import("@/lib/ocr");
  const buffer = Buffer.from("image");
  expect(
    (await getOcrClient().recognize({ buffer, mimeType: "image/jpeg" }))
      .rawText,
  ).toContain("山田 花子");
  expect(mocks.annotate).toHaveBeenCalledExactlyOnceWith(
    {
      requests: [
        {
          image: { content: buffer },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["ja", "en"] },
        },
      ],
    },
    { timeout: 35000, retry: null },
  );
});
it("preserves provider error codes for safe scan error classification", async () => {
  mocks.annotate.mockResolvedValue([
    {
      responses: [
        { error: { code: 7, message: "billing disabled in private-project" } },
      ],
    },
  ]);
  const { getOcrClient } = await import("@/lib/ocr");
  await expect(
    getOcrClient().recognize({
      buffer: Buffer.from("image"),
      mimeType: "image/jpeg",
    }),
  ).rejects.toMatchObject({ code: 7 });
});
