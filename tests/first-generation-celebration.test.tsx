// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstGenerationCelebration } from "@/components/first-generation-celebration";
import { finishedGenerations, firstFinishedGeneration, firstGenerationStorageKey } from "@/core/first-generation";
import type { Job } from "@/core/schema";
import { projectLinks } from "@/lib/project-links";

const { confetti, reset } = vi.hoisted(() => ({ confetti: vi.fn(), reset: vi.fn() }));
vi.mock("canvas-confetti", () => ({ default: { create: () => Object.assign(confetti, { reset }) } }));

const job = (id: string, status: Job["status"], extra: Partial<Job> = {}) => ({ id, status, prompt: "p", width: 1024, height: 1024, ...extra }) as Job;

describe("first finished generation", () => {
  it("ignores imports and workspaces that already had a result", () => {
    expect(finishedGenerations([job("a", "done", { imported: true }), job("b", "done"), job("c", "queued")])).toEqual(new Set(["b"]));
    expect(firstFinishedGeneration(new Set(["b"]), [job("b", "done"), job("c", "done")])).toBeUndefined();
    expect(firstFinishedGeneration(new Set(), [job("a", "done", { imported: true })])).toBeUndefined();
    expect(firstFinishedGeneration(new Set(), [job("c", "done")])?.id).toBe("c");
  });
});

describe("FirstGenerationCelebration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    confetti.mockClear();
    reset.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--motion-reduced");
  });

  async function finish(props: { blocked?: boolean } = {}) {
    const view = render(<FirstGenerationCelebration jobs={[job("one", "running")]} loaded blocked={props.blocked ?? false} />);
    view.rerender(<FirstGenerationCelebration jobs={[job("one", "done")]} loaded blocked={props.blocked ?? false} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    return view;
  }

  it("opens once after the first generation finishes, with fireworks from both sides and the links", async () => {
    const view = await finish();
    expect(screen.getByRole("dialog", { name: "Your first image is ready" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Star image-queue on GitHub/ }).getAttribute("href")).toBe(projectLinks.repository);
    expect(screen.getByRole("link", { name: /Star it too/ }).getAttribute("href")).toBe(projectLinks.bisibility);
    expect(screen.getByRole("link", { name: /Follow @msniezynski/ }).getAttribute("href")).toBe(projectLinks.x);
    expect(window.localStorage.getItem(firstGenerationStorageKey)).toBe("1");
    const origins = confetti.mock.calls.map(([options]) => options.origin.x);
    expect(origins).toContain(0);
    expect(origins).toContain(1);

    await act(async () => { screen.getByRole("button", { name: "Close" }).click(); await vi.runAllTimersAsync(); });
    view.rerender(<FirstGenerationCelebration jobs={[job("one", "done"), job("two", "done")]} loaded blocked={false} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.queryByRole("dialog", { name: "Your first image is ready" })).toBeNull();
  });

  it("removes its canvas within one second", async () => {
    const view = render(<FirstGenerationCelebration jobs={[job("one", "running")]} loaded blocked={false} />);
    view.rerender(<FirstGenerationCelebration jobs={[job("one", "done")]} loaded blocked={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(document.querySelector(".celebration-confetti")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(980); });
    expect(document.querySelector(".celebration-confetti")).toBeNull();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("cancels future bursts when closed", async () => {
    const view = render(<FirstGenerationCelebration jobs={[job("one", "running")]} loaded blocked={false} />);
    view.rerender(<FirstGenerationCelebration jobs={[job("one", "done")]} loaded blocked={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const count = confetti.mock.calls.length;
    await act(async () => { screen.getByRole("button", { name: "Close" }).click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(confetti).toHaveBeenCalledTimes(count);
    expect(document.querySelector(".celebration-confetti")).toBeNull();
  });

  it("stops an active effect if reduced motion is enabled", async () => {
    const view = render(<FirstGenerationCelebration jobs={[job("one", "running")]} loaded blocked={false} />);
    view.rerender(<FirstGenerationCelebration jobs={[job("one", "done")]} loaded blocked={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    document.documentElement.style.setProperty("--motion-reduced", "1");
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(document.querySelector(".celebration-confetti")).toBeNull();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("cleans up when the workspace unmounts", async () => {
    const view = render(<FirstGenerationCelebration jobs={[job("one", "running")]} loaded blocked={false} />);
    view.rerender(<FirstGenerationCelebration jobs={[job("one", "done")]} loaded blocked={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    view.unmount();
    expect(document.querySelector(".celebration-confetti")).toBeNull();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("stays away from workspaces that already had results and from a second visit", async () => {
    render(<FirstGenerationCelebration jobs={[job("old", "done")]} loaded blocked={false} />);
    expect(window.localStorage.getItem(firstGenerationStorageKey)).toBe("1");
    cleanup();
    window.localStorage.setItem(firstGenerationStorageKey, "1");
    await finish();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(confetti).not.toHaveBeenCalled();
  });

  it("waits until other dialogs close", async () => {
    const view = await finish({ blocked: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<FirstGenerationCelebration jobs={[job("one", "done")]} loaded blocked={false} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(screen.getByRole("dialog", { name: "Your first image is ready" })).toBeTruthy();
  });

  it("skips fireworks under reduced motion but still asks", async () => {
    document.documentElement.style.setProperty("--motion-reduced", "1");
    await finish();
    expect(screen.getByRole("dialog", { name: "Your first image is ready" })).toBeTruthy();
    expect(confetti).not.toHaveBeenCalled();
  });
});
