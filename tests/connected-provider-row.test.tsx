// @vitest-environment happy-dom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const testConnectionAction = vi.hoisted(() => vi.fn());
vi.mock("@/actions", () => ({ testConnectionAction }));

import { ConnectedProviderRow, connectionWorksMessage } from "@/components/connected-provider-row";

afterEach(() => { cleanup(); testConnectionAction.mockReset(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function row(
  provider: "openai" | "google" = "openai",
  label = "OpenAI",
  revision = 0,
  onConfirmed?: (message: string) => void,
) {
  return <ConnectedProviderRow provider={provider} label={label} count={3} revision={revision} onDisconnect={async () => {}} onConfirmed={onConfirmed} />;
}

function meta(container: HTMLElement) {
  return container.querySelector(".settings-list-meta")!;
}

/** The visible meta text: the replaced text that is fading out is hidden from assistive technology. */
function shownMeta(container: HTMLElement) {
  return meta(container).querySelector(".settings-meta-text:not(.settings-meta-leaving)")!.textContent;
}

it("renders the model count as a status region before the first result", () => {
  const view = render(<ul>{row()}</ul>);
  const status = meta(view.container);
  expect(status.getAttribute("role")).toBe("status");
  expect(status.textContent).toBe("3 models");
  expect(screen.getByRole("status").textContent).toBe("3 models");
  // No separate full-width result line below the row.
  expect(view.container.querySelector(".settings-list-result")).toBeNull();
});

it("shows Testing… with the progress icon in the same button, ignores repeat clicks and keeps the count after success", async () => {
  const pending = deferred<{ data: { models: number } }>();
  const onConfirmed = vi.fn();
  testConnectionAction.mockReturnValueOnce(pending.promise);
  const view = render(<ul>{row("openai", "OpenAI", 0, onConfirmed)}</ul>);
  const status = meta(view.container);
  const button = screen.getByRole("button", { name: "Test connection" });

  fireEvent.click(button);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector("svg.spin")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Testing…" })).toBe(button);
  // Both labels stay in one cell, so the button keeps the width of the longer one.
  const labels = button.querySelectorAll(".settings-test-label");
  expect(labels).toHaveLength(2);
  expect(labels[0].textContent).toBe("Test connection");
  expect(labels[0].hasAttribute("data-active")).toBe(false);
  expect(labels[1].getAttribute("data-active")).toBe("true");
  fireEvent.click(button);
  fireEvent.click(button);
  expect(testConnectionAction).toHaveBeenCalledTimes(1);
  expect(testConnectionAction).toHaveBeenCalledWith({ provider: "openai" });
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  expect(shownMeta(view.container)).toBe("3 models");

  await act(async () => pending.resolve({ data: { models: 12 } }));
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(button.querySelector("svg.spin")).toBeNull();
  expect(screen.getByRole("button", { name: "Test connection" })).toBe(button);
  expect(meta(view.container)).toBe(status);
  expect(shownMeta(view.container)).toBe("3 models");
  expect(status.textContent).toBe("3 models");
  expect(status.querySelector("[data-result]")).toBeNull();
  expect(onConfirmed).toHaveBeenCalledOnce();
  expect(onConfirmed).toHaveBeenCalledWith("Connection works. 12 image models available.");
});

it("replaces the count with an error and restores it after a later success", async () => {
  const onConfirmed = vi.fn();
  testConnectionAction
    .mockResolvedValueOnce({ data: { models: 1 } })
    .mockResolvedValueOnce({ serverError: "The provider rejected this API key (401). Check the key and try again." })
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ data: { models: 4 } });
  const view = render(<ul>{row("openai", "OpenAI", 0, onConfirmed)}</ul>);
  const button = screen.getByRole("button", { name: "Test connection" });
  await act(async () => fireEvent.click(button));
  const status = meta(view.container);
  const first = status.firstElementChild;
  expect(shownMeta(view.container)).toBe("3 models");
  expect(onConfirmed).toHaveBeenCalledWith(connectionWorksMessage(1));

  await act(async () => fireEvent.click(button));
  expect(meta(view.container)).toBe(status);
  // A new element restarts the fade for the replacing sentence; the count fades out beside it.
  expect(status.firstElementChild).not.toBe(first);
  expect(shownMeta(view.container)).toBe("The provider rejected this API key (401). Check the key and try again.");
  expect(status.querySelectorAll(".settings-meta-text")).toHaveLength(2);
  const leaving = status.querySelector(".settings-meta-leaving")!;
  expect(leaving.textContent).toBe("3 models");
  expect(leaving.getAttribute("aria-hidden")).toBe("true");
  fireEvent.animationEnd(leaving);
  expect(status.textContent).toBe("The provider rejected this API key (401). Check the key and try again.");

  await act(async () => fireEvent.click(button));
  expect(shownMeta(view.container)).toBe("The connection could not be checked. Try again.");

  await act(async () => fireEvent.click(button));
  expect(shownMeta(view.container)).toBe("3 models");
  expect(status.querySelector(".settings-meta-text:not(.settings-meta-leaving)")?.hasAttribute("data-result")).toBe(false);
  expect(onConfirmed).toHaveBeenLastCalledWith(connectionWorksMessage(4));
});

it("keeps other provider rows usable while one test runs", async () => {
  const pending = deferred<{ data: { models: number } }>();
  const onConfirmed = vi.fn();
  testConnectionAction.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ data: { models: 2 } });
  render(<ul>{row("openai", "OpenAI", 0, onConfirmed)}{row("google", "Google", 0, onConfirmed)}</ul>);
  const [openai, google] = screen.getAllByRole("button", { name: "Test connection" });
  fireEvent.click(openai);
  await act(async () => fireEvent.click(google));
  expect(testConnectionAction).toHaveBeenNthCalledWith(2, { provider: "google" });
  expect(google.getAttribute("aria-busy")).toBeNull();
  expect(openai.getAttribute("aria-busy")).toBe("true");
  expect(google.closest("li")!.textContent).not.toContain("Connection works");
  expect(onConfirmed).toHaveBeenCalledWith(connectionWorksMessage(2));
  await act(async () => pending.resolve({ data: { models: 5 } }));
  expect(openai.closest("li")!.textContent).not.toContain("Connection works");
  expect(onConfirmed).toHaveBeenCalledWith(connectionWorksMessage(5));
});

it("clears the result when the key is replaced and ignores a test of the old key", async () => {
  const onConfirmed = vi.fn();
  const old = deferred<{ data: { models: number } }>();
  testConnectionAction.mockResolvedValueOnce({ serverError: "The provider rejected this API key (401). Check the key and try again." }).mockReturnValueOnce(old.promise);
  const view = render(<ul>{row("openai", "OpenAI", 0, onConfirmed)}</ul>);
  const button = screen.getByRole("button", { name: "Test connection" });
  await act(async () => fireEvent.click(button));
  expect(shownMeta(view.container)).toBe("The provider rejected this API key (401). Check the key and try again.");

  fireEvent.click(button);
  expect(button.getAttribute("aria-busy")).toBe("true");
  view.rerender(<ul>{row("openai", "OpenAI", 1, onConfirmed)}</ul>);
  // The new key shows the model count again and can be tested at once.
  expect(shownMeta(view.container)).toBe("3 models");
  expect(button.getAttribute("aria-busy")).toBeNull();
  const fresh = deferred<{ data: { models: number } }>();
  testConnectionAction.mockReturnValueOnce(fresh.promise);
  fireEvent.click(button);
  expect(testConnectionAction).toHaveBeenCalledTimes(3);

  await act(async () => old.resolve({ data: { models: 9 } }));
  expect(shownMeta(view.container)).toBe("3 models");
  expect(onConfirmed).not.toHaveBeenCalled();
  expect(button.getAttribute("aria-busy")).toBe("true");
  await act(async () => fresh.resolve({ data: { models: 6 } }));
  expect(shownMeta(view.container)).toBe("3 models");
  expect(onConfirmed).toHaveBeenCalledWith(connectionWorksMessage(6));
  expect(button.getAttribute("aria-busy")).toBeNull();
});

it("cross-fades the meta text with the fast token and ends in the visible state under reduced motion", async () => {
  const css = readFileSync(join(__dirname, "../src/app/settings/settings.css"), "utf8");
  expect(css).not.toMatch(/settings-list-result/);
  expect(css).toMatch(/\.settings-meta-text:not\(:only-child, \.settings-meta-leaving\) \{ animation: settings-meta-in var\(--motion-fast\) var\(--ease-out\); \}/);
  expect(css).toMatch(/\.settings-meta-leaving \{ opacity: 0; animation: settings-meta-out var\(--motion-fast\) var\(--ease-out\); \}/);
  // Only opacity animates and no fill mode holds a frame: the new text ends visible, the replaced one hidden.
  const keyframes = (name: string) => (css.match(new RegExp(`@keyframes ${name} \\{(.*)\\}`))?.[1] ?? "").replace(/\s/g, "");
  expect(keyframes("settings-meta-in")).toBe("from{opacity:0;}");
  expect(keyframes("settings-meta-out")).toBe("from{opacity:1;}");
  // Both button labels share one cell; the inactive one keeps its width but is hidden.
  expect(css).toMatch(/\.settings-test-label \{ grid-area: 1 \/ 1;/);
  expect(css).toMatch(/\.settings-test-label:not\(\[data-active\]\) \{ visibility: hidden; \}/);
  const globals = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
  const reduced = globals.slice(globals.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(reduced).toMatch(/--motion-fast:\s*80ms/);
  // The spinner stops under reduced motion, so the Testing… label carries the progress.
  expect(reduced).toMatch(/\.spin,[^{]*\{\s*animation: none !important;/);

  document.documentElement.style.setProperty("--motion-reduced", "1");
  try {
    const pending = deferred<{ serverError: string }>();
    testConnectionAction.mockReturnValueOnce(pending.promise);
    const view = render(<ul>{row()}</ul>);
    const button = screen.getByRole("button", { name: "Test connection" });
    fireEvent.click(button);
    expect(within(button).getByText("Testing…")).toBeTruthy();
    await act(async () => pending.resolve({ serverError: "The provider rejected this API key (401). Check the key and try again." }));
    const sentence = meta(view.container).querySelector(".settings-meta-text:not(.settings-meta-leaving)") as HTMLElement;
    expect(sentence.textContent).toBe("The provider rejected this API key (401). Check the key and try again.");
    expect(sentence.getAttribute("style")).toBeNull();
  } finally {
    document.documentElement.style.removeProperty("--motion-reduced");
  }
});
