type RpcId = string | number;
type Message = { jsonrpc: "2.0"; id?: RpcId; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };

/** JSON-RPC transport for a sandboxed MCP Apps iframe and its parent proxy. */
export class ParentRpc {
  private parentOrigin: string | undefined;
  private sequence = 0;
  private closed = false;
  private pending = new Map<RpcId, {
    finish: (value: unknown) => void;
    fail: (error: Error) => void;
  }>();

  constructor(
    private readonly source: Window,
    private readonly target: Window,
    private readonly handle: (method: string, params: unknown) => unknown,
    private readonly timeoutMs = 60_000,
  ) {
    source.addEventListener("message", this.receive);
  }

  private send(message: Omit<Message, "jsonrpc">) {
    const origin = this.parentOrigin;
    this.target.postMessage({ jsonrpc: "2.0", ...message }, origin && origin !== "null" ? origin : "*");
  }

  request(method: string, params: unknown) {
    if (this.closed) return Promise.reject(new Error("MCP Apps connection is closed"));
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const settle = () => {
        this.pending.delete(id);
        clearTimeout(timer);
      };
      const fail = (error: Error) => { settle(); reject(error); };
      const timer = setTimeout(() => fail(new Error(`MCP Apps request timed out: ${method}`)), this.timeoutMs);
      this.pending.set(id, { finish: result => { settle(); resolve(result); }, fail });
      try {
        this.send({ id, method, params });
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Could not send MCP Apps request"));
      }
    });
  }

  notify(method: string, params?: unknown) {
    if (!this.closed) this.send({ method, params });
  }

  private receive = (event: MessageEvent) => {
    if (event.source !== this.target || this.closed ||
        (this.parentOrigin !== undefined && this.parentOrigin !== event.origin)) return;
    const message = event.data as Message | null;
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
    if (typeof message.method === "string") {
      void this.receiveCall(message);
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending || !("result" in message || "error" in message)) return;
    this.parentOrigin ??= event.origin;
    if (message.error) pending.fail(new Error(message.error.message ?? "MCP Apps host request failed"));
    else pending.finish(message.result);
  };

  private async receiveCall({ id, method, params }: Message) {
    const reply = typeof id === "string" || typeof id === "number";
    try {
      const result = await this.handle(method!, params);
      if (reply && !this.closed) this.send({ id, result: result ?? {} });
    } catch {
      if (reply && !this.closed) {
        this.send({ id, error: { code: -32603, message: "App request failed" } });
      }
    } finally {
      if (method === "ui/resource-teardown") this.close();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.source.removeEventListener("message", this.receive);
    for (const pending of this.pending.values()) pending.fail(new Error("MCP Apps connection closed"));
  }
}
