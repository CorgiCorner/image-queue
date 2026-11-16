import { cpus } from "node:os";
import { layout, type LayoutMode } from "../src/core/layout";

const items = Array.from({ length: 10000 }, (_, index) => ({
  id: String(index),
  width: index % 2 ? 1600 : 900,
  height: index % 2 ? 900 : 1600,
}));
const modes: LayoutMode[] = ["justified", "masonry", "grid"];
const samples = 30;
const frameBudgetMs = 1000 / 60;
console.log(JSON.stringify({
  runtime: process.version,
  cpu: cpus()[0]?.model,
  containerWidth: 1200,
  count: items.length,
  warmupRuns: 5,
  samples,
  frameBudgetMs,
}));
for (const mode of modes) {
  for (let run = 0; run < 5; run++) layout(items, 1200, mode);
  const durations: number[] = [];
  for (let run = 0; run < samples; run++) {
    const start = performance.now();
    layout(items, 1200, mode);
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const p95ms = durations[Math.ceil(samples * 0.95) - 1];
  const maxMs = durations[samples - 1];
  console.log(JSON.stringify({ mode, p95ms, maxMs, withinFrameBudget: maxMs < frameBudgetMs }));
  if (maxMs >= frameBudgetMs) process.exitCode = 1;
}
