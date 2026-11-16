import { expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { recordProject } from "../src/storage/project-record";
it("resolves direct and image-linked project records", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "image", { id: "image", projectId: "p", stackId: "stack" });
  expect(await recordProject(store, "projects", "p", {})).toBe("p");
  expect(await recordProject(store, "references", "ref", { projectId: "p" })).toBe("p");
  expect(await recordProject(store, "notes", "note", { imageId: "image" })).toBe("p");
  expect(await recordProject(store, "asset-meta", "image", {})).toBe("p");
  expect(await recordProject(store, "stack-counters", "stack", {})).toBe("p");
  expect(await recordProject(store, "settings", "key", { projectId: "p" })).toBeUndefined();
});
it("keeps ambiguous cross-project counters global", async () => {
  const store = new MemoryStorage();
  await store.put("jobs", "one", { projectId: "p", stackId: "stack" });
  await store.put("jobs", "two", { projectId: "q", stackId: "stack" });
  expect(await recordProject(store, "stack-counters", "stack", {})).toBeUndefined();
});
