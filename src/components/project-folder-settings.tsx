"use client";

import { useRef, useState } from "react";
import type { Project } from "@/core/schema";
import { moveProjectAction } from "@/actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function ProjectFolderSettings({ projects, homeDirectory, onSaved }: { projects: Project[]; homeDirectory?: string; onSaved: () => Promise<unknown> }) {
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const pending = useRef(false);

  function displayPath(directory: string) {
    if (homeDirectory && directory === homeDirectory) return "~";
    if (homeDirectory && directory.startsWith(`${homeDirectory}/`)) {
      return `~${directory.slice(homeDirectory.length)}`;
    }
    return directory;
  }

  async function persist(project: Project, directory: string) {
    const result = await moveProjectAction({ id: project.id, directory });
    if (result?.serverError) throw new Error(result.serverError);
    if (!result?.data?.directory) throw new Error("Choose an absolute project folder");
    const savedDirectory = result.data.directory;
    setPaths(current => ({ ...current, [project.id]: displayPath(savedDirectory) }));
    try {
      await onSaved();
      setMessage(`${project.name} folder saved`);
    } catch {
      setMessage(`${project.name} folder saved. Refresh the page to update the workspace.`);
    }
  }

  async function choose(project: Project) {
    if (pending.current) return;
    pending.current = true;
    setBusy(project.id);
    setMessage("");
    try {
      const response = await fetch("/api/directory-picker", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.path && result.path !== project.directory) {
        setPaths(current => ({ ...current, [project.id]: displayPath(result.path) }));
        await persist(project, result.path);
      }
    } catch (error) { setMessage((error as Error).message); }
    finally { pending.current = false; setBusy(null); }
  }

  async function save(project: Project) {
    const value = paths[project.id]?.trim();
    const directory = homeDirectory && (value === "~" || value?.startsWith("~/"))
      ? `${homeDirectory}${value.slice(1)}`
      : value;
    if (pending.current || !directory || directory === project.directory) return;
    pending.current = true;
    setBusy(project.id);
    setMessage("");
    try {
      await persist(project, directory);
    } catch (error) { setMessage((error as Error).message); }
    finally { pending.current = false; setBusy(null); }
  }

  return <section id="project-folders" className="settings-card" aria-labelledby="project-folders-title">
    <header className="settings-card-header">
      <h2 id="project-folders-title">Project folders</h2>
      <p>Each folder stores its project’s images, references and metadata.</p>
    </header>
    {projects.length === 0 && <p className="settings-empty settings-row">Create a project to choose its folder.</p>}
    {projects.map(project => <form key={project.id} className="settings-row settings-row-stacked" onSubmit={event => { event.preventDefault(); void save(project); }}>
      <Label htmlFor={`folder-${project.id}`}>{project.name}</Label>
      <div className="settings-path-control">
        <Input id={`folder-${project.id}`} value={paths[project.id] ?? displayPath(project.directory ?? "")} onChange={event => setPaths(current => ({ ...current, [project.id]: event.target.value }))} placeholder="Choose a project folder" maxLength={4096} disabled={busy !== null} required />
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void choose(project)}>{busy === project.id ? "Working…" : "Choose folder…"}</Button>
        {paths[project.id]?.trim() && paths[project.id] !== displayPath(project.directory ?? "") && (
          <Button type="submit" variant="outline" disabled={busy !== null}>Save folder</Button>
        )}
      </div>
    </form>)}
    {message && <footer className="settings-card-footer"><p className="settings-footer-hint" role="status">{message}</p></footer>}
  </section>;
}
