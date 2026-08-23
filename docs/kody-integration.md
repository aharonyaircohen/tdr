# Kody Brand Chat integration

TDR is the **host half** of the
[`brand-chat-access`](https://kody.dev/docs/brand-chat-access) delegated-client
contract. The dashboard renders a form that POSTs an RS256 JWT to Kody's
external-launch endpoint; Kody verifies the JWT against the public JWKS
document TDR serves and opens a scoped Brand Chat session.

This document is operator-facing: it covers the three Kody-side variables
that must mirror the values TDR publishes, the brand configuration the
operator must set, and the HTTPS deployment constraint the contract
requires.

## What TDR publishes

| Path | Method | Purpose |
|---|---|---|
| `/.well-known/jwks.json` | `GET` | Public JWKS document. Kody fetches this to verify assertion signatures. `Cache-Control: public, max-age=300`. |
| `POST /api/client-session/external-launch` | (form POST) | Outbound — TDR's dashboard form posts `{ assertion, owner, repo, brandSlug }` to this URL. The URL is read from `KODY_EXTERNAL_LAUNCH_URL`. |
| `POST /api/auth/{register,login,logout}` | `POST` | TDR's own auth endpoints. Kody does not interact with these. |

The assertion body is a compact JWS with these claims:

| Claim | Source |
|---|---|
| `sub` | TDR session-cookie subject (the registered learner id) |
| `aud` | `KODY_CLIENT_IDENTITY_AUDIENCE` |
| `iss` | `KODY_CLIENT_IDENTITY_ISSUER` |
| `iat`, `exp` | `exp - iat = 300s` (5-minute contract max) |
| `jti` | `crypto.randomUUID()`, generated fresh per dashboard render |
| `tenant_id` | `${KODY_TENANT_OWNER}/${KODY_TENANT_REPO}` |
| `brand_slug` | `KODY_BRAND_SLUG` |

The JWS header is `{ "alg": "RS256", "kid": "tdr-kody-1", "typ": "JWT" }`.
The private key lives at `prisma/keys/kody-private.pem` (git-ignored); the
public key is served as a JWK with `alg: "RS256"`, `use: "sig"`.

## What the operator must configure on the Kody side

The following three Kody-side environment variables **must mirror** the
corresponding TDR values. Set them on the Kody deployment, not on TDR.

| Kody-side variable | Must equal |
|---|---|
| `CLIENT_IDENTITY_ISSUER` | `KODY_CLIENT_IDENTITY_ISSUER` on TDR |
| `CLIENT_IDENTITY_AUDIENCE` | `KODY_CLIENT_IDENTITY_AUDIENCE` on TDR |
| `CLIENT_IDENTITY_JWKS_URL` | `${KODY_CLIENT_IDENTITY_ISSUER}/.well-known/jwks.json` |

In addition, the Kody brand the operator wants TDR to launch into must be
configured with `access.mode: delegated`. Without this, Kody rejects the
incoming assertion and the dashboard form posts no one anywhere.

## HTTPS deployment requirement

The brand-chat-access contract requires the issuer and the JWKS URL to
share one HTTPS origin. Local development uses `http://localhost:3000`
because the contract allows HTTP in dev; production deployments must
terminate TLS in front of TDR (e.g. reverse proxy with a valid certificate)
and set `KODY_CLIENT_IDENTITY_ISSUER` to the HTTPS origin.

If `KODY_CLIENT_IDENTITY_ISSUER` is left as `http://...` in production,
Kody will refuse to verify the assertion because the audience/JWKS URL
won't match.

## TDR-side configuration knobs

All TDR knobs are env vars. Defaults match the local dev workflow; flip
them per environment. See `.env.example` for the canonical list.

| Variable | Default | Notes |
|---|---|---|
| `KODY_CLIENT_IDENTITY_ISSUER` | `http://localhost:3000` | HTTPS in prod. |
| `KODY_CLIENT_IDENTITY_AUDIENCE` | `https://kody.dev` | Audience claim in the JWS. |
| `KODY_EXTERNAL_LAUNCH_URL` | `https://kody.dev/api/client-session/external-launch` | Form-POST target. |
| `KODY_TENANT_OWNER` | `aharonyaircohen` | First half of `tenant_id`. |
| `KODY_TENANT_REPO` | `tdr` | Second half of `tenant_id`. |
| `KODY_BRAND_SLUG` | `tdr-default` | `brand_slug` claim. Must match the operator-configured brand on Kody. |

`KODY_TENANT_OWNER/KODY_TENANT_REPO` must equal the connected repo
(`aharonyaircohen/tdr` by default). Changing these to a different repo
without changing the issuer/JWKS URL is a misconfiguration that Kody will
catch on the first assertion.

## Local verification

```bash
# 1. Start the dev server.
npm run dev

# 2. Confirm the JWKS document is reachable.
curl http://localhost:3000/.well-known/jwks.json | jq

# 3. Register a learner.
curl -c /tmp/cookie.txt -X POST http://localhost:3000/api/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"alice@tdr.local","password":"hunter22-correcthorse"}'

# 4. Open the dashboard and inspect the form.
curl -b /tmp/cookie.txt http://localhost:3000/ | grep -A2 'kody-launch-form'

# 5. Decode the assertion.
curl -b /tmp/cookie.txt http://localhost:3000/ \
  | grep -oE 'name="assertion" value="[^"]*"' \
  | sed 's/^name="assertion" value="//;s/"$//' \
  | cut -d. -f2 \
  | base64 -d 2>/dev/null \
  | jq
```

## Out of scope

- Configuring Kody-side variables or brand `access.mode` (operator step, documented above).
- Building a real chat UI inside TDR — the contract is "TDR owns identity,
  Kody owns the chat surface". TDR does not embed a chat widget.
- Replacing or augmenting the existing Chat/GuidedFlow/Widget/Renderer
  surfaces on Kody.
- Multi-tenant TDR (one TDR instance ↔ one Kody tenant).