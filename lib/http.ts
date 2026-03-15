import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { sanitizeNextPath } from "@/lib/url";

export function isE2EBypassEnabled() {
  return process.env.E2E_BYPASS_AUTH === "true";
}

export function getClientAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function requireSession() {
  if (isE2EBypassEnabled()) {
    return;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    throw new Error("Unauthorized");
  }

  await verifySessionToken(token);
}

export async function requirePageSession(nextPath: string) {
  if (isE2EBypassEnabled()) {
    return;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    redirect(`/login?next=${encodeURIComponent(sanitizeNextPath(nextPath))}`);
  }

  try {
    await verifySessionToken(token);
  } catch {
    redirect(`/login?next=${encodeURIComponent(sanitizeNextPath(nextPath))}`);
  }
}
