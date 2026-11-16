import { execFile } from "node:child_process";
import { configuration } from "@/core/config";

let pickerActive = false;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const localHosts = ["127.0.0.1", "localhost", "[::1]"];
  let sameOrigin = origin === url.origin && (!host || host === url.host);
  if (!sameOrigin && host && origin) {
    try {
      const browserUrl = new URL(origin);
      sameOrigin = browserUrl.origin === origin &&
        browserUrl.protocol === url.protocol &&
        browserUrl.host === host &&
        localHosts.includes(browserUrl.hostname);
    } catch {
      sameOrigin = false;
    }
  }
  if (configuration("STORAGE_DRIVER") === "cloudflare" ||
      !localHosts.includes(url.hostname) ||
      !sameOrigin) {
    return Response.json({ error: "Folder selection is available from the local workspace." }, { status: 403 });
  }
  if (process.platform !== "darwin") {
    return Response.json({ error: "Use the path field on this operating system." }, { status: 501 });
  }
  if (pickerActive) return Response.json({ error: "A folder picker is already open." }, { status: 409 });
  pickerActive = true;
  try {
    const stdout = await new Promise<string>((resolve, reject) => execFile("/usr/bin/osascript", [
      "-e", 'POSIX path of (choose folder with prompt "Choose an image-queue folder")',
    ], { timeout: 120000, maxBuffer: 8192 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    }));
    return Response.json({ path: stdout.trim() });
  } catch (error) {
    if (String(error).includes("(-128)")) return Response.json({ cancelled: true });
    return Response.json({ error: "Folder selection could not be completed. You can enter the path manually." }, { status: 500 });
  } finally {
    pickerActive = false;
  }
}
