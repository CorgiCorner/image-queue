import { expect, it } from "vitest";
import { orderedVersions } from "../src/core/version-order";
import type { Job } from "../src/core/schema";
it("sorts numbered versions by ordinal without mutating the source", () => {
  const jobs = [{ id: "a", versionNumber: 2, createdAt: "1" }, { id: "b", versionNumber: 1, createdAt: "2" }] as Job[];
  expect(orderedVersions(jobs).map(job => job.id)).toEqual(["b", "a"]);
  expect(jobs[0].id).toBe("a");
});
it("uses consistent chronological ordering for mixed legacy records", () => {
  const jobs = [{ id: "b", versionNumber: 1, createdAt: "2" }, { id: "a", createdAt: "1" }] as Job[];
  expect(orderedVersions(jobs).map(job => job.id)).toEqual(["a", "b"]);
});

it.each([1, undefined])("breaks equal version positions by ID (version %s)", versionNumber => {
  const jobs = [
    { id: "b", versionNumber, createdAt: "2026-11-15T10:00:00Z" },
    { id: "a", versionNumber, createdAt: "2026-11-15T10:00:00Z" },
  ] as Job[];
  expect(orderedVersions(jobs).map(job => job.id)).toEqual(["a", "b"]);
  expect(orderedVersions([...jobs].reverse()).map(job => job.id)).toEqual(["a", "b"]);
});
