"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Section = { id: string; label: string };
type Group = { label: string; sections: Section[] };

function settingsGroups(cloud: boolean, localRunner: boolean): Group[] {
  return [
    { label: "Generation", sections: [
      { id: "generation-source", label: "Default source" },
      { id: "provider-connection", label: "Providers" },
      { id: "worker-pool", label: localRunner ? "Codex queue" : "Worker pool" },
    ] },
    ...(cloud ? [] : [{ label: "Storage", sections: [
      { id: "project-folders", label: "Project folders" },
      { id: "local-directories", label: "Local directories" },
    ] }]),
    { label: "Library", sections: [{ id: "tag-settings", label: "Tags and search" }] },
    { label: "Agents", sections: [{ id: "agent-connection", label: "Connect an agent" }] },
  ];
}

/** Grouped section list: a sticky rail on wide screens, a scrollable row below that. */
export function SettingsNav({ cloud, localRunner = false }: { cloud: boolean; localRunner?: boolean }) {
  const groups = useMemo(() => settingsGroups(cloud, localRunner), [cloud, localRunner]);
  const ids = useMemo(() => groups.flatMap(group => group.sections.map(section => section.id)), [groups]);
  const [active, setActive] = useState(ids[0]);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (ids.includes(fromHash)) setActive(fromHash);
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    // The top 40% of the viewport decides which section is being read.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      if (atEnd()) return;
      const current = ids.find(id => visible.has(id));
      if (current) setActive(current);
    }, { rootMargin: "0px 0px -60% 0px" });
    for (const id of ids) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    // A short last section never reaches the top band, so the page end selects it.
    const atEnd = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const onScroll = () => { if (atEnd() && window.scrollY > 0) setActive(ids[ids.length - 1]); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, [ids]);

  // Keep the current link visible in the horizontal row.
  useEffect(() => {
    const row = list.current;
    const link = row?.querySelector<HTMLElement>("[aria-current]");
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    const bounds = row.getBoundingClientRect();
    const target = link.getBoundingClientRect();
    if (target.left < bounds.left || target.right > bounds.right) {
      row.scrollTo({ left: row.scrollLeft + target.left - bounds.left - 16 });
    }
  }, [active]);

  return <nav className="settings-nav" aria-label="Settings sections">
    <div className="settings-nav-list" ref={list}>
      {groups.map(group => <div className="settings-nav-group" key={group.label} role="group" aria-labelledby={`settings-nav-${group.label.toLowerCase()}`}>
        <span className="settings-nav-group-label" id={`settings-nav-${group.label.toLowerCase()}`}>{group.label}</span>
        {group.sections.map(section => <a key={section.id} href={`#${section.id}`}
          aria-current={active === section.id ? "location" : undefined}
          onClick={() => setActive(section.id)}>
          {section.label}
        </a>)}
      </div>)}
    </div>
  </nav>;
}
