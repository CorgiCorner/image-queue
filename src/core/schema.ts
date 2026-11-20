import { z } from "zod";
import { aspectRatios } from "./size-intent";
import { idSchema } from "./ids";
export { idSchema } from "./ids";
import { replicaIdentityFields, type ReplicaIdentity } from "./replica-model";
export const projectSchema = z.object({
  ...replicaIdentityFields.shape,
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  directory: z.string().trim().min(1).max(4096).refine(value => !/[\x00-\x1f]/.test(value), "Invalid project directory")
    .refine(value => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\"), "Project directory must be an absolute path")
    .optional(),
  createdAt: z.string(),
  order: z.number().optional(),
  machineId: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Project = z.infer<typeof projectSchema>;
export const requestSchema = z.object({
  projectId: idSchema,
  topicId: idSchema.optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(60)).max(50).optional(),
  prompt: z
    .string()
    .trim()
    .min(3)
    .max(12000)
    .refine(
      (value) =>
        !/^(## |[-] (Status|Save to|References|Size|Background):)/m.test(value),
      "Prompt cannot contain queue metadata lines",
    ),
  source: z.enum(["queue", "api"]),
  provider: z
    .enum(["openai", "google", "gateway", "openrouter"])
    .default("openai"),
  model: z.string().max(200).default(""),
  aspectRatio: z.enum(aspectRatios).optional(),
  exactDimensions: z.boolean().optional(),
  resolution: z.enum(["1K", "2K", "4K", "512"]).optional(),
  width: z.number().int().min(256).max(4096),
  height: z.number().int().min(256).max(4096),
  transparent: z.boolean().default(false),
  /** OpenAI Image API rendering quality; API requests only. */
  quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]).optional(),
  /** OpenAI Image API planning effort (GPT Image 2.6); API requests only. */
  complexity: z.enum(["low", "medium", "high"]).optional(),
  /** OpenAI Image API output format. Omitted requests are stored as PNG. API requests only. */
  outputFormat: z.enum(["png", "webp", "jpeg", "gif", "svg"]).optional(),
  /** Animated GIF frame count (2–16). API requests only, and only with GIF output. */
  frameCount: z.number().int().min(2).max(16).optional(),
  /** Animated GIF frame duration in milliseconds (20–2000). API requests only, and only with GIF output. */
  frameDurationMs: z.number().int().min(20).max(2000).optional(),
  referenceIds: z
    .array(idSchema)
    .max(10)
    .refine(
      (values) => new Set(values).size === values.length,
      "Duplicate references are not allowed",
    )
    .default([]),
  idempotencyKey: idSchema.max(96),
});
export type ImageRequest = z.infer<typeof requestSchema>;
export const retryImageSchema = z.object({ id: idSchema, acknowledgeUncertain: z.boolean().default(false) });
export type JobStatus =
  | "queued"
  | "running"
  | "done"
  | "blocked"
  | "failed"
  | "cancelled"
  | "uncertain";
export type Job = Omit<ImageRequest, "tags"> & Partial<ReplicaIdentity> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  tags?: import("./tags").ImageTag[];
  stackId?: string;
  versionNumber?: number;
  parentVersionId?: string;
  isMain?: boolean;
  machineId?: string;
  imported?: boolean;
  opacityVerified?: boolean;
  archivedAt?: string;
  retentionRevision?: string;
  trashedAt?: string;
  originalName?: string;
  error?: string;
  requestedSize?: { width: number; height: number };
  generatedSize?: { width: number; height: number };
  providerResultSize?: { width: number; height: number };
  providerSize?: { width: number; height: number };
  providerSizeParameters?: { size?: string; aspectRatio?: string; resolution?: string };
  outputPath?: string;
  blobKey?: string;
  thumbnailKey?: string;
  dominantColor?: string;
  provenance?: string;
  claim?: { owner: string; since: string; reserved?: true };
  reservationReviewedAt?: string;
  attemptId?: string;
  startedAt?: string;
  requestHash: string;
};
export type Reference = Partial<ReplicaIdentity> & {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  blobKey: string;
  kind: "image" | "video";
  parentId?: string;
  machineId?: string;
  updatedAt?: string;
  timestampMs?: number;
  topicId?: string;
  createdAt: string;
};
export type Provider = ImageRequest["provider"];
export type Model = {
  sizeProfile?: import("./size-intent").SizeProfile;
  id: string;
  name: string;
  provider: Provider;
  references: boolean;
  transparency: boolean;
  /** Accepted `quality` values; present only for models with a verified profile. */
  qualities?: import("./model-profiles").ImageQuality[];
  /** Accepted `complexity` values; empty when the model has no complexity setting. */
  complexities?: import("./model-profiles").ImageComplexity[];
  /** Formats an API request can ask for. The result is stored in that format; omitted requests are PNG. */
  outputFormats?: string[];
  /** Capabilities stated by official documentation but not yet confirmed by a generation receipt. */
  documentedOnly?: string[];
  /** Whether a paid generation receipt backs this profile; false when it rests on documentation alone. */
  generationVerified?: boolean;
};
export const settingsSchema = z.object({
  provider: z.enum(["openai", "google", "gateway", "openrouter"]),
  apiKey: z.string().trim().min(10).max(1000),
});
export const transitions: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "cancelled", "blocked"],
  running: ["done", "failed", "blocked", "uncertain"],
  done: [],
  blocked: [],
  failed: [],
  cancelled: [],
  uncertain: ["done", "failed"],
};
export function transition(job: Job, status: JobStatus): Job {
  if (!transitions[job.status].includes(status))
    throw new Error(`Cannot change ${job.status} to ${status}`);
  return { ...job, status, updatedAt: new Date().toISOString() };
}
export async function hash(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
