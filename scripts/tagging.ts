import { readFileSync } from "node:fs";
import { z } from "zod";
import { service } from "../src/core/runtime";
import { idSchema } from "../src/core/schema";
import { tagImage, tagSchema, untaggedImages } from "../src/core/tags";

const request = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), limit: z.number().int().min(1).max(5).default(1) }),
  z.object({ command: z.literal("tag"), id: idSchema, tags: z.array(tagSchema).min(1).max(50) }),
]).parse(JSON.parse(readFileSync(0, "utf8")));
const api = await service();
const jobs = await api.jobs();
if (request.command === "list") {
  console.log(JSON.stringify(untaggedImages(jobs, request.limit)));
} else {
  const available = untaggedImages(jobs, jobs.length);
  if (!available.some(job => job.id === request.id)) {
    console.log(JSON.stringify({ saved: false, reason: "Generation has priority or the image is no longer untagged." }));
  } else {
    const job = await tagImage(api.store, request.id, request.tags, "agent");
    console.log(JSON.stringify({ saved: true, id: job.id, tags: job.tags }));
  }
}
