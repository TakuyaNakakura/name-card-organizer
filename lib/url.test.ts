import { describe, expect, it } from "vitest";

import { sanitizeNextPath } from "@/lib/url";

describe("sanitizeNextPath", () => {
  it("preserves internal relative paths", () => {
    expect(sanitizeNextPath("/cards?highlight=1")).toBe("/cards?highlight=1");
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeNextPath("https://example.com")).toBe("/scan");
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeNextPath("//example.com")).toBe("/scan");
  });
});
