import { afterEach, describe, expect, it, vi } from "vitest";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccess } from "../src/core/access";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STORAGE_DRIVER;
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
  delete process.env.CF_ACCESS_AUDIENCE;
});
describe("Cloudflare Access", () => {
  it("allows local requests", async () => {
    await expect(verifyAccess(null)).resolves.toBeUndefined();
  });
  it("fails closed without configured access", async () => {
    process.env.STORAGE_DRIVER = "cloudflare";
    await expect(verifyAccess(null)).rejects.toThrow("required");
    await expect(verifyAccess("token")).rejects.toThrow("required");
    process.env.CF_ACCESS_TEAM_DOMAIN = "example.cloudflareaccess.com";
    await expect(verifyAccess("token")).rejects.toThrow("required");
  });
  it("verifies signature, issuer and audience against a synthetic key set", async () => {
    process.env.STORAGE_DRIVER = "cloudflare";
    process.env.CF_ACCESS_TEAM_DOMAIN = "example.cloudflareaccess.com";
    process.env.CF_ACCESS_AUDIENCE = "aud";
    const issuer = "https://example.cloudflareaccess.com";
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const other = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" };
    const fetchKeys = vi.fn(async (_url: URL) => Response.json({ keys: [jwk] }));
    vi.stubGlobal("fetch", fetchKeys);
    const token = (audience: string, origin = issuer, signer = privateKey, expiration = "5m") =>
      new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "fixture" })
        .setIssuer(origin).setAudience(audience).setExpirationTime(expiration).sign(signer);
    await expect(verifyAccess(await token("aud"))).resolves.toBeUndefined();
    await expect(verifyAccess(await token("another"))).rejects.toThrow(/aud/);
    await expect(verifyAccess(await token("aud", "https://wrong.example"))).rejects.toThrow(/iss/);
    await expect(verifyAccess(await token("aud", issuer, other.privateKey))).rejects.toThrow(/signature/i);
    await expect(verifyAccess(await token("aud", issuer, privateKey, "5m ago"))).rejects.toThrow(/exp/);
    const noExpiration = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(issuer).setAudience("aud").sign(privateKey);
    await expect(verifyAccess(noExpiration)).rejects.toThrow(/exp/);
    expect(String(fetchKeys.mock.calls[0]?.[0])).toBe(`${issuer}/cdn-cgi/access/certs`);
    fetchKeys.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(verifyAccess(await token("aud"))).rejects.toThrow(/200 OK/);
    await expect(verifyAccess(await token("aud"))).resolves.toBeUndefined();
  });
});
