"use client";

import { useState } from "react";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { mcpConfigurations, remoteMcpClients, type McpLaunch } from "@/core/mcp-configuration";
import { Button } from "./ui/button";
import { FolderOpen } from "@phosphor-icons/react";
import { openAgentConfigDirectoryAction } from "@/actions";
import { CopyButton } from "./copy-button";

const destinations: Record<string, React.ReactNode> = {
  Codex: <>Paste into <code>~/.codex/config.toml</code>.</>,
  "Claude Code": <>Paste into <code>.mcp.json</code> in your project.</>,
};

/** Connect an agent to a hosted deployment: the remote server URL, then the steps or command for each client. */
function RemoteAgentConnection({ origin, onNotice }: { origin: string; onNotice: (message: string) => void }) {
  const { url, clients } = remoteMcpClients(origin);
  const [name, setName] = useState(clients[0].name);
  const client = clients.find(entry => entry.name === name) ?? clients[0];
  const copyFailed = () => onNotice("Unable to copy. Select and copy the text.");

  return <section id="agent-connection" className="settings-card" aria-labelledby="agent-connection-title">
    <header className="settings-card-header">
      <h2 id="agent-connection-title">Connect an agent</h2>
      <p>Add this workspace to Claude, Claude Code or Codex as a remote MCP server, then request and view images from a chat, also on your phone.</p>
    </header>
    <div className="settings-row settings-row-stacked">
      <div className="settings-row-text">
        <span className="settings-row-label" id="agent-server-label">Server URL</span>
        <span className="settings-row-hint">Remote MCP over HTTP. Each client signs in through this workspace&apos;s sign-in page; no key is copied into the client.</span>
      </div>
      <div className="settings-code">
        <div className="settings-code-bar">
          <span>URL</span>
          <CopyButton variant="ghost" size="sm" className="settings-code-copy" value={url} label="Copy server URL"
            copiedChildren="Copied" onSuccess={() => onNotice("Server URL copied")} onError={copyFailed}>
            Copy
          </CopyButton>
        </div>
        <pre tabIndex={0} role="region" aria-labelledby="agent-server-label">{url}</pre>
      </div>
    </div>
    <div className="settings-row settings-row-stacked">
      <div className="settings-row-split">
        <div className="settings-row-text">
          <span className="settings-row-label" id="agent-client-label">Add to your client</span>
          <span className="settings-row-hint">{client.note}</span>
        </div>
        <ToggleGroup className="settings-segmented" aria-labelledby="agent-client-label" value={[name]}
          onValueChange={values => { if (values[0]) setName(values[0] as string); }}>
          {clients.map(entry => <Toggle key={entry.name} value={entry.name}>{entry.name}</Toggle>)}
        </ToggleGroup>
      </div>
      {"steps" in client && client.steps
        ? <>
          <ol className="settings-steps" aria-label={`${client.name} steps`}>{client.steps.map(step => <li key={step}>{step}</li>)}</ol>
          {"after" in client && <span className="settings-row-hint">{client.after}</span>}
        </>
        : "value" in client && <div className="settings-code">
          <div className="settings-code-bar">
            <span>{client.format}</span>
            <CopyButton variant="ghost" size="sm" className="settings-code-copy" value={client.value} label={`Copy ${client.name} command`}
              copiedChildren="Copied" onSuccess={() => onNotice(`${client.name} command copied`)} onError={copyFailed}>
              Copy
            </CopyButton>
          </div>
          <pre tabIndex={0} role="region" aria-label={`${client.name} command`}>{client.value}</pre>
        </div>}
    </div>
    <footer className="settings-card-footer">
      <p className="settings-footer-hint">
        Image requests from a connected agent use this workspace&apos;s default generation source and are billed to its provider key.
      </p>
    </footer>
  </section>;
}

/** Connect an agent: server facts, one build step, then the client configuration to paste. */
export function AgentConnection({ launch, dashboardOrigin, onNotice, platform, remote = false }: {
  platform?: string;
  launch?: McpLaunch;
  dashboardOrigin?: string;
  onNotice: (message: string) => void;
  /** A hosted deployment has no local stdio server; clients connect to its remote endpoint. */
  remote?: boolean;
}) {
  if (remote) return dashboardOrigin ? <RemoteAgentConnection origin={dashboardOrigin} onNotice={onNotice} /> : null;
  return <LocalAgentConnection launch={launch} dashboardOrigin={dashboardOrigin} onNotice={onNotice} platform={platform} />;
}

function LocalAgentConnection({ launch, dashboardOrigin, onNotice, platform }: {
  platform?: string;
  launch?: McpLaunch;
  dashboardOrigin?: string;
  onNotice: (message: string) => void;
}) {
  const configs = mcpConfigurations(launch, dashboardOrigin);
  const [opening, setOpening] = useState(false);
  const [client, setClient] = useState(configs[0].name);
  const config = configs.find(entry => entry.name === client) ?? configs[0];

  return <section id="agent-connection" className="settings-card" aria-labelledby="agent-connection-title">
    <header className="settings-card-header">
      <h2 id="agent-connection-title">Connect an agent</h2>
      <p>Add this local MCP server to your agent configuration.</p>
    </header>
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">Server</span>
        <span className="settings-row-hint">Runs on this machine and talks to your agent over standard input and output.</span>
      </div>
      <span className="settings-row-value">Local · stdio</span>
    </div>
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">Build once</span>
        <span className="settings-row-hint">Run from this repository. No global installation is needed.</span>
      </div>
      <code className="settings-row-value settings-command">pnpm build:mcp</code>
    </div>
    <div className="settings-row settings-row-stacked">
      <div className="settings-row-split">
        <div className="settings-row-text">
          <span className="settings-row-label" id="agent-client-label">Add to your client</span>
          <span className="settings-row-hint">{destinations[config.name]}</span>
          {launch && platform && <Button variant="outline" size="sm" className="config-folder-button" disabled={opening} onClick={async()=>{
            setOpening(true);try{const result=await openAgentConfigDirectoryAction({client:config.name as 'Codex'|'Claude Code'});if(result?.serverError)onNotice(result.serverError);else onNotice('Configuration folder opened');}catch{onNotice('Could not open the configuration folder');}finally{setOpening(false);}
          }}><FolderOpen size={16}/>{platform==='darwin'?'Open in Finder':platform==='win32'?'Open in Explorer':'Open folder'}</Button>}
        </div>
        <ToggleGroup className="settings-segmented" aria-labelledby="agent-client-label" value={[client]}
          onValueChange={values => { if (values[0]) setClient(values[0] as string); }}>
          {configs.map(entry => <Toggle key={entry.name} value={entry.name}>{entry.name}</Toggle>)}
        </ToggleGroup>
      </div>
      <div className="settings-code">
        <div className="settings-code-bar">
          <span>{config.format}</span>
          <CopyButton variant="ghost" size="sm" className="settings-code-copy" value={config.value} label={`Copy ${config.name} configuration`}
            copiedChildren="Copied"
            onSuccess={() => onNotice(`${config.name} configuration copied`)}
            onError={() => onNotice("Unable to copy. Select and copy the configuration text.")}>
            Copy
          </CopyButton>
        </div>
        <pre tabIndex={0} role="region" aria-label={`${config.name} configuration`}>{config.value}</pre>
      </div>
    </div>
    <footer className="settings-card-footer">
      <p className="settings-footer-hint">
        The copied configuration points to this workspace. Saved keys stay in the local credential store.
      </p>
    </footer>
  </section>;
}
