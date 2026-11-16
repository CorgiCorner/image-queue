import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { readProjectRecords } from "../src/storage/project-read";
it("combines separate project collections and deduplicates matching copies", async () => {
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  await first.put("jobs", "one", { projectId: "p" });
  await second.put("jobs", "one", { projectId: "p" });
  await second.put("jobs", "two", { projectId: "q" });
  expect(await readProjectRecords([first, second], "jobs")).toEqual([
    { id: "one", value: { projectId: "p" } }, { id: "two", value: { projectId: "q" } },
  ]);
});
it("rejects conflicting copies instead of losing one version", async () => {
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  await first.put("jobs", "one", { prompt: "First" });
  await second.put("jobs", "one", { prompt: "Second" });
  await expect(readProjectRecords([first, second], "jobs")).rejects.toThrow("Conflicting project record");
});
