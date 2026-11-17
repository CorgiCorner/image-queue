"use client";
import { ChangingLabel } from "./changing-label";
import { Tooltip } from "./ui/tooltip";
import { animateGalleryChange } from "@/lib/gallery-motion";
import { retainPendingImage } from "@/lib/ready-image-motion";
import { thumbnailWidths } from "@/core/thumbnail-widths";
import { isReserved, jobStatusLabels as labels } from "@/core/job-status";
import { Clock as Clock3, Warning, Stack, Image as ImageIcon, CircleNotch as LoaderCircle } from "@phosphor-icons/react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type LayoutMode, layout, visibleRectangles } from "@/core/layout";
import {
  selectionBox,
  selectRectangles,
  type SelectionBox,
} from "@/core/selection";
import { trashDaysRemaining } from "@/core/retention";
import type { Job } from "@/core/schema";
import { Image as GeneratedImage } from "./ai-elements/image";


export function imageUrl(job: Job, width?: number) {
  return `/api/asset?job=${encodeURIComponent(job.id)}${
    width ? `&thumb=${width}` : ""
  }`;
}
function blockedReason(error?: string) {
  if (!error) return;
  if (/\bsize\b.*\b(?:png|field|suffix)\b|\b(?:png|field|suffix)\b.*\bsize\b/i.test(error))
    return "Size format rejected by the worker";
  return error;
}

export function Gallery({
  jobs,
  mode,
  onOpen,
  selectedIds,
  onSelection,
  stackCounts = {},
  showArchiveBadge = true,
  restoreMotionRevision = 0,
  insertionMotionRevision = 0,
  removalMotionRevision = 0,
}: {
  jobs: Job[];
  restoreMotionRevision?: number;
  insertionMotionRevision?: number;
  removalMotionRevision?: number;
  stackCounts?: Record<string, number>;
  showArchiveBadge?: boolean;
  mode: LayoutMode;
  onOpen: (job: Job) => void;
  selectedIds: string[];
  onSelection: (ids: string[]) => void;
}) {
  const anchor = useRef(0);
  const suppressClick = useRef(false);
  const touchInteraction = useRef(false);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => () => clearTimeout(touchTimer.current), []);
  const drag = useRef<{ x: number; y: number; existing: string[] } | undefined>(
    undefined,
  );
  const pointerPosition = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const [selection, setSelection] = useState<SelectionBox | undefined>();
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [windowBounds, setWindowBounds] = useState({ top: 0, bottom: 900 });
  const [focused, setFocused] = useState(0);
  const [rapidScroll, setRapidScroll] = useState(false);
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(() => new Set());
  const loadedThumbnails = useRef(new Set<string>());
  const pendingSurfaces = useRef(new Map<string, HTMLElement>());
  const readyTransitions = useRef(new Map<string, () => void>());
  const readySignature = jobs.map(job => `${job.id}:${job.status}`).join("\0");
  useLayoutEffect(() => {
    const readyIds = new Set(jobs.filter(job => job.status === "done").map(job => job.id));
    for (const [id, stop] of readyTransitions.current) {
      if (!readyIds.has(id)) {
        stop(); readyTransitions.current.delete(id);
      }
    }
    const next = new Map<string, HTMLElement>();
    for (const card of root.current?.querySelectorAll<HTMLElement>(".virtual-card") ?? []) {
      const id = card.dataset.jobId!;
      const pending = card.querySelector<HTMLElement>(".pending-art:not(.pending-image-outgoing)");
      if (pending) next.set(id, pending.cloneNode(true) as HTMLElement);
      else {
        const previous = pendingSurfaces.current.get(id);
        const stage = card.querySelector<HTMLElement>(".virtual-stage");
        if (previous && stage) {
          readyTransitions.current.get(id)?.();
          let completed = false;
          const stop = retainPendingImage(stage, previous, () => {
            completed = true;
            readyTransitions.current.delete(id);
          });
          if (!completed) readyTransitions.current.set(id, stop);
        }
      }
    }
    pendingSurfaces.current = next;
  }, [readySignature, width]);
  useEffect(() => () => readyTransitions.current.forEach(stop => stop()), []);
  const geometry = useMemo(
    () =>
      layout(jobs, width, mode, width < 600 ? 10 : 16, width < 600 ? 140 : 240),
    [jobs, width, mode],
  );
  const displayed = useMemo(() => {
    if (!width) return [];
    const visible = visibleRectangles(
      geometry,
      windowBounds.top,
      windowBounds.bottom,
    );
    const focusRect = geometry.rectangles[focused];
    if (focusRect && !visible.some((rect) => rect.id === focusRect.id))
      visible.push(focusRect);
    return visible;
  }, [geometry, windowBounds, focused, width]);
  const previousCollection = useRef<{ mode: LayoutMode; ids: string; restore: number; insertion: number; removal: number; geometry: typeof geometry } | null>(null);
  const stopMotion = useRef<(() => void) | undefined>(undefined);
  const collectionIds = jobs.map(job => job.id).join("\0");
  useLayoutEffect(() => {
    const before = previousCollection.current;
    previousCollection.current = { mode, ids: collectionIds, restore: restoreMotionRevision, insertion: insertionMotionRevision, removal: removalMotionRevision, geometry };
    if (!before || !root.current || !width) return;
    if (before.mode === mode && before.ids === collectionIds) return;
    stopMotion.current?.();
    stopMotion.current = animateGalleryChange(root.current, before.geometry.rectangles, geometry.rectangles, before.mode !== mode, before.restore !== restoreMotionRevision || before.insertion !== insertionMotionRevision, before.removal !== removalMotionRevision);
  }, [mode, collectionIds, geometry, width, restoreMotionRevision, insertionMotionRevision, removalMotionRevision]);
  useEffect(() => () => stopMotion.current?.(), []);
  useEffect(() => {
    if (!selection) return;
    const timer = setInterval(() => {
      const pointer = pointerPosition.current;
      const start = drag.current;
      if (!pointer || !start || !root.current) return;
      const edge = 48;
      const delta =
        pointer.y < edge ? -16 : pointer.y > innerHeight - edge ? 16 : 0;
      if (!delta) return;
      window.scrollBy(0, delta);
      const bounds = root.current.getBoundingClientRect();
      const box = selectionBox(start, {
        x: pointer.x - bounds.left,
        y: pointer.y - bounds.top,
      });
      setSelection(box);
      onSelection(selectRectangles(geometry.rectangles, box, start.existing));
    }, 32);
    return () => clearInterval(timer);
  }, [Boolean(selection), geometry, onSelection]);
  const byId = useMemo(
    () => new Map(jobs.map((job, index) => [job.id, { job, index }])),
    [jobs],
  );
  useLayoutEffect(() => {
    const element = root.current!;
    const initialWidth = element.clientWidth;
    if (initialWidth > 0) setWidth(initialWidth);
    const resize = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    const target = element;
    resize.observe(element);
    let frame = 0;
    let previousY = window.scrollY;
    let previousTime = performance.now();
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    function update() {
      const bounds = target.getBoundingClientRect();
      if (target.clientWidth > 0) setWidth(target.clientWidth);
      setWindowBounds({ top: -bounds.top, bottom: innerHeight - bounds.top });
      frame = 0;
    }
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onScroll = () => {
      const now = performance.now();
      const y = window.scrollY;
      if (Math.abs(y - previousY) >= 100 && Math.abs(y - previousY) / Math.max(1, now - previousTime) > 2) {
        setRapidScroll(true);
      }
      previousTime = now;
      previousY = y;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setRapidScroll(false), 120);
      scroll();
    };
    update();
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    function onResize() {
      // Modal scroll-lock can finish resizing the body after window listeners run.
      if (target.clientWidth > 0) setWidth(target.clientWidth);
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (target.clientWidth > 0) setWidth(target.clientWidth);
        scroll();
      }, 0);
      scroll();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      resize.disconnect();
      clearTimeout(resizeTimer);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(settleTimer);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, []);
  function keyboard(event: React.KeyboardEvent, index: number) {
    if (
      ![
        "ArrowRight",
        "ArrowLeft",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const current = geometry.rectangles[index];
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = jobs.length - 1;
    else if (event.key === "ArrowRight")
      next = Math.min(jobs.length - 1, index + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      let distance = Infinity;
      geometry.rectangles.forEach((rect, i) => {
        if (direction * (rect.y - current.y) < 1) return;
        const candidate =
          Math.abs(rect.y - current.y) +
          Math.abs(rect.x + rect.width / 2 - (current.x + current.width / 2));
        if (candidate < distance) {
          distance = candidate;
          next = i;
        }
      });
    }
    setFocused(next);
    if (event.shiftKey) {
      const [start, end] = [
        Math.min(anchor.current, next),
        Math.max(anchor.current, next),
      ];
      onSelection(jobs.slice(start, end + 1).map((job) => job.id));
    }
    const rectangle = geometry.rectangles[next];
    const rootTop = root.current!.getBoundingClientRect().top;
    const absoluteTop = rootTop + scrollY + rectangle.y;
    if (
      absoluteTop < scrollY ||
      absoluteTop + rectangle.height > scrollY + innerHeight - 180
    )
      window.scrollTo({ top: Math.max(0, absoluteTop - 90) });
    requestAnimationFrame(
      () =>
        root.current
          ?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)
          ?.focus({ preventScroll: true }),
    );
  }
  return (
    <section
      ref={root}
      className={`virtual-gallery layout-${mode}${selectedIds.length ? " has-selection" : ""}`}
      style={{ height: width ? geometry.height : 0 }}
      aria-label="Image gallery"
      onKeyDown={(event) => {
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input:not([type="checkbox"]), textarea, select, [role="textbox"]'))) return;
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "a"
        ) {
          event.preventDefault();
          event.stopPropagation();
          onSelection(jobs.map((job) => job.id));
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          onSelection([]);
        }
      }}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (
          event.pointerType === "touch" ||
          event.button !== 0 ||
          (event.target !== event.currentTarget && !event.altKey)
        )
          return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        drag.current = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
          existing: event.shiftKey ? selectedIds : [],
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        pointerPosition.current = { x: event.clientX, y: event.clientY };
        const bounds = event.currentTarget.getBoundingClientRect();
        const box = selectionBox(start, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
        if (box.width < 4 && box.height < 4) return;
        suppressClick.current = true;
        setSelection(box);
        onSelection(selectRectangles(geometry.rectangles, box, start.existing));
      }}
      onPointerUp={() => {
        drag.current = undefined;
        pointerPosition.current = undefined;
        setSelection(undefined);
      }}
      onPointerCancel={() => {
        drag.current = undefined;
        pointerPosition.current = undefined;
        setSelection(undefined);
      }}
    >
      {selection && (
        <div
          className="selection-box"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        />
      )}
      {displayed.map((rect) => {
        const { job, index } = byId.get(rect.id)!;
        const reserved = isReserved(job);
        const pending = job.status === "queued" || job.status === "running";
        const statusLabel = reserved ? "Reserved" : job.status === "queued" ? "Waiting" : labels[job.status];
        const firstRow = rect.y < 1;
        const thumbnail = imageUrl(job, 320);
        return (
          <Fragment key={job.id}>
            <input
              type="checkbox"
              className="gallery-select"
              aria-label={`Select ${job.prompt.slice(0, 100)}`}
              checked={selectedIds.includes(job.id)}
              style={{ left: rect.x + rect.width - 34, top: rect.y + 10 }}
              onChange={() =>
                onSelection(
                  selectedIds.includes(job.id)
                    ? selectedIds.filter((id) => id !== job.id)
                    : [...selectedIds, job.id],
                )
              }
            />
            <button
              type="button"
              key={job.id}
              data-index={index}
              data-job-id={job.id}
              draggable
              onDragStart={(event) => {
                if (drag.current || event.altKey) {
                  event.preventDefault();
                  return;
                }
                const ids = selectedIds.includes(job.id)
                  ? selectedIds
                  : [job.id];
                event.dataTransfer.setData(
                  "application/x-image-queue-jobs",
                  JSON.stringify(ids),
                );
                event.dataTransfer.effectAllowed = "copyMove";
              }}
              onPointerDown={(event) => {
                touchInteraction.current = event.pointerType === "touch";
                if (!touchInteraction.current) return;
                touchStart.current = { x: event.clientX, y: event.clientY };
                clearTimeout(touchTimer.current);
                touchTimer.current = setTimeout(() => {
                  suppressClick.current = true;
                  onSelection(
                    selectedIds.includes(job.id)
                      ? selectedIds
                      : [...selectedIds, job.id],
                  );
                }, 450);
              }}
              onPointerMove={(event) => {
                const start = touchStart.current;
                if (
                  start &&
                  Math.hypot(event.clientX - start.x, event.clientY - start.y) >
                    8
                )
                  clearTimeout(touchTimer.current);
              }}
              onPointerUp={() => {
                clearTimeout(touchTimer.current);
                touchStart.current = undefined;
              }}
              onPointerCancel={() => {
                clearTimeout(touchTimer.current);
                touchStart.current = undefined;
              }}
              tabIndex={index === focused ? 0 : -1}
              className={`virtual-card ${
                job.stackId && stackCounts[job.stackId] > 1
                  ? "version-stack"
                  : ""
              }`}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
              }}
              aria-label={`${statusLabel}: ${job.prompt.slice(0, 180)}`}
              aria-pressed={selectedIds.includes(job.id)}
              onKeyDown={(event) => {
                if (event.key === " ") {
                  event.preventDefault();
                  onSelection(
                    selectedIds.includes(job.id)
                      ? selectedIds.filter((id) => id !== job.id)
                      : [...selectedIds, job.id],
                  );
                } else keyboard(event, index);
              }}
              onClick={(event) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                if (touchInteraction.current && selectedIds.length > 0) {
                  onSelection(
                    selectedIds.includes(job.id)
                      ? selectedIds.filter((id) => id !== job.id)
                      : [...selectedIds, job.id],
                  );
                  return;
                }
                if (event.shiftKey) {
                  const start = Math.min(anchor.current, index),
                    end = Math.max(anchor.current, index);
                  onSelection(
                    jobs.slice(start, end + 1).map((item) => item.id),
                  );
                } else if (event.metaKey || event.ctrlKey) {
                  onSelection(
                    selectedIds.includes(job.id)
                      ? selectedIds.filter((id) => id !== job.id)
                      : [...selectedIds, job.id],
                  );
                  anchor.current = index;
                } else {
                  anchor.current = index;
                  onOpen(job);
                }
              }}
            >
              <div
                className={`virtual-stage ${job.transparent ? "checker" : ""}${pending ? " pending-stage" : ""}`}
                style={{ backgroundColor: job.dominantColor }}
              >
                {job.status === "done" ? (
                  failedThumbnails.has(thumbnail) ? <span className="thumbnail-fallback">Preview unavailable · Open image</span> : (!rapidScroll || loadedThumbnails.current.has(thumbnail)) && <GeneratedImage
                    src={thumbnail}
                    style={{ opacity: loadedThumbnails.current.has(thumbnail) ? 1 : 0 }}
                    onLoad={event => {
                      event.currentTarget.style.visibility = "";
                      event.currentTarget.style.opacity = "1";
                      loadedThumbnails.current.add(thumbnail);
                    }}
                    onError={() => setFailedThumbnails(previous => new Set(previous).add(thumbnail))}
                    srcSet={thumbnailWidths
                      .map((size) => `${imageUrl(job, size)} ${size}w`)
                      .join(", ")}
                    sizes={`${Math.ceil(rect.width)}px`}
                    loading={firstRow ? "eager" : "lazy"}
                    fetchPriority={firstRow ? "high" : "auto"}
                    decoding="async"
                    alt={job.prompt.slice(0, 180)}
                  />
                ) : (
                  <div className="pending-art">
                    {job.status === "running" || reserved ? (
                      <LoaderCircle className="spin" size={24} />
                    ) : job.status === "queued" ? (
                      <Clock3 size={24} />
                    ) : ["blocked", "failed"].includes(job.status) ? (
                      <Warning size={24} />
                    ) : (
                      <ImageIcon size={24} />
                    )}
                    {!["queued", "running"].includes(job.status) && <span>{statusLabel}</span>}
                    {["queued", "running"].includes(job.status) && <span className="pending-prompt">{job.prompt}</span>}
                    {reserved && job.claim && (
                      <span className="pending-worker block w-full text-xs">
                        <Tooltip label={job.claim.owner}><span className="block truncate">{job.claim.owner}</span></Tooltip>
                        <time dateTime={job.claim.since}>
                          {new Date(job.claim.since).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </time>
                      </span>
                    )}
                    {job.status === "blocked" && job.error && (
                      <Tooltip label={job.error}><span className="pending-reason">{blockedReason(job.error)}</span></Tooltip>
                    )}
                  </div>
                )}
                {job.stackId && stackCounts[job.stackId] > 1 && (
                  <span className="version-count" aria-label={`${stackCounts[job.stackId]} versions`}>
                    {pending ? <><Stack size={10} aria-hidden="true" />{stackCounts[job.stackId]}</> : `${stackCounts[job.stackId]} versions`}
                  </span>
                )}
                {job.trashedAt ? (
                  <span className="retention-badge">
                    {trashDaysRemaining(job.trashedAt)} days left
                  </span>
                ) : job.archivedAt && showArchiveBadge ? (
                  <span className="retention-badge">Archived</span>
                ) : null}
                {!["queued", "running"].includes(job.status) && <div className="virtual-caption">
                  <span>{job.source === "queue" ? "Codex" : job.model}</span>
                  <strong>{job.prompt.slice(0, 120)}</strong>
                </div>}
                {["queued", "running"].includes(job.status) && (
                  <span className={`status-badge ${job.status}`}>
                    <Clock3 size={10} /> <ChangingLabel value={statusLabel} />
                  </span>
                )}
              </div>
            </button>
          </Fragment>
        );
      })}
    </section>
  );
}
