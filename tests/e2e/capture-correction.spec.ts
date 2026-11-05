import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { provisionSession } from "./support";

test.beforeEach(async ({ context }) => { await provisionSession(context); });

async function assertCorrectedImage(page: Page) {
  const drafts = (await (await page.request.get("/api/drafts")).json()).items;
  expect(drafts).toHaveLength(1);
  const corrected = await page.request.get(drafts[0].correctedImageUrl);
  await writeFile("/tmp/nco-corrected-card.jpg", await corrected.body());
  const { data, info } = await sharp(await corrected.body()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBeGreaterThan(300);
  expect(info.width).toBeLessThan(430);
  expect(info.height).toBeGreaterThan(180);
  expect(info.height).toBeLessThan(270);
  const centers: number[] = [];
  for (let x = Math.round(info.width * 0.25); x < info.width * 0.75; x += 10) {
    const dark: number[] = [];
    for (let y = Math.round(info.height * 0.18); y < info.height * 0.6; y++) {
      if (data[(y * info.width + x) * info.channels] < 100) dark.push(y);
    }
    expect(dark.length).toBeGreaterThanOrEqual(2);
    expect(dark.length).toBeLessThan(info.height * 0.08);
    centers.push(dark.reduce((sum, y) => sum + y, 0) / dark.length);
  }
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(5);
  const original = await page.request.get(drafts[0].originalImageUrl);
  expect((await sharp(await original.body()).metadata()).width).toBe(640);
}

test("automatic capture deskews the tilted camera frame before storing and sharing", async ({ page }) => {
  await page.goto("/scan");
  await page.getByRole("button", { name: "カメラを起動", exact: true }).click();
  await expect(page.locator(".draft-card")).toHaveCount(1, { timeout: 30000 });
  await assertCorrectedImage(page);
  const correctedUrl = await page.locator(".draft-card img").getAttribute("src");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "確認してチームに登録", exact: true }).click();
  await expect(page.getByText("Jane Doeをチームに登録しました。")).toBeVisible();
  const cards = (await (await page.request.get("/api/cards")).json()).items;
  expect(cards[0].correctedImageUrl).toBe(correctedUrl);
  await page.goto(`/cards/${cards[0].id}`);
  await expect(page.getByAltText("登録した名刺。画像を開いて拡大")).toHaveAttribute("src", correctedUrl!);
  await page.screenshot({ path: "/tmp/nco-capture-mobile.png", fullPage: false });
});

test("manual capture uses snapshot coordinates even if the live analysis canvas changes during encoding", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      original.call(this, (blob) => {
        if ((window as any).__resizeAnalysisDuringCapture) {
          (window as any).__resizeAnalysisDuringCapture = false;
          const liveAnalysis = document.querySelector<HTMLCanvasElement>("canvas[hidden]");
          if (liveAnalysis) { liveAnalysis.width *= 2; liveAnalysis.height *= 2; }
        }
        callback(blob);
      }, type, quality);
    };
  });
  await page.goto("/scan");
  await page.getByRole("button", { name: "自動撮影を一時停止", exact: true }).click();
  await page.getByRole("button", { name: "カメラを起動", exact: true }).click();
  await expect(page.getByText("検出：名刺枠ロック済み", { exact: false })).toBeVisible();
  await page.evaluate(() => { (window as any).__resizeAnalysisDuringCapture = true; });
  await page.getByRole("button", { name: "手動で撮影", exact: true }).click();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await assertCorrectedImage(page);
});

test("uncorrectable camera snapshots show a retake message without uploading or OCR", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (args[0] instanceof HTMLVideoElement) {
        this.fillStyle = "#222";
        this.fillRect(0, 0, this.canvas.width, this.canvas.height);
        return;
      }
      return (original as any).apply(this, args);
    };
  });
  let uploads = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/scans")) uploads++; });
  await page.goto("/scan");
  await page.getByRole("button", { name: "自動撮影を一時停止", exact: true }).click();
  await page.getByRole("button", { name: "カメラを起動", exact: true }).click();
  await expect(page.getByText("OpenCV：読み込み完了", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "手動で撮影", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "名刺の四隅を確認できませんでした" })).toBeVisible();
  expect(uploads).toBe(0);
  await expect(page.locator(".draft-card")).toHaveCount(0);
});

for (const angle of [-22, 0, 22]) {
  test(`image selection still corrects a card tilted ${angle} degrees`, async ({ page }) => {
    const image = await sharp(Buffer.from(`<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#222"/><g transform="rotate(${angle} 320 240)"><rect x="130" y="130" width="380" height="220" fill="#eee"/><rect x="190" y="200" width="260" height="6" fill="#333"/></g></svg>`)).png().toBuffer();
    await page.goto("/scan");
    await expect(page.getByText("OpenCV：読み込み完了", { exact: false })).toBeVisible();
    await page.getByLabel("画像を選択", { exact: true }).setInputFiles({ name: "tilted.png", mimeType: "image/png", buffer: image });
    await expect(page.locator(".draft-card")).toHaveCount(1);
    await assertCorrectedImage(page);
  });
}

test("image selection corrects a trapezoid without clipping the horizontal marker", async ({ page }) => {
  const image = await sharp(Buffer.from(`<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#222"/><polygon points="150,130 490,130 520,350 120,350" fill="#eee"/><rect x="190" y="200" width="260" height="6" fill="#333"/></svg>`)).png().toBuffer();
  await page.goto("/scan");
  await expect(page.getByText("OpenCV：読み込み完了", { exact: false })).toBeVisible();
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles({ name: "perspective.png", mimeType: "image/png", buffer: image });
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await assertCorrectedImage(page);
});
