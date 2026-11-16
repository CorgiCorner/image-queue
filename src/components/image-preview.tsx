"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import type { Job } from "@/core/schema";
import { openSharedImage } from "@/lib/shared-image-motion";
import { crossfadePreview } from "@/lib/preview-motion";
import { animateImageZoom } from "@/lib/zoom-motion";
import { imageUrl } from "./gallery";

const loadedImages = new Set<string>();
export function ImagePreview({
  job,
  neighbors,
  notes = [],
  selection,
  onNoteSelect,
}: {
  job: Job;
  neighbors: Job[];
  notes?: import("@/core/notes").ImageNote[];
  selection?: { x: number; y: number; w?: number; h?: number };
  onNoteSelect?: (id: string) => void;
}) {
  const url = imageUrl(job);
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const source = [...document.querySelectorAll<HTMLButtonElement>(".virtual-card[data-job-id]")]
      .find(card => card.dataset.jobId === job.id)?.querySelector<HTMLImageElement>("img");
    if (!source || !stage.current) return;
    return openSharedImage(stage.current, source);
    // Only the initial opening flies from the tile; next/previous uses crossfade.
  }, []);
  const previousPixels = useRef<{ id: string; source: string } | null>(null);
  const stopCrossfade = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    const previous = previousPixels.current;
    if (previous && previous.id !== job.id && stage.current) {
      stopCrossfade.current?.();
      stopCrossfade.current = crossfadePreview(stage.current, previous.source, stage.current.querySelector<HTMLImageElement>(".preview-small"));
    }
    previousPixels.current = { id: job.id, source: imageUrl(job, 640) };
  }, [job.id]);
  useEffect(() => () => stopCrossfade.current?.(), []);
  const currentJobId = useRef(job.id);
  currentJobId.current = job.id;
  const [zoomed, setZoomed] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const zoomButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{pointerId:number;x:number;y:number;left:number;top:number} | undefined>(undefined);
  const zoomFrom = useRef<DOMRect | undefined>(undefined);
  const zoomPointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | undefined>(undefined);
  const stopZoom = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {setZoomed(false);drag.current=undefined;}, [job.id]);
  useLayoutEffect(() => {
    stopZoom.current?.();
    if (!zoomed && viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
    if (zoomed && viewport.current && stage.current && zoomAnchor.current) {
      const anchor = zoomAnchor.current;
      const port = viewport.current.getBoundingClientRect();
      viewport.current.scrollLeft = anchor.x * stage.current.offsetWidth - (anchor.clientX - port.left);
      viewport.current.scrollTop = anchor.y * stage.current.offsetHeight - (anchor.clientY - port.top);
    }
    if (stage.current && zoomFrom.current) stopZoom.current = animateImageZoom(stage.current, zoomFrom.current, job.width / job.height);
    zoomFrom.current = undefined;
    zoomAnchor.current = undefined;
    zoomPointer.current = undefined;
    return () => stopZoom.current?.();
  }, [zoomed, job.id]);
  useEffect(() => {
    if (zoomed) viewport.current?.focus({preventScroll:true});
  }, [zoomed, job.id]);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loaded = loadedImages.has(url) || loadedUrl === url;
  useEffect(() => {
    for (const neighbor of neighbors) {
      if (neighbor.status === "done") {
        const image = new Image();
        image.src = imageUrl(neighbor);
      }
    }
  }, [url, neighbors]);
  return (
    <div className={`image-viewport ${zoomed ? "image-viewport-zoomed" : ""}`} ref={viewport}
      tabIndex={zoomed ? 0 : undefined} role={zoomed ? "region" : undefined} aria-label={zoomed ? "Zoomed image" : undefined}
      onDragStart={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !zoomed || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        stopZoom.current?.();
        const distance = event.shiftKey ? 160 : 40;
        if (event.key === "ArrowLeft") event.currentTarget.scrollLeft -= distance;
        if (event.key === "ArrowRight") event.currentTarget.scrollLeft += distance;
        if (event.key === "ArrowUp") event.currentTarget.scrollTop -= distance;
        if (event.key === "ArrowDown") event.currentTarget.scrollTop += distance;
      }}
      onPointerDown={event => {
        if (!zoomed || drag.current || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        event.stopPropagation();
        stopZoom.current?.();
        drag.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!zoomed && !(event.target as HTMLElement).closest("button")) zoomPointer.current = { x: event.clientX, y: event.clientY };
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        event.currentTarget.scrollLeft=drag.current.left+drag.current.x-event.clientX;
        event.currentTarget.scrollTop=drag.current.top+drag.current.y-event.clientY;
      }}
      onPointerUp={event => {if(zoomed) event.stopPropagation();if(drag.current?.pointerId === event.pointerId) drag.current=undefined;}}
      onPointerCancel={event => {if(drag.current?.pointerId === event.pointerId) drag.current=undefined;}}
      onLostPointerCapture={event => {if(drag.current?.pointerId === event.pointerId) drag.current=undefined;}}>
    <div
      ref={stage}
      className="progressive-image"
      style={{ aspectRatio: `${job.width}/${job.height}`, ...(!zoomed ? {maxWidth: `min(100%, ${65 * job.width / job.height}vh)`, marginInline: "auto"} : {}), ...(zoomed ? {width:job.width,height:job.height,maxHeight:"none"} : {}) }}
    >
      {notes.map(
        (note, index) =>
          note.x !== undefined &&
          note.y !== undefined && (
            <Button
              type="button"
              size="icon"
              key={note.id}
              className="annotation-pin"
              style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%` }}
              aria-label={`Note ${index + 1}: ${note.text}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onNoteSelect?.(note.id);
              }}
            >
              {index + 1}
            </Button>
          ),
      )}
      {notes
        .filter(
          (note) =>
            note.x !== undefined &&
            note.y !== undefined &&
            note.w !== undefined &&
            note.h !== undefined,
        )
        .map((note) => (
          <span
            key={`region-${note.id}`}
            className="annotation-region"
            style={{
              left: `${note.x! * 100}%`,
              top: `${note.y! * 100}%`,
              width: `${note.w! * 100}%`,
              height: `${note.h! * 100}%`,
            }}
          />
        ))}
      {selection?.w !== undefined && selection.h !== undefined && <span
        className="annotation-region annotation-region-draft" aria-hidden="true"
        style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.w * 100}%`, height: `${selection.h * 100}%` }}
      />}
      <img key={`thumb-${job.id}`} draggable={false} className="preview-small" src={imageUrl(job, 640)} alt=""
        onError={event => { event.currentTarget.style.visibility = "hidden"; }}
        onLoad={event => { event.currentTarget.style.visibility = "visible"; }} />
      <img
        key={`${url}-${loadAttempt}`}
        draggable={false}
        className={loaded ? "preview-full loaded" : "preview-full"}
        src={loadAttempt ? `${url}${url.includes("?") ? "&" : "?"}retry=${loadAttempt}` : url}
        alt={job.prompt}
        onError={() => {
          if (currentJobId.current !== job.id) return;
          loadedImages.delete(url);
          setLoadedUrl(undefined);
          setFailedUrl(url);
        }}
        onLoad={() => {
          if (currentJobId.current !== job.id) return;
          setFailedUrl(undefined);
          loadedImages.add(url);
          setLoadedUrl(url);
          previousPixels.current = { id: job.id, source: url };
        }}
      />
    </div>
    {failedUrl === url && (
      <div className="preview-error">
        <p role="status">Full image could not be loaded.</p>
        <Button variant="outline" size="sm" onPointerDown={event => event.stopPropagation()} onClick={event => {
          event.stopPropagation();
          setFailedUrl(undefined);
          setLoadAttempt(attempt => attempt + 1);
        }}>Retry loading</Button>
      </div>
    )}
    <Button ref={zoomButton} className="image-zoom-toggle" variant="outline" size="sm" aria-pressed={zoomed}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        stopZoom.current?.();
        const bounds = stage.current?.getBoundingClientRect();
        zoomFrom.current = event.detail ? bounds : undefined;
        const point = zoomPointer.current;
        if (!zoomed && bounds?.width && bounds.height && point && viewport.current) {
          zoomAnchor.current = {
            x: Math.max(0, Math.min(1, (point.x - bounds.left) / bounds.width)),
            y: Math.max(0, Math.min(1, (point.y - bounds.top) / bounds.height)),
            clientX: point.x, clientY: point.y,
          };
        }
        setZoomed(value=>!value);
        if(zoomed) zoomButton.current?.focus();
      }}
    >{zoomed ? "Fit" : "100%"}</Button>
    </div>
  );
}
