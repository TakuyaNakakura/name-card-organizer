export function sanitizeNextPath(
  candidate: string | null | undefined,
  fallback = "/scan"
) {
  if (!candidate) {
    return fallback;
  }

  const normalized = candidate.trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}
