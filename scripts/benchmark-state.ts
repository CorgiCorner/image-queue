import { cpus } from "node:os";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3360");
if (
  !["http:", "https:"].includes(origin.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
) {
  throw new Error("Use a local preview with test data");
}

async function measure() {
  const start = performance.now();
  const response = await fetch(new URL("/api/state", origin), {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`State returned HTTP ${response.status}`);
  const state = await response.json();
  return {
    duration: performance.now() - start,
    counts: [state.projects.length, state.jobs.length, state.references.length],
  };
}

const { counts } = await measure();
for (let run = 1; run < 5; run++) await measure();
console.log(JSON.stringify({ runtime: process.version, cpu: cpus()[0]?.model, projects: counts[0], jobs: counts[1], references: counts[2], warmupRuns: 5 }));
for (const { concurrency, samples } of [
  { concurrency: 1, samples: 30 },
  { concurrency: 6, samples: 60 },
]) {
  const durations: number[] = [];
  for (let run = 0; run < samples; run += concurrency) {
    const batch = await Promise.all(Array.from({ length: concurrency }, measure));
    for (const result of batch) {
      if (result.counts.some((count, index) => count !== counts[index])) {
        throw new Error("Workspace counts changed during the benchmark");
      }
      durations.push(result.duration);
    }
  }
  durations.sort((a, b) => a - b);
  console.log(JSON.stringify({
    concurrency,
    samples,
    medianMs: (durations[samples / 2 - 1] + durations[samples / 2]) / 2,
    p95Ms: durations[Math.ceil(samples * 0.95) - 1],
    maxMs: durations[samples - 1],
  }));
}
