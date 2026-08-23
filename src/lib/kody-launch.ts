// Kody launch configuration: where the dashboard posts the assertion, what
// tenant it claims, and what brand the chat session should be opened as.
// All values are env-driven so the same TDR build can target different
// Kody deployments without code changes.

export const DEFAULT_KODY_EXTERNAL_LAUNCH_URL =
  "https://kody.dev/api/client-session/external-launch";
export const DEFAULT_KODY_TENANT_OWNER = "aharonyaircohen";
export const DEFAULT_KODY_TENANT_REPO = "tdr";
export const DEFAULT_KODY_BRAND_SLUG = "tdr-default";
export const DEFAULT_KODY_CLIENT_IDENTITY_ISSUER = "http://localhost:3000";
export const DEFAULT_KODY_CLIENT_IDENTITY_AUDIENCE = "https://kody.dev";

function readEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

export function kodyLaunchUrl(): string {
  return readEnv("KODY_EXTERNAL_LAUNCH_URL", DEFAULT_KODY_EXTERNAL_LAUNCH_URL);
}

export function kodyTenantOwner(): string {
  return readEnv("KODY_TENANT_OWNER", DEFAULT_KODY_TENANT_OWNER);
}

export function kodyTenantRepo(): string {
  return readEnv("KODY_TENANT_REPO", DEFAULT_KODY_TENANT_REPO);
}

export function kodyBrandSlug(): string {
  return readEnv("KODY_BRAND_SLUG", DEFAULT_KODY_BRAND_SLUG);
}

export function kodyClientIdentityIssuer(): string {
  return readEnv(
    "KODY_CLIENT_IDENTITY_ISSUER",
    DEFAULT_KODY_CLIENT_IDENTITY_ISSUER,
  );
}

export function kodyClientIdentityAudience(): string {
  return readEnv(
    "KODY_CLIENT_IDENTITY_AUDIENCE",
    DEFAULT_KODY_CLIENT_IDENTITY_AUDIENCE,
  );
}

export function kodyTenant(): string {
  return `${kodyTenantOwner()}/${kodyTenantRepo()}`;
}