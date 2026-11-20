import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { vi } from "vitest";

export const accessAudience = "image-queue-audience";
export const allowedEmail = "owner@example.com";

/**
 * Configures a synthetic Cloudflare Access deployment and serves its signing
 * keys. Each call uses its own team domain, because key sets are cached per
 * issuer for the life of the process.
 */
export async function syntheticAccess() {
  const accessTeam = `team-${crypto.randomUUID()}.cloudflareaccess.com`;
  const accessIssuer = `https://${accessTeam}`;
  vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER", "cloudflare");
  vi.stubEnv("IMAGE_QUEUE_CF_ACCESS_TEAM_DOMAIN", accessTeam);
  vi.stubEnv("IMAGE_QUEUE_CF_ACCESS_AUDIENCE", accessAudience);
  vi.stubEnv("IMAGE_QUEUE_ACCESS_ALLOWED_EMAILS", ` Owner@Example.com, second@example.com `);
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" };
  const passThrough = globalThis.fetch;
  const fetchKeys = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === `${accessIssuer}/cdn-cgi/access/certs`
      ? Response.json({ keys: [jwk] })
      : passThrough(input, init));
  vi.stubGlobal("fetch", fetchKeys);
  const sign = (claims: { email?: string; audience?: string; issuer?: string; expiration?: string } = {}) =>
    new SignJWT(claims.email === undefined ? { email: allowedEmail } : { email: claims.email })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(claims.issuer ?? accessIssuer)
      .setAudience(claims.audience ?? accessAudience)
      .setExpirationTime(claims.expiration ?? "5m")
      .sign(privateKey);
  return { sign, fetchKeys, privateKey, issuer: accessIssuer };
}
