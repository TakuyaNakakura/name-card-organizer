import { describe, expect, it } from "vitest";

import { toIsoTimestamp } from "@/lib/db";

describe("toIsoTimestamp", () => {
  it("accepts Date instances", () => {
    const value = new Date("2026-03-16T01:23:45.000Z");
    expect(toIsoTimestamp(value)).toBe("2026-03-16T01:23:45.000Z");
  });

  it("accepts ISO timestamp strings", () => {
    expect(toIsoTimestamp("2026-03-16T01:23:45.000Z")).toBe(
      "2026-03-16T01:23:45.000Z"
    );
  });

  it("rejects invalid timestamps", () => {
    expect(() => toIsoTimestamp("not-a-date")).toThrow("Invalid timestamp value");
  });
});
