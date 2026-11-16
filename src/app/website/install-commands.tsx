"use client";

import { useState } from "react";
import { Terminal } from "@phosphor-icons/react";
import { CopyButton } from "@/components/copy-button";

const commands = "git clone https://github.com/corgicorner/image-queue.git\ncd image-queue\npnpm install --frozen-lockfile\npnpm build\npnpm start";

export function InstallCommands() {
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <div className="site-terminal">
      <div className="site-terminal-header">
        <span><Terminal size={16} aria-hidden="true" /> Terminal</span>
        <CopyButton value={commands} label="Copy installation commands" size="sm" variant="outline"
          className="site-terminal-copy" onSuccess={() => setCopyFailed(false)} onError={() => setCopyFailed(true)}
          copiedChildren="Copied">
          Copy commands
        </CopyButton>
      </div>
      <pre aria-label="Installation commands"><code>{commands}</code></pre>
      {copyFailed && <p className="site-terminal-error" role="status">Could not copy. Select the commands above and copy them manually.</p>}
    </div>
  );
}
