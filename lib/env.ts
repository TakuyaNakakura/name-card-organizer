function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  return value.trim();
}

export function getRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function getOptionalEnv(name: string, fallback = ""): string {
  return readEnv(name) ?? fallback;
}

export function getOptionalIntEnv(name: string, fallback: number) {
  const raw = readEnv(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getStorageDriver(): "local" | "s3" {
  const driver = getOptionalEnv("STORAGE_DRIVER", "local");
  return driver === "s3" ? "s3" : "local";
}

export function getOcrProvider(): "google" | "mock" {
  const provider = getOptionalEnv("OCR_PROVIDER", "mock");
  return provider === "google" ? "google" : "mock";
}
