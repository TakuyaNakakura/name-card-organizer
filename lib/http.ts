import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api-error";
import { sessionForUser } from "@/lib/team-db";
import { sanitizeNextPath } from "@/lib/url";
import { getTeamAuthMode } from "@/lib/auth-config";

export async function requireSession({ allowPasswordChange = false } = {}) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session)
    throw new ApiError(401, "UNAUTHENTICATED", "ログインしてください。");
  const member = await sessionForUser(session.user.id);
  if (!member)
    throw new ApiError(
      403,
      "MEMBERSHIP_REQUIRED",
      "このチームへの参加が許可されていません。管理者に確認してください。",
    );
  if (
    !allowPasswordChange &&
    getTeamAuthMode() === "password" &&
    member.passwordChangeRequired
  )
    throw new ApiError(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "利用を開始する前にパスワードを変更してください。",
    );
  return member;
}
export async function requirePageSession(
  nextPath: string,
  allowPasswordChange = false,
) {
  try {
    return await requireSession({ allowPasswordChange });
  } catch (error) {
    if (error instanceof ApiError && error.code === "PASSWORD_CHANGE_REQUIRED")
      redirect("/settings/account");
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
