"use client";

import { GithubLogo, Star, XLogo } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { finishedGenerations, firstFinishedGeneration, firstGenerationStorageKey } from "@/core/first-generation";
import type { Job } from "@/core/schema";
import { isMotionReduced } from "@/lib/motion";
import { projectLinks } from "@/lib/project-links";

const colors = ["#7174e8", "#9b9df8", "#e8e9ec", "#84c7a8", "#f1b887"];

function readCelebrated() {
  try {
    return window.localStorage.getItem(firstGenerationStorageKey) === "1";
  } catch {
    return false;
  }
}

function storeCelebrated() {
  try {
    window.localStorage.setItem(firstGenerationStorageKey, "1");
  } catch {
    // Without storage the celebration can repeat after a reload; the workspace still works.
  }
}

/** Own the canvas and timers so a dismissed celebration cannot leave particles behind. */
async function fireworks(signal: AbortSignal) {
  if (isMotionReduced() || signal.aborted) return;
  const { default: confetti } = await import("canvas-confetti");
  if (isMotionReduced() || signal.aborted) return;
  const canvas = document.createElement("canvas");
  canvas.className = "celebration-confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const burst = confetti.create(canvas, { resize: true });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let monitor: ReturnType<typeof setInterval>;
  const stop = () => {
    timers.forEach(clearTimeout);
    clearInterval(monitor);
    burst.reset();
    canvas.remove();
    signal.removeEventListener("abort", stop);
  };
  signal.addEventListener("abort", stop, { once: true });
  const shot = (x: number, angle: number) => burst({
    particleCount: 45, angle, spread: 60, startVelocity: 40, ticks: 30,
    origin: { x, y: 0.75 }, colors, disableForReducedMotion: true,
  });
  for (const delay of [0, 200, 400]) {
    timers.push(setTimeout(() => {
      if (signal.aborted || isMotionReduced()) return stop();
      shot(0, 60);
      shot(1, 120);
    }, delay));
  }
  // Leave scheduling headroom within the one-second visual budget.
  // This is a one-off effect lifetime, not an interface transition.
  timers.push(setTimeout(stop, 950));
  monitor = setInterval(() => { if (isMotionReduced()) stop(); }, 50);
}

export function FirstGenerationCelebration({ jobs, loaded, blocked }: { jobs: readonly Job[]; loaded: boolean; blocked: boolean }) {
  const previous = useRef<Set<string> | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    const done = finishedGenerations(jobs);
    const before = previous.current;
    previous.current = done;
    if (!before) {
      // Existing workspaces with earlier results never see the first-success dialog.
      if (done.size > 0) storeCelebrated();
      return;
    }
    if (job || readCelebrated()) return;
    const first = firstFinishedGeneration(before, jobs);
    if (!first) return;
    storeCelebrated();
    setJob(first);
  }, [jobs, loaded, job]);

  const shown = useRef(false);
  useEffect(() => {
    // Waits for other dialogs to close, then opens once.
    if (!job || blocked || shown.current) return;
    shown.current = true;
    setOpen(true);

  }, [job, blocked]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fireworks(controller.signal).catch(() => {
      // A decorative effect must not interrupt the completed image or its dialog.
    });
    return () => controller.abort();
  }, [open]);

  if (!job) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="celebration sm:max-w-md">
        <div className="celebration-image checker">
          <img src={`/api/asset?job=${encodeURIComponent(job.id)}&thumb=1`} alt="" decoding="async" onError={event => { event.currentTarget.hidden = true; }} />
        </div>
        <DialogHeader>
          <DialogTitle>Your first image is ready</DialogTitle>
          <DialogDescription>
            image-queue is free and open source. If it helps you, a star on GitHub helps other people find it.
          </DialogDescription>
        </DialogHeader>
        <a className={cn(buttonVariants(), "celebration-star")} href={projectLinks.repository} target="_blank" rel="noreferrer">
          <Star weight="fill" /> Star image-queue on GitHub
        </a>
        <div className="celebration-sibling">
          <p>
            <strong>Bisibility</strong> is our open-source SEO platform: rankings, keywords and backlinks.
          </p>
          <a className={buttonVariants({ variant: "outline" })} href={projectLinks.bisibility} target="_blank" rel="noreferrer">
            <GithubLogo /> Star it too
          </a>
        </div>
        <a className="celebration-follow" href={projectLinks.x} target="_blank" rel="noreferrer">
          <XLogo /> Follow {projectLinks.xHandle} for updates
        </a>
      </DialogContent>
    </Dialog>
  );
}
