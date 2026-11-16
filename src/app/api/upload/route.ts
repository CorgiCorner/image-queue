import { uploadErrorMessage } from "@/core/upload-error";
import { accessDeniedResponse } from "@/core/access-response";
import { service } from "@/core/runtime";
export async function POST(request: Request) {
  const denied = await accessDeniedResponse(request);
  if (denied) return denied;
  const origin = request.headers.get("origin");
  const expectedHost = request.headers.get("host") ?? new URL(request.url).host;
  let sameOrigin = false;
  try {
    sameOrigin = origin !== null && new URL(origin).host === expectedHost;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin)
    return Response.json(
      { error: "Upload origin does not match this workspace" },
      { status: 403 },
    );
  try {
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File))
      return new Response("File required", { status: 400 });
    const ref = await (await service()).addReference(
      String(data.get("projectId")),
      file.name,
      file.type,
      new Uint8Array(await file.arrayBuffer()),
      data.get("parentId") ? String(data.get("parentId")) : undefined,
      data.get("timestampMs") ? Number(data.get("timestampMs")) : undefined,
    );
    return Response.json(ref);
  } catch (error) {
    return Response.json(
      { error: uploadErrorMessage(error) },
      { status: 400 },
    );
  }
}
