import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { provisionSession } from "./support";
test.beforeEach(async ({ context, page }) => {
  await provisionSession(context);
  page.on("dialog", (dialog) => dialog.accept());
});
async function upload(page: import("@playwright/test").Page) {
  const before = await page.locator(".draft-card").count();
  const image = await sharp({
    create: { width: 800, height: 500, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("画像を選択", { exact: true })
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await expect(page.locator(".draft-card")).toHaveCount(before + 1);
  await expect(
    page.getByText("下書きを保存しました。まだチームには共有されていません。"),
  ).toBeVisible();
}
test("operations shows the hourly member and team OCR limits", async ({ page }) => {
  await page.goto("/settings/operations");
  await expect(
    page.getByText("今の時間帯のOCR実行予約：0 / 150回（各メンバー100回まで）"),
  ).toBeVisible();
});
test("upload, optional email, sharing, editing, CSV and trash recovery", async ({
  page,
  browser,
  context,
}) => {
  const session = await provisionSession(context);
  await page.goto("/scan");
  await upload(page);
  await page.getByLabel("名前", { exact: false }).fill("山田 花子");
  await page.getByLabel("メールアドレス", { exact: false }).fill("");
  await expect(
    page.getByRole("button", { name: "確認してチームに登録", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "確認してチームに登録", exact: true })
    .click();
  await expect(
    page.getByText("山田 花子をチームに登録しました。"),
  ).toBeVisible();
  await page.goto("/cards");
  await page.getByRole("link", { name: "山田 花子", exact: true }).click();
  await page.getByLabel("役職", { exact: false }).fill("チーム責任者");
  await page.getByRole("button", { name: "変更をチームに反映" }).click();
  await expect(
    page.getByText("更新しました。チーム全員に反映されます。"),
  ).toBeVisible();
  const other = await browser.newContext();
  await provisionSession(other, session.teamId, "member");
  const peer = await other.newPage();
  await peer.goto(page.url());
  await expect(
    peer.getByText("登録者または管理者だけが編集・削除できます。"),
  ).toBeVisible();
  const csv = await page.request.get("/api/cards/export");
  expect(csv.status()).toBe(200);
  expect((await csv.body()).subarray(0, 3)).toEqual(
    Buffer.from([239, 187, 191]),
  );
  expect(await csv.text()).toContain("山田 花子");
  await page.getByRole("button", { name: "ごみ箱に移動" }).click();
  await expect(page.getByText("名刺をごみ箱に移動しました。")).toBeVisible();
  await page.goto("/settings/trash");
  await page.getByRole("button", { name: "名刺を復元" }).click();
  await expect(page.getByText("復元できる名刺はありません。")).toBeVisible();
  await page.goto("/cards");
  await expect(
    page.getByRole("link", { name: "山田 花子", exact: true }),
  ).toBeVisible();
  await other.close();
});
test("mode switches and single registration do not discard queued drafts", async ({
  page,
}) => {
  await page.goto("/scan");
  await page.getByLabel("連続スキャン", { exact: true }).check();
  await upload(page);
  await upload(page);
  await expect(page.locator(".draft-card")).toHaveCount(2);
  await page.getByLabel("単発スキャン", { exact: true }).check();
  await page
    .getByRole("button", { name: "確認してチームに登録", exact: true })
    .first()
    .click();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await expect(page).toHaveURL(/\/scan$/);
  await page.reload();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await page.goto("/drafts");
  await expect(page.locator(".draft-card")).toHaveCount(1);
});
test("mode cannot change during OCR, then results remain visible", async ({
  page,
}) => {
  await page.route("**/api/scans", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto("/scan");
  const image = await sharp({
    create: { width: 400, height: 250, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("画像を選択", { exact: true })
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await expect(page.getByLabel("連続スキャン", { exact: true })).toBeDisabled();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await expect(page.getByLabel("連続スキャン", { exact: true })).toBeEnabled();
});
test("batch partial failure retains failed drafts and retries without duplicates", async ({
  page,
}) => {
  await page.goto("/scan");
  await page.getByLabel("連続スキャン", { exact: true }).check();
  await upload(page);
  await upload(page);
  await page.route(
    "**/api/cards/batch",
    async (route) => {
      const body = route.request().postDataJSON();
      body.items[0].version += 100;
      await route.continue({ postData: JSON.stringify(body) });
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "確認済みの名刺をまとめて登録" })
    .click();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await expect(
    page.getByRole("alert").filter({ hasText: "下書きが変更" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "確認済みの名刺をまとめて登録" })
    .click();
  await expect(page.locator(".draft-card")).toHaveCount(0);
  const response = await page.request.get("/api/cards");
  expect((await response.json()).total).toBe(2);
});
test("real OpenCV detection automatically captures once until card removal", async ({
  page,
}) => {
  let scans = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/scans")) scans++;
  });
  await page.goto("/scan");
  await page.getByLabel("連続スキャン", { exact: true }).check();
  await page.getByRole("button", { name: "カメラを起動", exact: true }).click();
  await expect(page.locator(".draft-card")).toHaveCount(1, { timeout: 30000 });
  await page.waitForTimeout(1200);
  expect(scans).toBe(1);
  await page
    .getByRole("button", { name: "自動撮影を一時停止", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "手動で撮影", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "自動撮影を一時停止しています。" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/team-scan-mobile.png",
    fullPage: true,
  });
});
test("unauthenticated API access stays rejected without a test bypass", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const response = await context.request.get("http://127.0.0.1:3100/api/cards");
  expect(response.status()).toBe(401);
  await context.close();
});

test("autosave serializes edits and preserves an undo while a save is in flight", async ({
  page,
}) => {
  await page.goto("/scan");
  await upload(page);
  const name = page.getByLabel("名前", { exact: false }),
    original = await name.inputValue();
  await name.fill("一時的な変更");
  await name.fill(original);
  await expect(page.getByLabel("連続スキャン", { exact: true })).toBeEnabled();
  await page.route("**/api/drafts/*", async (route) => {
    if (route.request().method() === "PATCH")
      await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await name.fill("保存中の変更");
  await page.waitForRequest(
    (request) =>
      request.method() === "PATCH" && request.url().includes("/api/drafts/"),
  );
  await name.fill(original);
  await expect(
    page.getByRole("button", { name: "確認してチームに登録", exact: true }),
  ).toBeEnabled({ timeout: 10000 });
  await page.reload();
  await expect(name).toHaveValue(original);
});

test("incomplete drafts remain saved without blocking other valid batch entries", async ({
  page,
}) => {
  await page.goto("/scan");
  await page.getByLabel("連続スキャン", { exact: true }).check();
  await upload(page);
  await upload(page);
  const invalid = page.locator(".draft-card").first();
  await invalid
    .getByLabel("メールアドレス", { exact: false })
    .fill("incomplete@");
  await expect(
    invalid.getByText("メールアドレスの形式を確認してください。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "確認済みの名刺をまとめて登録" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "確認済みの名刺をまとめて登録" })
    .click();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("メールアドレス", { exact: false })).toHaveValue(
    "incomplete@",
  );
});
