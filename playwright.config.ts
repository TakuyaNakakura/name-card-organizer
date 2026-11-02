import { defineConfig, devices } from "@playwright/test";
import { testSecret, testUrl } from "./tests/e2e/support";
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--use-file-for-fake-video-capture=/tmp/name-card-team-camera.y4m",
      ],
    },
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    port: 3100,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: testUrl,
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      BETTER_AUTH_SECRET: testSecret,
      OCR_PROVIDER: "mock",
      STORAGE_DRIVER: "local",
      LOCAL_UPLOAD_DIR: "/tmp/name-card-team-e2e",
      E2E_BYPASS_AUTH: "false",
    },
  },
  projects: [{ name: "Mobile Chrome", use: { ...devices["Pixel 7"] } }],
});
