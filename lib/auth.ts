import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { Pool } from "pg";
import { PostgresDialect } from "kysely";
import { getRequiredEnv } from "@/lib/env";
import { getAuthSecret, getTeamAuthMode } from "@/lib/auth-config";
import { validUsername } from "@/lib/credential-policy";
import { assertPublicDeploymentSafety } from "@/lib/deployment";
import {
  acceptInvitation,
  invited,
  sessionForUser,
  teamSql,
} from "@/lib/team-db";

function buildAuth() {
  const passwordMode = getTeamAuthMode() === "password";
  return betterAuth({
    appName: "名刺インボックス",
    baseURL: getRequiredEnv("BETTER_AUTH_URL"),
    secret: getAuthSecret(),
    database: {
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: getRequiredEnv("DATABASE_URL"),
          max: process.env.VERCEL ? 1 : 3,
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 20000,
        }),
      }),
      type: "postgres",
      schemaName: "name_card_auth",
    },
    emailAndPassword: {
      enabled: passwordMode,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/is-username-available",
      "/update-user",
      "/change-email",
      "/delete-user",
      "/request-password-reset",
      "/reset-password",
      "/set-password",
      "/change-password",
      "/link-social",
      "/unlink-account",
      ...(passwordMode ? ["/sign-in/social"] : ["/sign-in/username"]),
    ],
    plugins: [
      username({
        displayUsername: false,
        immutableUsername: true,
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: validUsername,
        validationOrder: { username: "post-normalization" },
      }),
    ],
    socialProviders:
      !passwordMode &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: getRequiredEnv("GOOGLE_CLIENT_ID"),
              clientSecret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
              prompt: "select_account",
            },
          }
        : {},
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: "nco-team",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 40,
      customRules: { "/sign-in/username": { window: 60, max: 20 } },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) =>
            !passwordMode && user.emailVerified && (await invited(user.email))
              ? { data: user }
              : false,
          after: async (user) => {
            await acceptInvitation(user.id, user.email);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            if (await sessionForUser(session.userId)) return { data: session };
            // Recover an interrupted first sign-in without admitting uninvited users.
            const [user] =
              await teamSql()`select email,"emailVerified" from name_card_auth."user" where id=${session.userId}`;
            return !passwordMode &&
              user?.emailVerified &&
              (await acceptInvitation(session.userId, user.email))
              ? { data: session }
              : false;
          },
        },
      },
    },
  });
}
let instance: ReturnType<typeof buildAuth> | undefined;
export function getAuth() {
  assertPublicDeploymentSafety();
  return (instance ??= buildAuth());
}
