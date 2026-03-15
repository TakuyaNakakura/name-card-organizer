import { afterEach, describe, expect, it } from "vitest";

import { createPasswordHash, validateAdminPassword } from "@/lib/password";

const originalAdminPassword = process.env.ADMIN_PASSWORD;
const originalAdminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

afterEach(() => {
  if (typeof originalAdminPassword === "string") {
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  } else {
    delete process.env.ADMIN_PASSWORD;
  }

  if (typeof originalAdminPasswordHash === "string") {
    process.env.ADMIN_PASSWORD_HASH = originalAdminPasswordHash;
  } else {
    delete process.env.ADMIN_PASSWORD_HASH;
  }
});

describe("validateAdminPassword", () => {
  it("accepts the legacy plain-text env in non-public setups", () => {
    process.env.ADMIN_PASSWORD = "dev-password";
    delete process.env.ADMIN_PASSWORD_HASH;

    expect(validateAdminPassword("dev-password")).toBe(true);
    expect(validateAdminPassword("wrong-password")).toBe(false);
  });

  it("accepts hashed admin passwords", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD_HASH = createPasswordHash("strong-password");

    expect(validateAdminPassword("strong-password")).toBe(true);
    expect(validateAdminPassword("wrong-password")).toBe(false);
  });
});
