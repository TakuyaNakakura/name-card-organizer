// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const read = (file: string) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const ignored = read(".vercelignore")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

describe("Vercel deployment source", () => {
  it("excludes test configs together with their removed helpers", () => {
    for (const file of [
      "tests",
      "playwright.config.ts",
      "vitest.config.ts",
      "vitest.integration.config.ts",
      "**/*.test.ts",
      "**/*.test.tsx",
    ])
      expect(ignored).toContain(file);
  });

  it("excludes local credentials and fixtures", () => {
    expect(ignored).toContain(".env*");
    expect(ignored).toContain("secrets");
  });

  it("uses the npm lifecycle so OpenCV is prepared before Next.js builds", () => {
    const vercel = JSON.parse(read("vercel.json"));
    const pkg = JSON.parse(read("package.json"));
    expect(vercel.buildCommand).toBe("npm run build");
    expect(pkg.scripts.prebuild).toBe("npm run sync:opencv");
    expect(pkg.scripts.build).toBe("next build");
  });

  it("keeps application type checking enabled", () => {
    expect(nextConfig.typescript?.ignoreBuildErrors).not.toBe(true);
    expect(JSON.parse(read("tsconfig.json")).compilerOptions.strict).toBe(true);
  });
});
