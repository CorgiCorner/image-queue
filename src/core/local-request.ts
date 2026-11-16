import { configuration } from "./config";

/** Local APIs are never reachable through a foreign Host or browser Origin. */
export function localRequestDenied(request: Request) {
  if (configuration("STORAGE_DRIVER") === "cloudflare") return false;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const local = new URL(`${url.protocol}//${host}`);
    if (local.username || local.password || local.host !== host.toLowerCase() || local.pathname !== "/" || local.search || local.hash) return true;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(local.hostname)) return true;
    const origin = request.headers.get("origin");
    if (origin === null) return false; // non-browser local clients, including stdio bridges
    if (!origin) return true;
    const source = new URL(origin);
    return source.origin !== local.origin || source.username !== "" || source.password !== "";
  } catch {
    return true;
  }
}
