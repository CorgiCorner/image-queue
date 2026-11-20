import { AccessForbidden, verifyAccess } from "@/core/access";
import { configuration } from "@/core/config";
import { localRequestDenied } from "@/core/local-request";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createServer } from "@/mcp/server";

const sessionLifetime = 30 * 60 * 1000;
const maxSessions = 32;
const sessions = new Map<string, {
  transport: WebStandardStreamableHTTPServerTransport;
  expiresAt: number;
}>();

function sameSecret(actual: string | null, expected: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(actual ?? "");
  const right = encoder.encode(expected);
  let difference = left.length ^ right.length;
  for (let index = 0; index < right.length; index++)
    difference |= (left[index] ?? 0) ^ right[index]!;
  return difference === 0;
}

const unauthorized = () => new Response("Unauthorized", {
  status: 401,
  headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" },
});

async function handle(request: Request) {
  if (localRequestDenied(request)) return new Response("Access denied", { status: 403 });

  // Cloudflare requests may be routed to different isolates.
  if (configuration("STORAGE_DRIVER") === "cloudflare") {
    // Cloudflare Access (browser session or Managed OAuth token) is the only
    // credential for the hosted endpoint; a static bearer token is local-only.
    try {
      await verifyAccess(request.headers.get("cf-access-jwt-assertion"));
    } catch (error) {
      // A signed-in but unlisted identity must not restart OAuth in a loop.
      if (error instanceof AccessForbidden)
        return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
      return unauthorized();
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    // Stateless: a new server per request never sees the host's initialize, so
    // the MCP Apps views are always listed (hosts without MCP Apps ignore them).
    await createServer({ appViews: "always", panelUrl: new URL(request.url).origin }).connect(transport);
    return transport.handleRequest(request);
  }

  const token = configuration("MCP_TOKEN");
  if (!token || !sameSecret(request.headers.get("authorization"), `Bearer ${token}`))
    return unauthorized();

  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt > now) continue;
    sessions.delete(id);
    await session.transport.close();
  }

  const id = request.headers.get("mcp-session-id");
  if (id) {
    const session = sessions.get(id);
    if (!session) return new Response("Unknown session", { status: 404 });
    session.expiresAt = now + sessionLifetime;
    return session.transport.handleRequest(request);
  }

  if (request.method !== "POST") return new Response(null, { status: 405 });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized(id) {
      if (sessions.size >= maxSessions) {
        const oldest = [...sessions].reduce((first, next) =>
          next[1].expiresAt < first[1].expiresAt ? next : first);
        sessions.delete(oldest[0]);
        void oldest[1].transport.close();
      }
      sessions.set(id, { transport, expiresAt: Date.now() + sessionLifetime });
    },
    onsessionclosed(id) {
      sessions.delete(id);
    },
  });
  await createServer().connect(transport);
  return transport.handleRequest(request);
}

export { handle as POST, handle as DELETE };
