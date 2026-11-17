"use client";

import { useState } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";
import { CopyButton } from "@/components/copy-button";

export const setupPrompt = `Set up image-queue on this Mac. Work locally, not in the cloud. If local file access and shell commands are unavailable, stop and explain what I need to enable.

1. Check git, Node.js 24 or newer, pnpm 10.28.2, and the Codex CLI. Tell me what is missing before installing anything. Ask before each tool installation. Do not use sudo without explaining why and receiving my approval.
2. Check https://github.com/corgicorner/image-queue for release v0.1.4. If that release is unavailable, stop and tell me; do not silently install main or a different version.
3. Install that release into ~/image-queue. If the folder already exists, stop and ask me. Do not overwrite it.
4. Run pnpm install --frozen-lockfile, pnpm build and pnpm build:mcp in that folder. Start with pnpm start and verify http://127.0.0.1:3215 responds. If the port is occupied, identify the process and ask me; do not stop it.
5. Run codex login status. If I am not signed in with ChatGPT, explain the step I must complete myself. Never read authentication files, request credentials in chat, or change my existing login. Do not use an API-key login as a substitute for my ChatGPT plan.
6. Offer to create ~/Desktop/image-queue.command after my approval. It should open this existing installation using the detected stable Node and pnpm paths. Do not enable startup at login. Explain that closing the running process stops the queue.
7. Report what was installed, the release version, folder, browser URL, login check and how to start it next time. Clearly list any incomplete step.

Do not change files outside ~/image-queue except approved tool installs and the optional launcher. Do not generate images or connect an API key.`;

const setupLink = `codex://threads/new?${new URLSearchParams({ prompt: setupPrompt }).toString()}`;

export function SetupPrompt() {
  const [copyFailed, setCopyFailed] = useState(false);
  return <div className="setup-prompt">
    <div className="setup-actions">
      <a className="site-button" href={setupLink}>Set up with ChatGPT <ArrowUpRight size={18} /></a>
      <CopyButton value={setupPrompt} label="Copy setup prompt" size="default" variant="outline" className="site-button setup-copy" copiedChildren="Copied" onSuccess={()=>setCopyFailed(false)} onError={()=>setCopyFailed(true)}>Copy setup prompt</CopyButton>
    </div>
    <p>Opens a draft in the desktop app. Choose local Work or Codex, review the prompt, then press Send. You’ll approve the setup steps. Local access depends on your plan and workspace settings.</p>
    <details><summary>Read the setup prompt</summary><pre>{setupPrompt}</pre></details>
    {copyFailed && <p role="status">Could not copy. Open the prompt above and copy it manually.</p>}
  </div>;
}
