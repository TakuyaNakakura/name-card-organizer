// @vitest-environment node
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const projectRequire = createRequire(import.meta.url);
const nextRequire = createRequire(projectRequire.resolve("next/package.json"));

function atLeast(actual: string, minimum: string) {
  if (!/^\d+\.\d+\.\d+$/.test(actual)) return false;
  const parts = actual.split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
}

it("keeps Next.js on the patched 15.x release line", () => {
  const version = projectRequire("next/package.json").version as string;
  expect(version.startsWith("15.")).toBe(true);
  expect(atLeast(version, "15.5.28")).toBe(true);
});

it("resolves a patched PostCSS from Next.js itself", () => {
  const version = nextRequire("postcss/package.json").version as string;
  expect(version.startsWith("8.")).toBe(true);
  expect(atLeast(version, "8.5.23")).toBe(true);
});

it("resolves the patched image library from Next.js itself", () => {
  expect(atLeast(nextRequire("sharp").versions.sharp, "0.35.5")).toBe(true);
});
