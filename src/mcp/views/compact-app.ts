import type { App as SdkApp } from "@modelcontextprotocol/ext-apps";
import { ParentRpc } from "./parent-rpc";

type HostContext = NonNullable<ReturnType<SdkApp["getHostContext"]>>;
type HandlerInput<K extends "ontoolinput" | "ontoolresult" | "onhostcontextchanged"> =
  Parameters<NonNullable<SdkApp[K]>>[0];

const protocolVersion = "2026-01-26";
const supportedVersions = new Set([protocolVersion, "2025-11-21"]);

/** App-side MCP Apps methods used by the three inline image views. */
export class CompactApp {
  ontoolinput?: (params: HandlerInput<"ontoolinput">) => void;
  ontoolresult?: (params: HandlerInput<"ontoolresult">) => void;
  onhostcontextchanged?: (params: HandlerInput<"onhostcontextchanged">) => void;
  onteardown?: () => unknown;
  private rpc?: ParentRpc;
  private context?: HostContext;
  private capabilities?: { downloadFile?: object };
  private resize?: ResizeObserver;

  constructor(
    private readonly appInfo: { name: string; version: string },
    private readonly frame: Window = window,
  ) {}

  async connect() {
    if (this.rpc) throw new Error("MCP Apps connection already started");
    const rpc = new ParentRpc(this.frame, this.frame.parent, (method, params) => this.handle(method, params));
    this.rpc = rpc;
    try {
      const result = await rpc.request("ui/initialize", {
        protocolVersion, appInfo: this.appInfo, appCapabilities: {},
      });
      if (!result || typeof result !== "object" || !("protocolVersion" in result) ||
          typeof result.protocolVersion !== "string" || !supportedVersions.has(result.protocolVersion))
        throw new Error("Unsupported MCP Apps protocol");
      this.capabilities = ("hostCapabilities" in result && result.hostCapabilities && typeof result.hostCapabilities === "object")
        ? result.hostCapabilities as { downloadFile?: object } : undefined;
      this.context = ("hostContext" in result && result.hostContext && typeof result.hostContext === "object")
        ? result.hostContext as HostContext : undefined;
      rpc.notify("ui/notifications/initialized");
      const root = this.frame.document.documentElement;
      let lastSize = "";
      this.resize = new ResizeObserver(() => {
        const width = root.clientWidth;
        const height = Math.ceil(this.frame.document.body.getBoundingClientRect().height);
        const size = `${width}:${height}`;
        if (size === lastSize) return;
        lastSize = size;
        rpc.notify("ui/notifications/size-changed", { width, height });
      });
      this.resize.observe(root);
      this.resize.observe(this.frame.document.body);
    } catch (error) {
      rpc.close();
      throw error;
    }
  }

  private async handle(method: string, params: unknown) {
    if (method === "ping") return {};
    if (method === "ui/resource-teardown") {
      this.resize?.disconnect();
      return await this.onteardown?.() ?? {};
    }
    if (!params || typeof params !== "object") return;
    switch (method) {
      case "ui/notifications/tool-input":
        this.ontoolinput?.(params as HandlerInput<"ontoolinput">);
        break;
      case "ui/notifications/tool-result":
        this.ontoolresult?.(params as HandlerInput<"ontoolresult">);
        break;
      case "ui/notifications/host-context-changed": {
        const patch = params as HandlerInput<"onhostcontextchanged">;
        this.context = { ...this.context, ...patch };
        this.onhostcontextchanged?.(patch);
        break;
      }
    }
  }

  getHostContext() { return this.context; }
  /** True when the host saves files a view hands it (ui/download-file). */
  canDownloadFiles() { return Boolean(this.capabilities?.downloadFile); }

  private async request<T>(method: string, params: unknown) {
    if (!this.rpc) throw new Error("MCP Apps connection is unavailable");
    return await this.rpc.request(method, params) as T;
  }

  callServerTool(params: Parameters<SdkApp["callServerTool"]>[0]) {
    return this.request<Awaited<ReturnType<SdkApp["callServerTool"]>>>("tools/call", params);
  }
  readServerResource(params: Parameters<SdkApp["readServerResource"]>[0]) {
    return this.request<Awaited<ReturnType<SdkApp["readServerResource"]>>>("resources/read", params);
  }
  downloadFile(params: { contents: { type: "resource"; resource: { uri: string; mimeType: string; blob: string } }[] }) {
    return this.request<{ isError?: boolean }>("ui/download-file", params);
  }
  openLink(params: Parameters<SdkApp["openLink"]>[0]) {
    return this.request<Awaited<ReturnType<SdkApp["openLink"]>>>("ui/open-link", params);
  }
  sendMessage(params: Parameters<SdkApp["sendMessage"]>[0]) {
    return this.request<Awaited<ReturnType<SdkApp["sendMessage"]>>>("ui/message", params);
  }
  updateModelContext(params: Parameters<SdkApp["updateModelContext"]>[0]) {
    return this.request<Awaited<ReturnType<SdkApp["updateModelContext"]>>>("ui/update-model-context", params);
  }
  requestDisplayMode(params: Parameters<SdkApp["requestDisplayMode"]>[0]) {
    return this.request<Awaited<ReturnType<SdkApp["requestDisplayMode"]>>>("ui/request-display-mode", params);
  }
}

export function applyDocumentTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function applyHostStyleVariables(variables: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(variables)) {
    if (name.startsWith("--") && typeof value === "string") document.documentElement.style.setProperty(name, value);
  }
}

/** Loads the host's fonts (@font-face or @import rules) so --font-sans resolves to the host's typeface. */
export function applyHostFonts(css: string) {
  let style = document.querySelector<HTMLStyleElement>("style[data-host-fonts]");
  if (!style) {
    style = document.createElement("style");
    style.dataset.hostFonts = "";
    document.head.prepend(style);
  }
  if (style.textContent !== css) style.textContent = css;
}
