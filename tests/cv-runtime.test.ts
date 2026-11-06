import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  delete window.cv;
  document.querySelectorAll('script[data-opencv-runtime="true"]').forEach((script) => script.remove());
});
const module = { getBuildInformation: () => "test runtime" };

it("shares one initialization and waits for the loaded module", async () => {
  vi.resetModules();
  const { ensureCvRuntime } = await import("@/components/scan/camera-utils");
  const first = ensureCvRuntime(), second = ensureCvRuntime();
  expect(first).toBe(second);
  expect(document.querySelectorAll('script[data-opencv-runtime="true"]')).toHaveLength(1);
  window.cv = Promise.resolve(module);
  document.querySelector("script")!.dispatchEvent(new Event("load"));
  expect(await first).toBe(module);
});

it("allows a user retry after a script load failure", async () => {
  vi.resetModules();
  const { ensureCvRuntime } = await import("@/components/scan/camera-utils");
  const first = ensureCvRuntime();
  const failed = expect(first).rejects.toThrow("画像補正を読み込めませんでした");
  document.querySelector("script")!.dispatchEvent(new Event("error"));
  await failed;
  expect(document.querySelector("script")).toBeNull();
  const retried = ensureCvRuntime();
  window.cv = module;
  document.querySelector("script")!.dispatchEvent(new Event("load"));
  expect(await retried).toBe(module);
});

it("times out initialization without keeping a permanently rejected cache", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const { ensureCvRuntime } = await import("@/components/scan/camera-utils");
  const first = ensureCvRuntime();
  const failed = expect(first).rejects.toThrow("画像補正を読み込めませんでした");
  await vi.advanceTimersByTimeAsync(15000);
  await failed;
  window.cv = module;
  expect(await ensureCvRuntime()).toBe(module);
  expect(vi.getTimerCount()).toBe(0);
});
