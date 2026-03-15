import { describe, expect, it } from "vitest";

import { extractStorageKeyFromAssetUrl } from "@/lib/storage";

describe("extractStorageKeyFromAssetUrl", () => {
  it("extracts storage keys from relative asset URLs", () => {
    expect(
      extractStorageKeyFromAssetUrl("/api/assets/drafts/123/corrected.jpg")
    ).toBe("drafts/123/corrected.jpg");
  });

  it("extracts storage keys from absolute asset URLs", () => {
    expect(
      extractStorageKeyFromAssetUrl(
        "https://example.com/api/assets/drafts/123/original.jpg"
      )
    ).toBe("drafts/123/original.jpg");
  });

  it("returns null for non-asset URLs", () => {
    expect(extractStorageKeyFromAssetUrl("/cards")).toBeNull();
  });
});
