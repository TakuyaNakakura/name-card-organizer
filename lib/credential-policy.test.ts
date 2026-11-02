import { describe, expect, it } from "vitest";
import {
  normalizeUsername,
  validPassword,
  validUsername,
} from "./credential-policy";

describe("password account policy", () => {
  it("normalizes IDs and accepts the documented ASCII characters", () => {
    expect(normalizeUsername("  Team-01.User_2  ")).toBe("team-01.user_2");
    expect(validUsername(normalizeUsername("  Team-01.User_2  "))).toBe(true);
    expect(validUsername("a".repeat(32))).toBe(true);
  });
  it("rejects ambiguous, malformed and oversized IDs", () => {
    for (const value of [
      "ab",
      "_admin",
      "user@test",
      "管理者",
      "a b",
      "a/b",
      "a".repeat(33),
      null,
      123,
    ])
      expect(validUsername(value)).toBe(false);
  });
  it("allows password managers and passphrases without silently trimming", () => {
    expect(validPassword("correct horse battery staple")).toBe(true);
    expect(validPassword("a".repeat(128))).toBe(true);
    expect(validPassword("a".repeat(11))).toBe(false);
    expect(validPassword("a".repeat(129))).toBe(false);
    expect(validPassword(null)).toBe(false);
    expect(validPassword(" ".repeat(20))).toBe(false);
  });
});
