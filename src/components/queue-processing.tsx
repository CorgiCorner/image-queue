"use client";

import { useState } from "react";
import type {
  ProcessingChange,
  ProcessingSource,
  ProcessingStatus,
} from "../core/processing";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Save = (change: ProcessingChange) => Promise<void>;
function SourceRow({
  source,
  state,
  waiting,
  allPaused,
  save,
  busy,
}: {
  source: ProcessingSource;
  state: ProcessingStatus["api"];
  waiting: number;
  allPaused: boolean;
  save: Save;
  busy: boolean;
}) {
  const name = source === "api" ? "OpenAI API" : "Codex queue";
  const stopped = state.paused || !!state.blockedReason;
  const status = allPaused
    ? "All processing paused"
    : state.paused
      ? "Paused"
      : state.blockedReason
        ? "Stopped"
        : !state.online
          ? "Executor offline"
          : state.running
            ? "Generating"
            : "Ready";
  return (
    <div className="settings-subsection">
      <div className="runner-state-row">
        <h3 className="settings-subheading">{name}</h3>
        <Button
          variant="outline"
          disabled={busy || allPaused}
          onClick={() => save({ source, paused: !stopped })}
          aria-label={`${stopped ? "Resume" : "Pause"} ${name}`}
        >
          {stopped ? "Resume" : "Pause"}
        </Button>
      </div>
      <p role="status">
        {status} · {waiting} waiting · {state.running} generating
      </p>
      {state.blockedReason && (
        <p className="settings-row-hint">
          {state.blockedReason}
          {state.resumeAt &&
            ` Next check ${new Date(state.resumeAt).toLocaleString()}.`}
        </p>
      )}
      {state.lastError && state.lastError !== state.blockedReason && (
        <p className="settings-row-hint">Last error · {state.lastError}</p>
      )}
      <p className="settings-row-hint">
        Last delivery ·{" "}
        {state.lastDelivery
          ? new Date(state.lastDelivery).toLocaleString()
          : "No delivery recorded"}
      </p>
      <details className="runner-advanced">
        <summary>Processing limits</summary>
        <form
          className="processing-limits"
          key={`${state.workers}-${state.policy.limit}-${state.policy.windowMinutes}`}
          onSubmit={async (event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            await save({
              source,
              workers: Number(fields.get("workers")),
              policy: {
                limit: Number(fields.get("limit")),
                windowMinutes: Number(fields.get("windowMinutes")),
              },
            });
          }}
        >
          {(
            [
              ["workers", "Parallel requests", 1, 5, state.workers],
              ["limit", "Pause after failures", 0, 100, state.policy.limit],
              [
                "windowMinutes",
                "Window in minutes",
                1,
                10080,
                state.policy.windowMinutes,
              ],
            ] as const
          ).map(([field, label, min, max, value]) => (
            <div className="grid gap-2" key={field}>
              <Label htmlFor={`${source}-${field}`}>{label}</Label>
              <Input
                id={`${source}-${field}`}
                name={field}
                type="number"
                min={min}
                max={max}
                step="1"
                required
                defaultValue={value}
              />
            </div>
          ))}
          <p className="settings-row-hint">
            Set failures to 0 to keep processing other requests. Each failed
            request counts once within the window.
          </p>
          <Button type="submit" variant="secondary" disabled={busy}>
            Save limits
          </Button>
        </form>
      </details>
    </div>
  );
}
export function QueueProcessing({
  state,
  waiting,
  localCodex,
  onSave,
}: {
  state: ProcessingStatus;
  waiting: Record<ProcessingSource, number>;
  localCodex: boolean;
  onSave: Save;
}) {
  const [busy, setBusy] = useState(false);
  async function save(input: ProcessingChange) {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(input);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="queue-processing"
      className="settings-card"
      aria-labelledby="processing-title"
    >
      <header className="settings-card-header">
        <div className="runner-state-row">
          <h2 id="processing-title">Processing</h2>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => save({ source: "all", paused: !state.paused })}
          >
            {state.paused ? "Resume all" : "Pause all"}
          </Button>
        </div>
        <p>
          Pausing lets active images finish. Keep the local dashboard running to
          process waiting requests.
        </p>
      </header>
      {(localCodex ? (["queue", "api"] as const) : (["api"] as const)).map(
        (source) => (
          <SourceRow
            key={source}
            source={source}
            state={state[source]}
            waiting={waiting[source]}
            allPaused={state.paused}
            busy={busy}
            save={save}
          />
        ),
      )}
    </section>
  );
}
