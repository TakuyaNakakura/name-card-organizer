import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { PostgresDialect } from "kysely";
import { getRequiredEnv } from "@/lib/env";
import {
  acceptInvitation,
  invited,
  sessionForUser,
  teamSql,
} from "@/lib/team-db";

function buildAuth() {
  return betterAuth({
    appName: "名刺インボックス",
    baseURL: getRequiredEnv("BETTER_AUTH_URL"),
    secret: getRequiredEnv("BETTER_AUTH_SECRET"),
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
    emailAndPassword: { enabled: false },
    socialProviders:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
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
    rateLimit: { enabled: true, storage: "database", window: 60, max: 40 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) =>
            user.emailVerified && (await invited(user.email))
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
            return user?.emailVerified &&
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
  return (instance ??= buildAuth());
}
