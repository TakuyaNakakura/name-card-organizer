import {
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

import { getOptionalEnv, getRequiredEnv } from "@/lib/env";

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;

function comparePlainText(candidate: string, configured: string) {
  const configuredBuffer = Buffer.from(configured);
  const submitted = Buffer.from(candidate);

  if (configuredBuffer.length !== submitted.length) {
    return false;
  }

  return timingSafeEqual(configuredBuffer, submitted);
}

function decodeHash(hash: string) {
  const [prefix, salt, key] = hash.split("$");
  if (prefix !== HASH_PREFIX || !salt || !key) {
    throw new Error("ADMIN_PASSWORD_HASH must use the scrypt$salt$key format");
  }

  return {
    salt: Buffer.from(salt, "base64url"),
    key: Buffer.from(key, "base64url")
  };
}

export function createPasswordHash(password: string) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export function validateAdminPassword(candidate: string): boolean {
  const configuredHash = getOptionalEnv("ADMIN_PASSWORD_HASH");
  if (configuredHash) {
    const { salt, key } = decodeHash(configuredHash);
    const submittedKey = scryptSync(candidate, salt, key.length);
    return timingSafeEqual(key, submittedKey);
  }

  const configuredPassword = getOptionalEnv("ADMIN_PASSWORD");
  if (configuredPassword) {
    return comparePlainText(candidate, configuredPassword);
  }

  getRequiredEnv("ADMIN_PASSWORD_HASH");
  return false;
}
