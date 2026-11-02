import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { provisionSession } from "./support";

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: false }).fill(username);
  await page.getByLabel("パスワード", { exact: false }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

test("administrator creates a member; real password login, required change and reset preserve identity", async ({
  page,
  context,
  browser,
}) => {
  await provisionSession(context);
  page.on("dialog", (dialog) => dialog.accept());
  const id = "team-" + randomUUID().slice(0, 8),
    name = "パスワード検証メンバー";
  await page.goto("/settings/members");
  await page.getByLabel("ユーザーID", { exact: false }).fill(id);
  await page.getByLabel("表示名", { exact: false }).fill(name);
  await page
    .getByRole("button", { name: "メンバーを追加", exact: true })
    .click();
  const temp = await page
    .getByLabel("一時パスワード", { exact: true })
    .inputValue();
  expect(temp.length).toBeGreaterThanOrEqual(12);
  await page.getByRole("button", { name: "ログイン情報を閉じる" }).click();
  await expect(page.getByLabel("一時パスワード", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "test-results/password-members-mobile.png",
    fullPage: true,
  });
  const peerContext = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `198.18.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
    },
  });
  const peer = await peerContext.newPage();
  try {
    await login(peer, id.toUpperCase(), temp);
    await expect(peer).toHaveURL(/\/settings\/account$/);
    expect((await peer.request.get("/api/cards")).status()).toBe(403);
    await peer.goto("/scan");
    await expect(peer).toHaveURL(/\/settings\/account$/);
    await peer
      .getByLabel("現在のパスワード", { exact: false })
      .fill("incorrect-password");
    await peer
      .getByLabel(/^新しいパスワード\s*必須$/)
      .fill("new-personal-passphrase-2026");
    await peer
      .getByLabel("新しいパスワード（確認）", { exact: false })
      .fill("new-personal-passphrase-2026");
    await peer.getByRole("button", { name: "変更してログアウト" }).click();
    await expect(
      peer.getByText("現在のパスワードが正しくありません。", { exact: true }),
    ).toBeVisible();
    await peer.getByLabel("現在のパスワード", { exact: false }).fill(temp);
    await peer.getByRole("button", { name: "変更してログアウト" }).click();
    await expect(peer).toHaveURL(/\/login\?reason=PASSWORD_CHANGED$/);
    await login(peer, id, "new-personal-passphrase-2026");
    await expect(peer).toHaveURL(/\/cards$/);
    expect((await peer.request.get("/api/cards")).status()).toBe(200);
    expect((await peer.request.get("/api/members")).status()).toBe(403);
    const article = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await article
      .getByRole("button", { name: "一時パスワードを再発行", exact: true })
      .click();
    const reissued = await page
      .getByLabel("一時パスワード", { exact: true })
      .inputValue();
    expect(reissued).not.toBe(temp);
    expect((await peer.request.get("/api/cards")).status()).toBe(401);
    await login(peer, id, "new-personal-passphrase-2026");
    await expect(
      peer.getByText(
        "ユーザーIDまたはパスワードが正しくないか、利用が停止されています。",
        { exact: true },
      ),
    ).toBeVisible();
    await login(peer, id, reissued);
    await expect(peer).toHaveURL(/\/settings\/account$/);
  } finally {
    await peerContext.close().catch(() => {});
  }
});

test("public signup, alternate password endpoints and cross-origin login are disabled", async ({
  request,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/login");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/password-login-mobile.png",
    fullPage: true,
  });
  const origin = "http://127.0.0.1:3100";
  for (const endpoint of [
    "sign-up/email",
    "sign-in/email",
    "change-password",
    "set-password",
    "update-user",
    "is-username-available",
  ])
    expect(
      (
        await request.post(`/api/auth/${endpoint}`, {
          headers: { origin },
          data: {
            username: "intruder",
            email: "intruder@example.test",
            password: "unauthorized-passphrase-2026",
            name: "侵入",
          },
        })
      ).status(),
    ).toBe(404);
  const crossOrigin = await request.post("/api/auth/sign-in/username", {
    headers: { origin: "https://attacker.example" },
    data: { username: "admin", password: "unauthorized-passphrase-2026" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(
    (
      await request.post("/api/account/password", {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(401);
});

test("distributed login attempts share a durable per-ID quota", async ({
  request,
}) => {
  const username = "unknown-" + randomUUID().slice(0, 8);
  const network = Math.floor(Math.random() * 256);
  for (let i = 0; i < 10; i++) {
    const result = await request.post("/api/auth/sign-in/username", {
      headers: {
        origin: "http://127.0.0.1:3100",
        "x-forwarded-for": `198.19.${network}.${100 + i}`,
      },
      data: { username, password: "invalid-passphrase-2026" },
    });
    expect(result.status()).toBe(401);
  }
  const blocked = await request.post("/api/auth/sign-in/username", {
    headers: {
      origin: "http://127.0.0.1:3100",
      "x-forwarded-for": "198.51.100.200",
    },
    data: {
      username: username.toUpperCase(),
      password: "invalid-passphrase-2026",
    },
  });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).error.code).toBe("CREDENTIAL_RATE_LIMIT");
});
