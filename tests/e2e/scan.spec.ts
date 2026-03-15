import path from "node:path";

import { expect, test } from "@playwright/test";

test("upload fallback can complete the review flow", async ({ page }) => {
  await page.goto("/scan");
  await expect(page).toHaveURL(/\/scan$/);

  const fixturePath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "sample-card.svg"
  );
  await page.getByLabel("画像を選択").setInputFiles(fixturePath);

  await expect(page.getByLabel("メールアドレス")).toHaveValue("jane@example.com");
  await page.getByRole("button", { name: "保存する" }).click();

  await expect(page).toHaveURL(/\/cards\?highlight=/);
  const cardsBeforeDelete = await page.locator(".card-row").count();
  await expect(
    page.locator(".card-row--highlight").getByText("jane@example.com", { exact: true })
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".card-row--highlight").getByRole("button", { name: "削除" }).click();
  await expect(page.locator(".card-row")).toHaveCount(Math.max(cardsBeforeDelete - 1, 0));
});
