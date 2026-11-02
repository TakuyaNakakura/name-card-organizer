import { getOptionalEnv } from "@/lib/env";

export function getTeamAuthMode(): "password" | "google" {
  const mode = getOptionalEnv("TEAM_AUTH_MODE") || "password";
  if (mode !== "password" && mode !== "google")
    throw new Error("TEAM_AUTH_MODE must be password or google");
  return mode;
}

export function getAuthSecret() {
  const secret =
    getOptionalEnv("BETTER_AUTH_SECRET") || getOptionalEnv("SESSION_SECRET");
  if (secret.length < 32)
    throw new Error(
      "Set BETTER_AUTH_SECRET or SESSION_SECRET (32+ characters)",
    );
  return secret;
}
