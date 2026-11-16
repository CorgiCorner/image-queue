import { UserFacingError } from "./user-facing-error";
import { configuration } from "@/core/config";
import { createRemoteJWKSet, jwtVerify } from "jose";
export async function verifyAccess(token: string | null) {
  if (configuration("STORAGE_DRIVER") !== "cloudflare") return;
  const team = configuration("CF_ACCESS_TEAM_DOMAIN");
  const audience = configuration("CF_ACCESS_AUDIENCE");
  if (!token || !team || !audience)
    throw new UserFacingError("Cloudflare Access is required");
  const issuer = `https://${team}`;
  const keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  await jwtVerify(token, keys, { issuer, audience, requiredClaims: ["exp"] });
}
