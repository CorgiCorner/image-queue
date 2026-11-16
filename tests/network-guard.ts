import http from "node:http";
import https from "node:https";
import net from "node:net";
import { vi } from "vitest";
function blocked(): never {
  throw new Error(
    "Real network access is disabled in tests. Mock the provider transport.",
  );
}
vi.stubGlobal("fetch", blocked);
vi.spyOn(http, "request").mockImplementation(blocked);
vi.spyOn(http, "get").mockImplementation(blocked);
vi.spyOn(https, "request").mockImplementation(blocked);
vi.spyOn(https, "get").mockImplementation(blocked);
const connect = net.Socket.prototype.connect;
let loopbackAllowed = false;

export function allowLoopbackForLocalRuntime() {
  loopbackAllowed = true;
  return () => { loopbackAllowed = false; };
}

vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (
  this: net.Socket,
  ...args: Parameters<typeof connect>
) {
  const raw: unknown = args[0];
  const options: unknown = Array.isArray(raw) ? raw[0] : raw;
  const host = options && typeof options === "object" && "host" in options
    ? options.host : undefined;
  if (loopbackAllowed && (host === "127.0.0.1" || host === "::1")) {
    return Reflect.apply(connect, this, args) as net.Socket;
  }
  return blocked();
});
