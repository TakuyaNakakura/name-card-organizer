import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { provisionSession } from "./support";
import { texturedCardSvg } from "../fixtures/textured-card";

test.beforeEach(async ({ context }) => { await provisionSession(context); });

async function photo() {
  return { name: "wood-grain-card.png", mimeType: "image/png", buffer: await sharp(Buffer.from(texturedCardSvg)).png().toBuffer() };
}

async function assertCardEdges(page: Page, count = 1) {
  const drafts = (await (await page.request.get("/api/drafts")).json()).items;
  expect(drafts).toHaveLength(count);
  for (const draft of drafts) {
    const image = await page.request.get(draft.correctedImageUrl);
    const buffer = await image.body();
    const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBeGreaterThan(400);
    expect(info.width).toBeLessThan(500);
    expect(info.height).toBeGreaterThan(200);
    expect(info.height).toBeLessThan(300);
    const blue = (x: number, y: number) => {
      const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels;
      expect(data[offset + 2] - data[offset]).toBeGreaterThan(25);
    };
    // Each edge must be card paper, not the brown background or a padded box.
    for (let fraction = 0.1; fraction < 0.95; fraction += 0.1) {
      blue(fraction * info.width, 8); blue(fraction * info.width, info.height - 9);
      blue(8, fraction * info.height); blue(info.width - 9, fraction * info.height);
    }
    await writeFile("/tmp/nco-issue17-corrected.jpg", buffer);
  }
}

test("waits for OpenCV before uploading a photo on textured background", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/vendor/opencv.js", async (route) => { await ready; await route.continue(); });
  let uploads = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/scans")) uploads++; });
  await page.goto("/scan");
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles(await photo());
  await page.waitForTimeout(300);
  expect(uploads).toBe(0);
  release();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await assertCardEdges(page);
  expect(uploads).toBe(1);
});

test("load failures do not save an uncorrected photo and can be explicitly retried", async ({ page }) => {
  let fail!: () => void;
  const failure = new Promise<void>((resolve) => { fail = resolve; });
  await page.route("**/vendor/opencv.js", async (route) => { await failure; await route.abort(); }, { times: 1 });
  let uploads = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/scans")) uploads++; });
  await page.goto("/scan");
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles([await photo(), await photo()]);
  await page.waitForTimeout(100);
  fail();
  await expect(page.getByLabel("画像の取り込み状況")).toContainText("失敗1枚");
  await expect(page.getByLabel("画像の取り込み状況")).toContainText("未処理1枚");
  expect(uploads).toBe(0);
  await page.getByRole("button", { name: "未処理・失敗分を再開" }).click();
  await expect(page.locator(".draft-card")).toHaveCount(2);
  await assertCardEdges(page, 2);
  expect(uploads).toBe(2);
});

test("bulk photo import uses actual card corners for every image", async ({ page }) => {
  await page.goto("/scan");
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles([await photo(), await photo()]);
  await expect(page.locator(".draft-card")).toHaveCount(2);
  await assertCardEdges(page, 2);
  await page.locator(".draft-card").first().screenshot({ path: "/tmp/nco-issue17-draft.png" });
});

test("a non-card object fails without OCR instead of using its enclosing rectangle", async ({ page }) => {
  const buffer = await sharp(Buffer.from('<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#222"/><ellipse cx="320" cy="240" rx="220" ry="130" fill="#eee"/></svg>')).png().toBuffer();
  let uploads = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/scans")) uploads++; });
  await page.goto("/scan");
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles({ name: "not-a-card.png", mimeType: "image/png", buffer });
  await expect(page.getByLabel("画像の取り込み状況")).toContainText("失敗1枚");
  await expect(page.locator(".draft-card")).toHaveCount(0);
  expect(uploads).toBe(0);
});

test("manual camera capture also corrects a card on textured background", async ({ page }) => {
  await page.addInitScript((svg) => {
    const image = new Image();
    image.src = "data:image/svg+xml;base64," + btoa(svg);
    (window as any).__fixtureReady = image.decode();
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (args[0] instanceof HTMLVideoElement) args[0] = image;
      return (original as any).apply(this, args);
    };
  }, texturedCardSvg);
  await page.goto("/scan");
  await page.evaluate(() => (window as any).__fixtureReady);
  await page.getByRole("button", { name: "自動撮影を一時停止", exact: true }).click();
  await page.getByRole("button", { name: "カメラを起動", exact: true }).click();
  await expect(page.getByText("検出：名刺枠ロック済み", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "手動で撮影", exact: true }).click();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await assertCardEdges(page);
});

test("portrait card photos remain portrait after correction", async ({ page }) => {
  const buffer = await sharp(Buffer.from('<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#222"/><rect x="210" y="60" width="220" height="360" fill="#bdd9e9"/><path d="M250 180H390 M250 210H390" stroke="#333" stroke-width="5"/></svg>')).png().toBuffer();
  await page.goto("/scan");
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer });
  await expect(page.locator(".draft-card")).toHaveCount(1);
  const draft = (await (await page.request.get("/api/drafts")).json()).items[0];
  const image = await page.request.get(draft.correctedImageUrl);
  const metadata = await sharp(await image.body()).metadata();
  expect(metadata.height!).toBeGreaterThan(metadata.width! + 100);
});

test("explicitly cropped images retain their shape even if OpenCV cannot load", async ({ page }) => {
  await page.route("**/vendor/opencv.js", (route) => route.abort());
  await page.goto("/scan");
  await page.getByLabel("名刺だけを長方形に切り抜いた画像", { exact: true }).check();
  const buffer = await sharp({ create: { width: 400, height: 250, channels: 3, background: "#bdd9e9" } }).png().toBuffer();
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles({ name: "cropped.png", mimeType: "image/png", buffer });
  await expect(page.locator(".draft-card")).toHaveCount(1);
  const draft = (await (await page.request.get("/api/drafts")).json()).items[0];
  const image = await page.request.get(draft.correctedImageUrl);
  const metadata = await sharp(await image.body()).metadata();
  expect([metadata.width, metadata.height]).toEqual([400, 250]);
});
