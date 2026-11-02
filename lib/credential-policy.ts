export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validUsername(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(value);
}

export function validPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 128 &&
    value.trim().length > 0
  );
}

export const usernameHint =
  "3〜32文字の半角英数字・ハイフン・アンダースコア・ピリオド。先頭は英数字。大文字と小文字は区別しません。";
export const passwordHint =
  "12〜128文字で設定してください。他のサービスと同じパスワードは使わないでください。";
