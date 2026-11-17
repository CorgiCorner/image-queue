"use client";

import { useRef, useState } from "react";
import { CircleNotch as LoaderCircle } from "@phosphor-icons/react";
import { testConnectionAction } from "@/actions";
import type { Provider } from "@/core/schema";
import { Button } from "./ui/button";

/** A test result, tagged with the key revision it was checked against. */
type TestResult = { message: string; id: number; keyRevision: number };
type MetaText = { key: string; text: string };

export function connectionWorksMessage(models: number) {
  return `Connection works. ${models} image ${models === 1 ? "model" : "models"} available.`;
}

/**
 * One connected provider: its model count, a connection test with the stored key, and disconnect.
 * The test result replaces the model count in place. `revision` changes whenever the stored key is
 * replaced; a result checked against an older key is never shown.
 */
export function ConnectedProviderRow({ provider, label, count, revision = 0, onDisconnect }: {
  provider: Provider;
  label: string;
  count: number;
  revision?: number;
  onDisconnect: () => Promise<void>;
}) {
  // Key revision of the test in flight; guards repeated clicks for the same key.
  const running = useRef<number>(undefined);
  const nextId = useRef(0);
  const [testingRevision, setTestingRevision] = useState<number>();
  const [result, setResult] = useState<TestResult>();
  const testing = testingRevision === revision;

  const shown: MetaText = result && result.keyRevision === revision
    ? { key: `result-${result.id}`, text: result.message }
    : { key: "count", text: `${count} ${count === 1 ? "model" : "models"}` };
  const [current, setCurrent] = useState(shown);
  const [leaving, setLeaving] = useState<MetaText>();
  if (current.key !== shown.key || current.text !== shown.text) {
    // The replaced text fades out while the new text fades in, in the same place.
    setLeaving(current.key === shown.key ? undefined : current);
    setCurrent(shown);
  }

  async function testConnection() {
    const started = revision;
    if (running.current === started) return;
    running.current = started;
    setTestingRevision(started);
    let message: string;
    try {
      const response = await testConnectionAction({ provider });
      message = response?.data
        ? connectionWorksMessage(response.data.models)
        : response?.serverError ?? "The connection could not be checked. Try again.";
    } catch {
      message = "The connection could not be checked. Try again.";
    } finally {
      if (running.current === started) running.current = undefined;
      setTestingRevision(value => value === started ? undefined : value);
    }
    const id = ++nextId.current;
    // Revisions only grow, so a result for an older key never replaces a newer one.
    setResult(value => value && value.keyRevision > started ? value : { message, id, keyRevision: started });
  }

  return (
    <li className="settings-list-row">
      <span className="settings-list-name">{label}</span>
      <span className="settings-list-meta" role="status">
        <span key={current.key} className="settings-meta-text" data-result={current.key !== "count" || undefined}>{current.text}</span>
        {leaving && (
          <span key={`leaving-${leaving.key}`} className="settings-meta-text settings-meta-leaving" aria-hidden="true"
            onAnimationEnd={() => setLeaving(undefined)}>
            {leaving.text}
          </span>
        )}
      </span>
      <span className="settings-list-actions">
        <Button
          variant="outline"
          className="settings-test-button"
          aria-busy={testing || undefined}
          onClick={testConnection}
        >
          {/* Both labels share one grid cell, so the button keeps the width of the longer one. */}
          <span className="settings-test-labels">
            <span className="settings-test-label" data-active={!testing || undefined} aria-hidden={testing || undefined}>
              Test connection
            </span>
            <span className="settings-test-label" data-active={testing || undefined} aria-hidden={!testing || undefined}>
              {testing && <LoaderCircle className="spin" aria-hidden="true" size={16} />}
              Testing…
            </span>
          </span>
        </Button>
        <Button variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
      </span>
    </li>
  );
}
