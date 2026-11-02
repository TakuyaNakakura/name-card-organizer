import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthSecret, getTeamAuthMode } from "./auth-config";
import { getPublicDeploymentIssues } from "./deployment";
afterEach(() => vi.unstubAllEnvs());
describe("team authentication configuration", () => {
  it("defaults to password and rejects misspelled modes", () => {
    vi.stubEnv("TEAM_AUTH_MODE", "");
    expect(getTeamAuthMode()).toBe("password");
    vi.stubEnv("TEAM_AUTH_MODE", "google");
    expect(getTeamAuthMode()).toBe("google");
    vi.stubEnv("TEAM_AUTH_MODE", "pasword");
    expect(() => getTeamAuthMode()).toThrow();
  });
  it("reuses the old session secret but never prefers it over Better Auth's secret", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("SESSION_SECRET", "a".repeat(48));
    expect(getAuthSecret()).toBe("a".repeat(48));
    vi.stubEnv("BETTER_AUTH_SECRET", "b".repeat(48));
    expect(getAuthSecret()).toBe("b".repeat(48));
    vi.stubEnv("BETTER_AUTH_SECRET", "too-short");
    expect(() => getAuthSecret()).toThrow();
  });
  it("does not require OAuth for a safe password deployment", () => {
    for (const [key, value] of Object.entries({
      ENFORCE_PUBLIC_DEPLOYMENT_GUARDS: "true",
      TEAM_AUTH_MODE: "password",
      DATABASE_URL: "postgres://example",
      BETTER_AUTH_SECRET: "",
      SESSION_SECRET: "s".repeat(48),
      BETTER_AUTH_URL: "https://example.test",
      CRON_SECRET: "c".repeat(48),
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      OCR_PROVIDER: "google",
      GOOGLE_CLOUD_CREDENTIALS_JSON: "{}",
      GOOGLE_APPLICATION_CREDENTIALS: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      ADMIN_PASSWORD: "",
      DATABASE_MIGRATION_URL: "",
      E2E_BYPASS_AUTH: "false",
    }))
      vi.stubEnv(key, value);
    expect(getPublicDeploymentIssues()).toEqual([]);
    vi.stubEnv("BOOTSTRAP_ADMIN_PASSWORD", "operator-only-password");
    expect(getPublicDeploymentIssues()).toContain(
      "BOOTSTRAP_ADMIN_PASSWORD is operator-only; remove it from the running application",
    );
    vi.stubEnv("BOOTSTRAP_ADMIN_PASSWORD", "");
    vi.stubEnv("TEAM_AUTH_MODE", "google");
    expect(getPublicDeploymentIssues()).toContain(
      "GOOGLE_CLIENT_ID is required for public deployment",
    );
  });
});
