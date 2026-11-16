import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
it("keeps filesystem imports inside storage and the queue adapter", async () => {
  async function check(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await check(file);
      else if (
        /\.tsx?$/.test(file) &&
        !file.startsWith("src/storage/") &&
        file !== "src/sources/queue.ts"
      )
        expect(await readFile(file, "utf8"), file).not.toMatch(
          /\b(?:node:)?fs(?:\/promises)?["']/,
        );
    }
  }
  await check("src");
});
