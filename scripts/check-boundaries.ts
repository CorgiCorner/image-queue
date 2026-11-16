import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function check(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (file !== path.join("src", "storage")) await check(file);
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(file) || file === path.join("src", "sources", "queue.ts")) continue;
    if (/\b(?:node:)?fs(?:\/promises)?["']/.test(await readFile(file, "utf8"))) {
      throw new Error(`Filesystem access outside storage or queue adapter: ${file}`);
    }
  }
}

await check("src");
