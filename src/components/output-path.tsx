"use client";

import { useState } from "react";
import { CopyButton } from "./copy-button";

export function OutputPath({ path, onNotice }: { path: string; onNotice: (message: string) => void }) {
  const [feedback, setFeedback] = useState<{ path: string; message: string }>();
  const normalized = path.replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  const filename = normalized.slice(separator + 1);
  const folder = normalized.slice(0, separator + 1)
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, "~")
    .replace(/^[A-Za-z]:\/Users\/[^/]+(?=\/)/i, "~");

  return (
    <div className="output-path">
      <div>
        <p className="font-mono">{filename}</p>
        {separator >= 0 && <p className="output-folder">{folder}</p>}
        <p role="status">{feedback?.path === path ? feedback.message : ""}</p>
      </div>
      <CopyButton value={path} label="Copy path" onSuccess={() => {
          setFeedback({ path, message: "Output path copied" });
          onNotice("Output path copied");
        }} onError={() => {
          setFeedback({ path, message: "Unable to copy output path" });
          onNotice("Unable to copy output path");
        }} />
    </div>
  );
}
