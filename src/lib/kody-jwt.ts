// Kody JWT signer. TDR is the host half of the brand-chat-access
// delegated-client contract: it generates an RS256 keypair on first run,
// serves the public key at /.well-known/jwks.json, and signs a short-lived
// assertion per dashboard render that Kody verifies to open a scoped
// Brand Chat session.
//
// The keypair lives at prisma/keys/kody-private.pem + kody-public.pem and
// is git-ignored. The public JWK is exposed with `kid = "tdr-kody-1"` and
// `alg = "RS256"`, `use = "sig"` so Kody can match it against the kid it
// gets in the JWS header.

import {
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  JWK,
  KeyLike,
  SignJWT,
} from "jose";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  kodyClientIdentityAudience,
  kodyClientIdentityIssuer,
  kodyBrandSlug,
  kodyTenant,
} from "./kody-launch";

export const KODY_KEY_ID = "tdr-kody-1";
export const KODY_JWT_ALG = "RS256";
export const KODY_KEY_DIR = resolve(process.cwd(), "prisma/keys");
const KODY_PRIVATE_PATH = resolve(KODY_KEY_DIR, "kody-private.pem");
const KODY_PUBLIC_PATH = resolve(KODY_KEY_DIR, "kody-public.pem");

const ASSERTION_TTL_SECONDS = 300;

export type KodyKeypair = {
  privateKey: KeyLike;
  publicKey: KeyLike;
  publicJwk: JWK;
};

let cached: KodyKeypair | null = null;

async function loadOrCreate(): Promise<KodyKeypair> {
  if (cached) return cached;
  if (process.env.TDR_KODY_PRIVATE_PEM && process.env.TDR_KODY_PUBLIC_PEM) {
    const privateKey = (await importPKCS8(
      process.env.TDR_KODY_PRIVATE_PEM,
      KODY_JWT_ALG,
    )) as KeyLike;
    const publicKey = (await importSPKI(
      process.env.TDR_KODY_PUBLIC_PEM,
      KODY_JWT_ALG,
    )) as KeyLike;
    const publicJwk = await buildJwk(publicKey);
    cached = { privateKey, publicKey, publicJwk };
    return cached;
  }
  if (existsSync(KODY_PRIVATE_PATH) && existsSync(KODY_PUBLIC_PATH)) {
    const privatePem = readFileSync(KODY_PRIVATE_PATH, "utf8");
    const publicPem = readFileSync(KODY_PUBLIC_PATH, "utf8");
    const privateKey = (await importPKCS8(
      privatePem,
      KODY_JWT_ALG,
    )) as KeyLike;
    const publicKey = (await importSPKI(
      publicPem,
      KODY_JWT_ALG,
    )) as KeyLike;
    const publicJwk = await buildJwk(publicKey);
    cached = { privateKey, publicKey, publicJwk };
    return cached;
  }
  const { privateKey, publicKey } = await generateKeyPair(KODY_JWT_ALG, {
    modulusLength: 2048,
    extractable: true,
  });
  mkdirSync(KODY_KEY_DIR, { recursive: true });
  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);
  writeFileSync(KODY_PRIVATE_PATH, privatePem, { mode: 0o600 });
  writeFileSync(KODY_PUBLIC_PATH, publicPem, { mode: 0o644 });
  const publicJwk = await buildJwk(publicKey);
  cached = { privateKey, publicKey, publicJwk };
  return cached;
}

async function buildJwk(publicKey: KeyLike): Promise<JWK> {
  const jwk = await exportJWK(publicKey);
  jwk.kid = KODY_KEY_ID;
  jwk.alg = KODY_JWT_ALG;
  jwk.use = "sig";
  return jwk;
}

export async function getKodyKeypair(): Promise<KodyKeypair> {
  return loadOrCreate();
}

/**
 * Public JWKS document. Kody fetches this to verify assertions.
 */
export async function getJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await loadOrCreate();
  return { keys: [publicJwk] };
}

export type BuildLaunchAssertionInput = {
  learnerId: string;
};

/**
 * Build a single-use RS256 JWS that proves a learner is allowed to open a
 * scoped Brand Chat session on Kody. Required claims (per the
 * brand-chat-access contract):
 *   sub, aud, iss, iat, exp, jti, tenant_id, brand_slug.
 * `exp - iat` is held to exactly the 5-minute contract maximum.
 */
export async function buildLaunchAssertion(
  input: BuildLaunchAssertionInput,
): Promise<string> {
  const { privateKey } = await loadOrCreate();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ASSERTION_TTL_SECONDS;
  const jti = randomUUID();
  const jwt = new SignJWT({
    tenant_id: kodyTenant(),
    brand_slug: kodyBrandSlug(),
  })
    .setProtectedHeader({ alg: KODY_JWT_ALG, kid: KODY_KEY_ID, typ: "JWT" })
    .setSubject(input.learnerId)
    .setAudience(kodyClientIdentityAudience())
    .setIssuer(kodyClientIdentityIssuer())
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti);
  return jwt.sign(privateKey);
}

export const KODY_ASSERTION_TTL_SECONDS = ASSERTION_TTL_SECONDS;

/**
 * Internal: tests inject a deterministic keypair so the JWS / JWKS values
 * are stable across runs and don't touch the filesystem.
 */
export function _setKodyKeypairForTests(keypair: KodyKeypair | null): void {
  cached = keypair;
}

/**
 * Internal: ensure the on-disk key directory exists. Used by tests.
 */
export function _ensureKeyDirForTests(): void {
  if (!existsSync(KODY_KEY_DIR)) mkdirSync(KODY_KEY_DIR, { recursive: true });
}

export const KODY_KEY_PATHS = {
  private: KODY_PRIVATE_PATH,
  public: KODY_PUBLIC_PATH,
  dir: KODY_KEY_DIR,
};
void dirname; // re-exported for tests that need to compute alternates