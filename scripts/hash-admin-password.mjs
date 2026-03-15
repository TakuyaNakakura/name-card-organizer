import { randomBytes, scryptSync } from "node:crypto";

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run admin:hash -- '<password>'");
  process.exit(1);
}

const salt = randomBytes(16);
const derivedKey = scryptSync(password, salt, KEY_LENGTH);
console.log(
  `${HASH_PREFIX}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`
);
