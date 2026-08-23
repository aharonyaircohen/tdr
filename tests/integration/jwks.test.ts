// Integration test for the public JWKS endpoint. The JWKS route handler
// must return a document that (a) is well-formed JSON, (b) advertises the
// canonical kid/alg/use values, (c) carries the right Content-Type, and
// (d) round-trips against a freshly-issued assertion.

import { describe, it, expect, beforeAll } from "vitest";
import { jwtVerify, importJWK, decodeJwt } from "jose";
import {
  buildLaunchAssertion,
  getJwks,
  KODY_KEY_ID,
  KODY_JWT_ALG,
} from "@/lib/kody-jwt";
import {
  kodyClientIdentityAudience,
  kodyClientIdentityIssuer,
} from "@/lib/kody-launch";

let jwksGET: typeof import("@/app/.well-known/jwks.json/route").GET;

beforeAll(async () => {
  jwksGET = (await import("@/app/.well-known/jwks.json/route")).GET;
});

describe("GET /.well-known/jwks.json", () => {
  it("returns 200, application/json, and Cache-Control: public, max-age=300", async () => {
    const res = await jwksGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("returns exactly one JWK with the contract kid/alg/use values", async () => {
    const res = await jwksGET();
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };
    expect(body.keys).toHaveLength(1);
    const k = body.keys[0];
    expect(k.kid).toBe(KODY_KEY_ID);
    expect(k.kid).toBe("tdr-kody-1");
    expect(k.alg).toBe("RS256");
    expect(k.use).toBe("sig");
    expect(k.kty).toBe("RSA");
  });

  it("does not leak any private key parameters", async () => {
    const res = await jwksGET();
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };
    const k = body.keys[0];
    expect(k.d).toBeUndefined();
    expect(k.p).toBeUndefined();
    expect(k.q).toBeUndefined();
    expect(k.dp).toBeUndefined();
    expect(k.dq).toBeUndefined();
    expect(k.qi).toBeUndefined();
  });

  it("the JWKS public key verifies a freshly minted assertion (end-to-end round-trip)", async () => {
    const res = await jwksGET();
    const body = (await res.json()) as {
      keys: Array<Record<string, unknown>>;
    };
    const jwk = await importJWK(body.keys[0], KODY_JWT_ALG);
    const assertion = await buildLaunchAssertion({ learnerId: "roundtrip-learner" });
    const verified = await jwtVerify(assertion, jwk, {
      algorithms: [KODY_JWT_ALG],
      issuer: kodyClientIdentityIssuer(),
      audience: kodyClientIdentityAudience(),
    });
    expect(verified.payload.sub).toBe("roundtrip-learner");
  });

  it("getJwks() and the route return identical key material", async () => {
    const fromLib = await getJwks();
    const fromRoute = await jwksGET();
    const routeBody = (await fromRoute.json()) as {
      keys: Array<Record<string, unknown>>;
    };
    expect(fromLib.keys[0].kid).toBe(routeBody.keys[0].kid);
    expect(fromLib.keys[0].n).toBe(routeBody.keys[0].n);
    expect(fromLib.keys[0].e).toBe(routeBody.keys[0].e);
  });

  it("the issued JWT decodes to the same sub/aud/iss the contract requires", async () => {
    const assertion = await buildLaunchAssertion({ learnerId: "decode-learner" });
    const payload = decodeJwt(assertion);
    expect(payload.sub).toBe("decode-learner");
    expect(payload.aud).toBe(kodyClientIdentityAudience());
    expect(payload.iss).toBe(kodyClientIdentityIssuer());
  });
});