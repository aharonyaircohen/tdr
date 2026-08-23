// Public JWKS endpoint. Kody fetches this to verify the assertions the
// dashboard form-posts. The contract path is `GET /.well-known/jwks.json`.

import { getJwks } from "@/lib/kody-jwt";

export const dynamic = "force-dynamic";

export async function GET() {
  const jwks = await getJwks();
  return new Response(JSON.stringify(jwks), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
}