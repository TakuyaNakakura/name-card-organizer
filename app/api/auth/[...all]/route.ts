import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import {
  apiError,
  assertSameOrigin,
  readJson,
  ApiError,
} from "@/lib/api-error";
import { getTeamAuthMode } from "@/lib/auth-config";
import { normalizeUsername, validUsername } from "@/lib/credential-policy";
import { consumeCredentialAttempt } from "@/lib/credentials";
import { getClientAddress } from "@/lib/http";
import { assertPublicDeploymentSafety } from "@/lib/deployment";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}
export async function POST(request: Request) {
  try {
    assertPublicDeploymentSafety();
    if (new URL(request.url).pathname === "/api/auth/sign-in/username") {
      assertSameOrigin(request);
      if (getTeamAuthMode() !== "password")
        throw new ApiError(
          404,
          "NOT_FOUND",
          "この認証方式では利用できません。",
        );
      const body = await readJson(request);
      const username =
        typeof body.username === "string"
          ? normalizeUsername(body.username)
          : "";
      if (
        !validUsername(username) ||
        typeof body.password !== "string" ||
        !body.password ||
        body.password.length > 128
      )
        throw new ApiError(
          422,
          "INVALID_CREDENTIALS",
          "ユーザーIDとパスワードを確認してください。",
        );
      await consumeCredentialAttempt(
        `login-ip:${getClientAddress(request)}`,
        60,
      );
      await consumeCredentialAttempt(`login:${username}`);
      // Forward only the supported fields to Better Auth, with a bounded body.
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      request = new Request(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          username,
          password: body.password,
          rememberMe: false,
        }),
      });
    }
    return await toNextJsHandler(getAuth()).POST(request);
  } catch (error) {
    return apiError(error);
  }
}
