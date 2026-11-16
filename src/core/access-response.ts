import { verifyAccess } from "./access";
import { localRequestDenied } from "./local-request";

export async function accessDeniedResponse(request: Request) {
  if (localRequestDenied(request)) return Response.json({ error: "Access denied" }, { status: 403 });
  try {
    await verifyAccess(request.headers.get("cf-access-jwt-assertion"));
  } catch {
    return Response.json(
      { error: "Access denied" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
}
