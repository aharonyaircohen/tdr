// Unit tests for src/lib/kody-jwt.ts — RS256 assertion signer + JWKS
// endpoint shape.

import { describe, it, expect, beforeAll } from "vitest";
import {
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  KeyLike,
} from "jose";
import {
  buildLaunchAssertion,
  getJwks,
  getKodyKeypair,
  KODY_ASSERTION_TTL_SECONDS,
  KODY_JWT_ALG,
  KODY_KEY_ID,
} from "@/lib/kody-jwt";
import {
  kodyClientIdentityAudience,
  kodyClientIdentityIssuer,
  kodyTenant,
  kodyBrandSlug,
} from "@/lib/kody-launch";

describe("Kody launch assertion (RS256)", () => {
  let publicKey: KeyLike;
  let publicJwk: import("jose").JWK;

  beforeAll(async () => {
    const kp = await getKodyKeypair();
    publicKey = kp.publicKey;
    publicJwk = kp.publicJwk;
  });

  it("signs an RS256 JWT with the canonical kid in the protected header", async () => {
    const assertion = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const header = decodeProtectedHeader(assertion);
    expect(header.alg).toBe(KODY_JWT_ALG);
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe(KODY_KEY_ID);
    expect(header.kid).toBe("tdr-kody-1");
    expect(header.typ).toBe("JWT");
  });

  it("includes every required contract claim with the right types", async () => {
    const assertion = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const payload = decodeJwt(assertion);
    expect(payload.sub).toBe("learner-abc");
    expect(payload.aud).toBe(kodyClientIdentityAudience());
    expect(payload.iss).toBe(kodyClientIdentityIssuer());
    expect(payload.iss).toBe("http://localhost:3000");
    expect(payload.aud).toBe("https://kody.dev");
    expect(payload.tenant_id).toBe(kodyTenant());
    expect(payload.tenant_id).toBe("aharonyaircohen/tdr");
    expect(payload.brand_slug).toBe(kodyBrandSlug());
    expect(payload.brand_slug).toBe("tdr-default");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect(typeof payload.jti).toBe("string");
    expect((payload.jti as string).length).toBeGreaterThan(0);
  });

  it("holds exp - iat to the 5-minute contract max", async () => {
    const assertion = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const payload = decodeJwt(assertion);
    const exp = payload.exp as number;
    const iat = payload.iat as number;
    expect(exp - iat).toBe(KODY_ASSERTION_TTL_SECONDS);
    expect(exp - iat).toBe(300);
  });

  it("produces a fresh jti on every call (single-use semantics)", async () => {
    const a = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const b = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const pa = decodeJwt(a);
    const pb = decodeJwt(b);
    expect(pa.jti).not.toBe(pb.jti);
  });

  it("tenant_id mirrors the configured KODY_TENANT_OWNER/KODY_TENANT_REPO", async () => {
    const assertion = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const payload = decodeJwt(assertion);
    expect(payload.tenant_id).toBe("aharonyaircohen/tdr");
  });

  it("uses aud and iss exactly from the configured env vars", async () => {
    const assertion = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const payload = decodeJwt(assertion);
    expect(payload.iss).toBe(process.env.KODY_CLIENT_IDENTITY_ISSUER ?? "http://localhost:3000");
    expect(payload.aud).toBe(process.env.KODY_CLIENT_IDENTITY_AUDIENCE ?? "https://kody.dev");
  });

  it("signs a different sub when a different learner id is passed", async () => {
    const a = await buildLaunchAssertion({ learnerId: "learner-a" });
    const b = await buildLaunchAssertion({ learnerId: "learner-b" });
    expect(decodeJwt(a).sub).toBe("learner-a");
    expect(decodeJwt(b).sub).toBe("learner-b");
  });

  it("verifies against the JWKS public key (round-trip)", async () => {
    const assertion = await buildLaunchAssertion({ learnerId: "learner-abc" });
    const verified = await jwtVerify(assertion, publicKey, {
      algorithms: [KODY_JWT_ALG],
      issuer: kodyClientIdentityIssuer(),
      audience: kodyClientIdentityAudience(),
    });
    expect(verified.protectedHeader.alg).toBe("RS256");
    expect(verified.protectedHeader.kid).toBe(KODY_KEY_ID);
    expect(verified.payload.sub).toBe("learner-abc");
  });

  it("verifies via the JWK imported from the JWKS document", async () => {
    const jwks = await getJwks();
    expect(jwks.keys).toHaveLength(1);
    const imported = (await importJWK(jwks.keys[0], KODY_JWT_ALG)) as KeyLike;
    const assertion = await buildLaunchAssertion({ learnerId: "learner-xyz" });
    const verified = await jwtVerify(assertion, imported, {
      algorithms: [KODY_JWT_ALG],
      issuer: kodyClientIdentityIssuer(),
      audience: kodyClientIdentityAudience(),
    });
    expect(verified.payload.sub).toBe("learner-xyz");
  });
});

describe("JWKS document", () => {
  it("exposes exactly one public key with kid=tdr-kody-1, alg=RS256, use=sig", async () => {
    const jwks = await getJwks();
    expect(jwks.keys).toHaveLength(1);
    const k = jwks.keys[0];
    expect(k.kid).toBe(KODY_KEY_ID);
    expect(k.alg).toBe("RS256");
    expect(k.use).toBe("sig");
    expect(k.kty).toBe("RSA");
  });

  it("does not include the private key material in the public JWK", async () => {
    const jwks = await getJwks();
    const k = jwks.keys[0];
    // jose private members; ensure none leak.
    expect((k as Record<string, unknown>).d).toBeUndefined();
    expect((k as Record<string, unknown>).p).toBeUndefined();
    expect((k as Record<string, unknown>).q).toBeUndefined();
    expect((k as Record<string, unknown>).dp).toBeUndefined();
    expect((k as Record<string, unknown>).dq).toBeUndefined();
    expect((k as Record<string, unknown>).qi).toBeUndefined();
  });
});