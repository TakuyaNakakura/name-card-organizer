import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    env: {
      ADMIN_PASSWORD: "change-me",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:55433/name_card_organizer",
      SESSION_SECRET: "replace-with-a-long-random-secret-at-least-32-characters",
      OCR_PROVIDER: "mock",
      MOCK_OCR_TEXT: "Jane Doe\njane@example.com",
      STORAGE_DRIVER: "local",
      LOCAL_UPLOAD_DIR: "var/uploads",
      E2E_BYPASS_AUTH: "true"
    }
  },
  projects: [
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 7"]
      }
    }
  ]
});
