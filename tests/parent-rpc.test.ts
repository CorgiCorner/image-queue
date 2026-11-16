// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { ParentRpc } from "../src/mcp/views/parent-rpc";

it("correlates parent replies and rejects messages from other sources or origins", async () => {
  const target = { postMessage: vi.fn() } as unknown as Window;
  const handle = vi.fn(() => ({ ok: true }));
  const rpc = new ParentRpc(window, target, handle);
  const dispatch = (source: Window, origin: string, data: object) =>
    window.dispatchEvent(new MessageEvent("message", { source, origin, data: { jsonrpc: "2.0", ...data } }));
  try {
    const result = rpc.request("ui/initialize", {});
    expect(target.postMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} }, "*");
    dispatch(window, "https://other.example", { id: 1, result: { invalid: true } });
    dispatch(target, "https://host.example", { id: 1, result: { ready: true } });
    await expect(result).resolves.toEqual({ ready: true });

    dispatch(target, "https://other.example", { method: "ping", id: 5 });
    expect(handle).not.toHaveBeenCalled();
    dispatch(target, "https://host.example", { method: "ping", id: 6 });
    await Promise.resolve();
    expect(target.postMessage).toHaveBeenLastCalledWith({ jsonrpc: "2.0", id: 6, result: { ok: true } }, "https://host.example");
  } finally {
    rpc.close();
  }
});

it("rejects pending requests on shutdown", async () => {
  const target = { postMessage: vi.fn() } as unknown as Window;
  const rpc = new ParentRpc(window, target, () => {});
  const pending = rpc.request("tools/call", {});
  rpc.close();
  await expect(pending).rejects.toThrow("connection closed");
  await expect(rpc.request("tools/call", {})).rejects.toThrow("connection is closed");
});
