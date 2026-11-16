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

async function handle(request: Request) {
  if (localRequestDenied(request)) return new Response("Access denied", { status: 403 });
  const token = configuration("MCP_TOKEN");
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`)
    return new Response("Unauthorized", { status: 401 });

  // Cloudflare requests may be routed to different isolates.
  if (configuration("STORAGE_DRIVER") === "cloudflare") {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await createServer().connect(transport);
    return transport.handleRequest(request);
  }

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
