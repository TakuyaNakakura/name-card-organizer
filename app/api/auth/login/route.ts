import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getOptionalIntEnv } from "@/lib/env";
import { getClientAddress } from "@/lib/http";
import { validateAdminPassword } from "@/lib/password";
import {
  incrementRateLimit,
  isRateLimited,
  resetRateLimit
} from "@/lib/rate-limit";
import { SESSION_COOKIE_NAME, signSessionToken } from "@/lib/session";
import { sanitizeNextPath } from "@/lib/url";

export const runtime = "nodejs";

const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = getOptionalIntEnv(
  "LOGIN_RATE_LIMIT_MAX_ATTEMPTS",
  8
);
const LOGIN_RATE_LIMIT_WINDOW_MS = getOptionalIntEnv(
  "LOGIN_RATE_LIMIT_WINDOW_MS",
  15 * 60 * 1000
);

function shouldUseSecureCookie(request: Request) {
  return process.env.NODE_ENV === "production" && new URL(request.url).protocol === "https:";
}

function redirectWithError(request: Request, nextPath: string, error: string) {
  const redirectUrl = new URL("/login", request.url);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeNextPath(String(formData.get("next") ?? "/scan"));
  const clientAddress = getClientAddress(request);
  const rateLimitInput = {
    key: "login",
    identifier: clientAddress,
    limit: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS
  };

  if (isRateLimited(rateLimitInput)) {
    return redirectWithError(
      request,
      nextPath,
      "試行回数が多すぎます。しばらく待ってから再試行してください"
    );
  }

  if (!validateAdminPassword(password)) {
    incrementRateLimit(rateLimitInput);
    return redirectWithError(request, nextPath, "パスワードが違います");
  }

  resetRateLimit(rateLimitInput);

  const token = await signSessionToken();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(request),
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
}
