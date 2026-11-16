import { expect, it } from "vitest";
import { planPurge } from "../src/core/purge-plan";
import type { Job, Reference } from "../src/core/schema";
const job = (id: string, blobKey: string) => ({ id, blobKey, status: "done", trashedAt: "2026-11-14" }) as Job;
it("preserves shared result and reference files", () => {
  const jobs = [job("one", "results/shared"), job("two", "results/shared"), job("three", "results/reference")];
  expect(planPurge(jobs, [{blobKey:"results/reference"} as Reference], ["one", "three"]).blobKeys).toEqual([]);
  expect(planPurge(jobs, [], ["one", "two"]).blobKeys).toEqual(["results/shared"]);
});
it("rejects active, non-trash and missing records", () => {
  expect(() => planPurge([{...job("one","results/a"),status:"running"}], [], ["one"])).toThrow("terminal");
  expect(() => planPurge([{...job("one","results/a"),trashedAt:undefined}], [], ["one"])).toThrow("Trash");
  expect(() => planPurge([], [], ["missing"])).toThrow("no longer exists");
});

it("validates the selection and deduplicates repeated identifiers", () => {
  expect(() => planPurge([], [], [])).toThrow();
  expect(() => planPurge([], [], ["../outside"])).toThrow();
  expect(planPurge([job("one", "results/a")], [], ["one", "one"]).ids).toEqual(["one"]);
});
