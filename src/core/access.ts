import { UserFacingError } from "./user-facing-error";
import { configuration } from "@/core/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

/** A valid Access identity that this deployment does not allow (HTTP 403, not 401). */
export class AccessForbidden extends UserFacingError {}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Comma- or whitespace-separated e-mail addresses allowed to use a Cloudflare deployment. */
export function allowedEmails() {
  return new Set(
    (configuration("ACCESS_ALLOWED_EMAILS") ?? "")
      .split(/[\s,]+/)
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Verifies the Cloudflare Access assertion for browser and MCP requests.
 * Access sends the same signed assertion for a browser session and for a
 * Managed OAuth token, so one check covers the panel and remote MCP.
 * Fails closed: a Cloudflare deployment without team, audience or an e-mail
 * allowlist rejects every request.
 */
export async function verifyAccess(token: string | null) {
  if (configuration("STORAGE_DRIVER") !== "cloudflare") return;
  const team = configuration("CF_ACCESS_TEAM_DOMAIN");
  const audience = configuration("CF_ACCESS_AUDIENCE");
  const emails = allowedEmails();
  if (!token || !team || !audience || emails.size === 0)
    throw new UserFacingError("Cloudflare Access is required");
  const issuer = `https://${team}`;
  // jose caches the key set and refetches it for an unknown key ID.
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    keySets.set(issuer, keys);
  }
  const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp"] });
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!emails.has(email)) throw new AccessForbidden("This account is not allowed");
}
