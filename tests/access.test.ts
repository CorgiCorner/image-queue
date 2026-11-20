import { afterEach, describe, expect, it, vi } from "vitest";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccess } from "../src/core/access";
import { AccessForbidden } from "../src/core/access";
import { accessAudience, syntheticAccess } from "./access-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STORAGE_DRIVER;
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
  delete process.env.CF_ACCESS_AUDIENCE;
  delete process.env.ACCESS_ALLOWED_EMAILS;
  vi.unstubAllEnvs();
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
    process.env.CF_ACCESS_AUDIENCE = "aud";
    // Without an e-mail allowlist any Access identity would pass.
    await expect(verifyAccess("token")).rejects.toThrow("required");
    process.env.ACCESS_ALLOWED_EMAILS = " , ";
    await expect(verifyAccess("token")).rejects.toThrow("required");
  });
  it("accepts only allowlisted e-mail identities", async () => {
    const { sign, privateKey, issuer, fetchKeys } = await syntheticAccess();
    await expect(verifyAccess(await sign())).resolves.toBeUndefined();
    await expect(verifyAccess(await sign({ email: "SECOND@example.com" }))).resolves.toBeUndefined();
    await expect(verifyAccess(await sign({ email: "intruder@example.com" }))).rejects.toThrow("not allowed");
    await expect(verifyAccess(await sign({ email: "intruder@example.com" }))).rejects.toBeInstanceOf(AccessForbidden);
    await expect(verifyAccess(await sign({ email: "" }))).rejects.toThrow("not allowed");
    const withoutEmail = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(issuer).setAudience(accessAudience).setExpirationTime("5m")
      .sign(privateKey);
    await expect(verifyAccess(withoutEmail)).rejects.toThrow("not allowed");
    // The key set is fetched once and reused for later assertions.
    expect(fetchKeys.mock.calls.filter(([url]) => String(url).endsWith("/cdn-cgi/access/certs"))).toHaveLength(1);
  });
  it("verifies signature, issuer and audience against a synthetic key set", async () => {
    process.env.STORAGE_DRIVER = "cloudflare";
    process.env.CF_ACCESS_TEAM_DOMAIN = "verify.cloudflareaccess.com";
    process.env.CF_ACCESS_AUDIENCE = "aud";
    process.env.ACCESS_ALLOWED_EMAILS = "owner@example.com";
    const issuer = "https://verify.cloudflareaccess.com";
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const other = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" };
    const fetchKeys = vi.fn(async (_url: URL) => Response.json({ keys: [jwk] }));
    vi.stubGlobal("fetch", fetchKeys);
    const token = (audience: string, origin = issuer, signer = privateKey, expiration = "5m") =>
      new SignJWT({ email: "owner@example.com" }).setProtectedHeader({ alg: "RS256", kid: "fixture" })
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
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });
  it("fails while the key set is unavailable and recovers on the next request", async () => {
    process.env.STORAGE_DRIVER = "cloudflare";
    process.env.CF_ACCESS_TEAM_DOMAIN = "unavailable.cloudflareaccess.com";
    process.env.CF_ACCESS_AUDIENCE = "aud";
    process.env.ACCESS_ALLOWED_EMAILS = "owner@example.com";
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" };
    const fetchKeys = vi.fn(async (_url: URL) => Response.json({ keys: [jwk] }));
    fetchKeys.mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchKeys);
    const token = await new SignJWT({ email: "owner@example.com" }).setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer("https://unavailable.cloudflareaccess.com").setAudience("aud").setExpirationTime("5m").sign(privateKey);
    await expect(verifyAccess(token)).rejects.toThrow(/200 OK/);
    await expect(verifyAccess(token)).resolves.toBeUndefined();
  });
});
