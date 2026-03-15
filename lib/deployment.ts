import {
  getOptionalEnv,
  getOcrProvider,
  getStorageDriver
} from "@/lib/env";

function hasValue(name: string) {
  return getOptionalEnv(name).length > 0;
}

export function shouldEnforcePublicDeploymentGuards() {
  const vercelEnv = getOptionalEnv("VERCEL_ENV");
  const runningOnVercel = getOptionalEnv("VERCEL") === "1";

  return (
    (runningOnVercel && vercelEnv !== "development") ||
    getOptionalEnv("ENFORCE_PUBLIC_DEPLOYMENT_GUARDS") === "true"
  );
}

export function getPublicDeploymentIssues() {
  if (!shouldEnforcePublicDeploymentGuards()) {
    return [];
  }

  const issues: string[] = [];
  const sessionSecret = getOptionalEnv("SESSION_SECRET");

  if (process.env.E2E_BYPASS_AUTH === "true") {
    issues.push("E2E_BYPASS_AUTH must be disabled");
  }

  if (hasValue("ADMIN_PASSWORD")) {
    issues.push("ADMIN_PASSWORD must not be set for public deployment");
  }

  if (getStorageDriver() === "local") {
    issues.push("STORAGE_DRIVER=local is not allowed for public deployment");
  }

  if (getOcrProvider() === "mock") {
    issues.push("OCR_PROVIDER=mock is not allowed for public deployment");
  }

  if (!hasValue("ADMIN_PASSWORD_HASH")) {
    issues.push("ADMIN_PASSWORD_HASH is required for public deployment");
  }

  if (sessionSecret.length < 32) {
    issues.push("SESSION_SECRET must be at least 32 characters for public deployment");
  }

  if (getOcrProvider() === "google") {
    if (
      !hasValue("GOOGLE_CLOUD_CREDENTIALS_JSON") &&
      !hasValue("GOOGLE_APPLICATION_CREDENTIALS")
    ) {
      issues.push(
        "Google OCR requires GOOGLE_CLOUD_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS"
      );
    }
  }

  if (getStorageDriver() === "s3") {
    for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      if (!hasValue(name)) {
        issues.push(`${name} is required when STORAGE_DRIVER=s3`);
      }
    }
  }

  return issues;
}

export function assertPublicDeploymentSafety() {
  const issues = getPublicDeploymentIssues();
  if (issues.length > 0) {
    throw new Error(`Unsafe public deployment configuration: ${issues.join("; ")}`);
  }
}
