// Auth primitives: password hashing (scrypt) and HMAC-signed session cookies.
//
// `hashPassword` is intentionally non-deterministic so two registrations with
// the same password produce different hashes; `verifyPassword` is the only
// supported round-trip path. `signSessionCookie` / `verifySessionCookie`
// produce and verify an HMAC-SHA256 signature over `learnerId + iat + nonce`
// using a server-side secret auto-generated into `.tdr-session-secret` on
// first run. The cookie is HttpOnly, SameSite=Lax, Secure in production,
// Path=/, Max-Age=7d — see the route handlers that set it.
//
// The session secret lives at the repo root in `.tdr-session-secret` and is
// git-ignored. Tests inject `TDR_SESSION_SECRET` directly so the file path
// is not needed in CI.

import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

const SESSION_SECRET_PATH = resolve(process.cwd(), ".tdr-session-secret");
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

let cachedSessionSecret: Buffer | null = null;

function loadOrCreateSessionSecret(): Buffer {
  if (cachedSessionSecret) return cachedSessionSecret;
  if (process.env.TDR_SESSION_SECRET) {
    cachedSessionSecret = Buffer.from(process.env.TDR_SESSION_SECRET, "utf8");
    return cachedSessionSecret;
  }
  if (existsSync(SESSION_SECRET_PATH)) {
    cachedSessionSecret = readFileSync(SESSION_SECRET_PATH);
    return cachedSessionSecret;
  }
  const fresh = randomBytes(32);
  // Best-effort write; tests bypass this by setting TDR_SESSION_SECRET.
  try {
    writeFileSync(SESSION_SECRET_PATH, fresh, { mode: 0o600 });
  } catch {
    // Read-only filesystem or sandbox: keep using the in-memory value.
  }
  cachedSessionSecret = fresh;
  return cachedSessionSecret;
}

export type PasswordHash = string;

/**
 * Hash a plaintext password using scrypt with a per-password random salt.
 * Returns the standard `scrypt$N$r$p$saltB64$hashB64` envelope.
 */
export async function hashPassword(plain: string): Promise<PasswordHash> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(plain, salt, SCRYPT_KEYLEN);
  return `scrypt$${SCRYPT_N}$${SCRYPT_KEYLEN}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/**
 * Constant-time comparison of a plaintext password against a stored hash
 * produced by `hashPassword`. Returns false for any malformed envelope.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (typeof plain !== "string" || plain.length === 0) return false;
  if (typeof hash !== "string") return false;
  const parts = hash.split("$");
  if (parts.length !== 5 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const keylen = Number(parts[2]);
  if (!Number.isFinite(n) || !Number.isFinite(keylen)) return false;
  const salt = Buffer.from(parts[3], "base64");
  const expected = Buffer.from(parts[4], "base64");
  if (expected.length !== keylen) return false;
  const derived = await scrypt(plain, salt, keylen);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export const SESSION_COOKIE_NAME = "tdr_session";
export const SESSION_MAX_AGE = SESSION_MAX_AGE_SECONDS;

function sign(secret: Buffer, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type SessionPayload = {
  learnerId: string;
  iat: number;
  nonce: string;
};

/**
 * Sign a session cookie value for the given learner id. The cookie body is
 * `learnerId.iat.nonce.signature` with `signature = HMAC-SHA256(secret, body)`.
 */
export async function signSessionCookie(learnerId: string): Promise<string> {
  if (typeof learnerId !== "string" || learnerId.length === 0) {
    throw new Error("Learner id required");
  }
  const iat = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(8).toString("base64url");
  const body = `${learnerId}.${iat}.${nonce}`;
  const signature = sign(loadOrCreateSessionSecret(), body);
  return `${body}.${signature}`;
}

/**
 * Verify a session cookie value produced by `signSessionCookie`. Returns
 * the learner id on success or `null` for any failure (bad signature,
 * wrong shape, expired). The cookie max-age is enforced here.
 */
export async function verifySessionCookie(
  cookie: string | null | undefined,
): Promise<string | null> {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 4) return null;
  const [learnerId, iatStr, nonce, signature] = parts;
  if (!learnerId || !iatStr || !nonce || !signature) return null;
  const iat = Number(iatStr);
  if (!Number.isFinite(iat)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - iat > SESSION_MAX_AGE_SECONDS) return null;
  const expected = sign(loadOrCreateSessionSecret(), `${learnerId}.${iat}.${nonce}`);
  if (!timingEqualString(expected, signature)) return null;
  return learnerId;
}

/**
 * Internal: read the session secret directly. Used by tests that want to
 * pre-seed a secret for deterministic cookies.
 */
export function _setSessionSecretForTests(secret: string): void {
  cachedSessionSecret = Buffer.from(secret, "utf8");
  process.env.TDR_SESSION_SECRET = secret;
}