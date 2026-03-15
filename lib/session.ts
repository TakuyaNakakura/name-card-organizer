import { jwtVerify, SignJWT } from "jose";
import type { JWTPayload } from "jose";

import type { CardDraftTokenPayload } from "@/lib/types";
import { getRequiredEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "name_card_session";

const encoder = new TextEncoder();
const SESSION_AUDIENCE = "name-card-session";
const DRAFT_AUDIENCE = "name-card-draft";

function getSecret() {
  return encoder.encode(getRequiredEnv("SESSION_SECRET"));
}

export async function signSessionToken() {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifySessionToken(token: string) {
  const verified = await jwtVerify(token, getSecret(), {
    audience: SESSION_AUDIENCE
  });

  return verified.payload;
}

export async function signDraftToken(payload: CardDraftTokenPayload) {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("scan-draft")
    .setAudience(DRAFT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSecret());
}

export async function verifyDraftToken(token: string) {
  const verified = await jwtVerify<CardDraftTokenPayload>(token, getSecret(), {
    audience: DRAFT_AUDIENCE
  });

  return verified.payload;
}
