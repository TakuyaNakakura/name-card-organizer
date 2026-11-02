import type { ContactFields } from "@/lib/team-types";

export function contactFieldErrors(
  fields: ContactFields,
  requireContact = true,
) {
  const errors: Record<string, string> = {};
  if (
    requireContact &&
    ![fields.fullName, fields.organization, fields.email].some((v) => v.trim())
  )
    errors.fullName =
      "名前・所属・メールアドレスのいずれかを入力してください。";
  // Incomplete drafts must remain autosaveable; format is enforced on confirmation.
  if (
    requireContact &&
    fields.email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)
  )
    errors.email = "メールアドレスの形式を確認してください。";
  for (const key of [
    "fullName",
    "organization",
    "jobTitle",
    "email",
  ] as const) {
    const value = fields[key];
    if (value.length > 500) errors[key] = "500文字以内で入力してください。";
  }
  return errors;
}

export function readContactFields(value: unknown): ContactFields | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const keys = ["fullName", "organization", "jobTitle", "email"] as const;
  if (keys.some((k) => typeof body[k] !== "string")) return null;
  return Object.fromEntries(
    keys.map((k) => [k, (body[k] as string).trim()]),
  ) as unknown as ContactFields;
}
