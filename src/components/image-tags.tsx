"use client";
import { useRef, useState } from "react";
import type { Job } from "@/core/schema";
import { tagImageAction, removeImageTagAction } from "@/actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tooltip } from "./ui/tooltip";
import { Plus, X } from "@phosphor-icons/react";

type Result = { data?: Job; serverError?: string; validationErrors?: unknown };
export function ImageTags({ job, onUpdated }: { job: Job; onUpdated: (job: Job) => void }) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState<string[]>([]);
  const accepted = (job.tags ?? []).filter(tag => tag.source !== "agent");
  const suggested = (job.tags ?? []).filter(tag => tag.source === "agent");
  const visible = expanded ? suggested : suggested.slice(0, 8);
  async function mutate(tags: string[], remove = false, focusNext?: string) {
    if (busy.current || !tags.length) return false;
    busy.current = true;
    setPending(true);
    try {
      const result: Result = remove
        ? await removeImageTagAction({ id: job.id, tag: tags[0] })
        : await tagImageAction({ id: job.id, tags });
      if (!result.data) throw new Error(result.serverError ?? "Could not update tags. Please try again.");
      setAdded(remove ? [] : tags.map(tag => tag.trim().toLowerCase()));
      onUpdated(result.data);
      setAnnouncement(remove ? `Removed tag ${tags[0]}.` : tags.length === 1 ? `Added tag ${tags[0]}.` : `Added ${tags.length} tags.`);
      if (focusNext !== undefined) {
        requestAnimationFrame(() => {
          const next = [...(root.current?.querySelectorAll<HTMLButtonElement>("[data-suggestion]") ?? [])]
            .find(button => button.dataset.suggestion === focusNext);
          (next ?? input.current)?.focus({ preventScroll: true });
        });
      }
      return true;
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "Could not update tags.");
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return <div className="image-tags" ref={root} aria-busy={pending}>
    <Label htmlFor={`image-tags-${job.id}`}>Tags</Label>
    <div className="tag-chips" role="group" aria-label="Accepted tags">
      {accepted.map(tag => <Tooltip key={tag.tag} label={tag.tag}><Button variant="outline" size="sm"
        className={`tag-chip tag-chip-accepted${added.includes(tag.tag) ? " tag-chip-added" : ""}`}
        aria-label={`Remove tag ${tag.tag}`}
        aria-disabled={pending} onClick={() => void mutate([tag.tag], true, "")}>
        <span>{shortTag(tag.tag)}</span><X aria-hidden="true" />
      </Button></Tooltip>)}
      <Input autoFocus ref={input} id={`image-tags-${job.id}`} className="tag-input" placeholder="Add a tag"
        value={draft} aria-disabled={pending}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={async event => {
          if (event.nativeEvent.isComposing || busy.current) return;
          if (event.key === "Backspace" && !draft && accepted.length) {
            event.preventDefault();
            void mutate([accepted[accepted.length - 1].tag], true);
          } else if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            const submitted = draft;
            const tags = submitted.split(",").map(value => value.trim()).filter(Boolean);
            if (await mutate(tags)) setDraft(current => current === submitted ? "" : current);
          }
        }} />
    </div>
    {suggested.length > 0 && <section className="tag-suggestions" aria-label="Suggested tags">
      <div className="tag-suggestions-heading"><span>Suggested · {suggested.length}</span>
        <Button variant="ghost" size="sm" aria-disabled={pending}
          onClick={() => void mutate(suggested.map(tag => tag.tag), false, "")}>Add all</Button>
      </div>
      <div className="tag-chips">
        {visible.map((tag, index) => <Tooltip key={tag.tag} label={tag.tag}><Button variant="outline" size="sm"
          className="tag-chip tag-chip-suggested" data-suggestion={tag.tag}
          aria-label={`Add tag ${tag.tag}`} aria-disabled={pending}
          onClick={() => void mutate([tag.tag], false, suggested[index + 1]?.tag ?? "")}>
          <Plus aria-hidden="true" /><span>{shortTag(tag.tag)}</span>
        </Button></Tooltip>)}
        {!expanded && suggested.length > 8 && <Button variant="ghost" size="sm" className="tag-show-more"
          onClick={() => setExpanded(true)}>Show {suggested.length - 8} more</Button>}
      </div>
    </section>}
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </div>;
}
function shortTag(tag: string) { const characters = Array.from(tag); return characters.length > 24 ? `${characters.slice(0, 24).join("")}…` : tag; }
