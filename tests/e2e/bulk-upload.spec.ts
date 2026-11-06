import { test, expect } from "@playwright/test";
import sharp from "sharp";
import postgres from "postgres";
import { rm } from "node:fs/promises";
import path from "node:path";
import { provisionSession, testUrl } from "./support";

test.beforeEach(async ({ context, page }) => {
  await provisionSession(context);
  await page.goto("/scan");
  await page.getByLabel("名刺だけを長方形に切り抜いた画像", { exact: true }).check();
});

async function photos(count: number) {
  const buffer = await sharp({ create: { width: 400, height: 250, channels: 3, background: "white" } }).png().toBuffer();
  return Array.from({ length: count }, (_, index) => ({ name: `card-${index}.png`, mimeType: "image/png", buffer }));
}

test("rejects 101 selections and imports 50 photos in one selection", async ({ page }) => {
  test.setTimeout(120000);
  const input = page.getByLabel("画像を選択", { exact: true });
  await input.setInputFiles(await photos(101));
  await expect(page.getByRole("alert").filter({ hasText: "100枚まで" })).toBeVisible();
  await input.setInputFiles(await photos(50));
  await expect(page.locator(".draft-card")).toHaveCount(50, { timeout: 100000 });
  await expect(page.getByLabel("連続スキャン", { exact: true })).toBeChecked();
  await expect(page.getByLabel("画像の取り込み状況")).toContainText("保存済み50枚・失敗0枚・未処理0枚");
  expect((await (await page.request.get("/api/cards")).json()).total).toBe(0);
});

test("continues past corrupt images and retains successful drafts", async ({ page }) => {
  const files = await photos(2);
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles([
    files[0], { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken") }, files[1],
  ]);
  const results = page.getByLabel("画像の取り込み状況");
  await expect(results).toContainText("保存済み2枚・失敗1枚・未処理0枚");
  await expect(page.locator(".draft-card")).toHaveCount(2);
  await page.getByRole("button", { name: "未処理・失敗分を再開" }).click();
  await expect(results).toContainText("保存済み2枚・失敗1枚・未処理0枚");
  await expect(page.getByRole("button", { name: "未処理・失敗分を再開" })).toBeEnabled();
  await expect(page.locator(".draft-card")).toHaveCount(2);
});

test("reconciles a lost successful response without duplicate OCR or drafts", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/scans", async (route) => {
    requests++;
    if (requests === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles(await photos(2));
  const results = page.getByLabel("画像の取り込み状況");
  await expect(results).toContainText("保存済み1枚・失敗1枚・未処理0枚");
  await page.getByRole("button", { name: "未処理・失敗分を再開" }).click();
  await expect(results).toContainText("保存済み2枚・失敗0枚・未処理0枚");
  await expect(page.locator(".draft-card")).toHaveCount(2);
  expect(requests).toBe(2);
});

test("halts at a quota response, then resumes only failed and pending photos", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/scans", async (route) => {
    requests++;
    if (requests === 2) await route.fulfill({ status: 429, json: { error: "読み取り回数の上限に達しました。", code: "SCAN_LIMIT" } });
    else await route.continue();
  });
  await page.getByLabel("画像を選択", { exact: true }).setInputFiles(await photos(3));
  const results = page.getByLabel("画像の取り込み状況");
  await expect(results).toContainText("保存済み1枚・失敗1枚・未処理1枚");
  expect(requests).toBe(2);
  await page.getByRole("button", { name: "未処理・失敗分を再開" }).click();
  await expect(results).toContainText("保存済み3枚・失敗0枚・未処理0枚");
  await expect(page.locator(".draft-card")).toHaveCount(3);
  expect(requests).toBe(4);
  await page.screenshot({ path: "/tmp/nco-bulk-upload-mobile.png", fullPage: true });
});

test("reuploads an explicitly retried photo if its stored image is unavailable", async ({ page }) => {
  const sql = postgres(testUrl, { max: 1, prepare: false });
  try {
    await page.route("**/api/scans", async (route) => {
      const response = await route.fetch();
      const draft = await response.json();
      const [asset] = await sql`select storage_key from name_card.assets where draft_id=${draft.id} and kind='corrected'`;
      await rm(path.join("/tmp/name-card-team-e2e", asset.storage_key));
      await sql`update name_card.drafts set status='failed',error_code='STORAGE_FAILED' where id=${draft.id}`;
      await route.abort("failed");
    }, { times: 1 });
    await page.getByLabel("画像を選択", { exact: true }).setInputFiles(await photos(1));
    await expect(page.getByLabel("画像の取り込み状況")).toContainText("失敗1枚");
    await page.getByRole("button", { name: "未処理・失敗分を再開" }).click();
    await expect(page.getByLabel("画像の取り込み状況")).toContainText("保存済み1枚・失敗0枚");
    await expect(page.locator(".draft-card")).toHaveCount(1);
    expect((await (await page.request.get("/api/drafts")).json()).items).toHaveLength(1);
  } finally {
    await sql.end();
  }
});
