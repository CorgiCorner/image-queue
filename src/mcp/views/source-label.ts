const providerLabels = new Map([
  ["openai", "OpenAI"], ["google", "Google"], ["openrouter", "OpenRouter"], ["gateway", "AI Gateway"],
]);

/** "OpenAI · gpt-image-2.6-sunburst", "Codex queue" or "Imported image": where an image came from, for the inline views. */
export function sourceLabel(job: { source?: unknown; provider?: unknown; model?: unknown }) {
  const provider = (typeof job.provider === "string" && providerLabels.get(job.provider)) || "Provider API";
  const model = typeof job.model === "string" && job.model.length <= 200 ? job.model : "";
  return job.source === "queue" ? "Codex queue" : job.source === "api" ? [provider, model].filter(Boolean).join(" · ") : job.source === "import" ? "Imported image" : "";
}
