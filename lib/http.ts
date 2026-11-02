import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api-error";
import { sessionForUser } from "@/lib/team-db";
import { sanitizeNextPath } from "@/lib/url";

export async function requireSession() {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session)
    throw new ApiError(
      401,
      "UNAUTHENTICATED",
      "Googleアカウントでログインしてください。",
    );
  const member = await sessionForUser(session.user.id);
  if (!member)
    throw new ApiError(
      403,
      "MEMBERSHIP_REQUIRED",
      "このチームへの参加が許可されていません。管理者に確認してください。",
    );
  return member;
}
export async function requirePageSession(nextPath: string) {
  try {
    return await requireSession();
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      redirect(
        `/login?next=${encodeURIComponent(sanitizeNextPath(nextPath))}&reason=${error.code}`,
      );
    }
    throw error;
  }
}
export function getClientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
