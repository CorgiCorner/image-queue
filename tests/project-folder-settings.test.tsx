// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { move } = vi.hoisted(() => ({ move: vi.fn() }));
vi.mock("../src/actions", () => ({ moveProjectAction: move }));
import { ProjectFolderSettings } from "../src/components/project-folder-settings";
const projects = [{ id: "p", name: "Project", createdAt: "2026-11-14", directory: "/old" }];
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("saves the chosen path and refreshes the workspace", async () => {
  move.mockResolvedValue({ data: { ...projects[0], directory: "/new" } });
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<ProjectFolderSettings projects={projects} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "/new" } });
  fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Project folder saved"));
  expect(move).toHaveBeenCalledWith({ id: "p", directory: "/new" });
  expect(onSaved).toHaveBeenCalledOnce();
});

it("preserves the chosen path after a migration error", async () => {
  move.mockResolvedValue({ serverError: "Project file is missing" });
  render(<ProjectFolderSettings projects={projects} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "/new" } });
  fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Project file is missing"));
  expect((screen.getByLabelText("Project") as HTMLInputElement).value).toBe("/new");
});

it("saves the selected native folder immediately", async () => {
  move.mockResolvedValue({ data: { ...projects[0], directory: "/picked" } });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ path: "/picked" }) });
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(<ProjectFolderSettings projects={projects} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await waitFor(() => expect((screen.getByLabelText("Project") as HTMLInputElement).value).toBe("/picked"));
    expect(fetchMock).toHaveBeenCalledWith("/api/directory-picker", { method: "POST" });
    expect(move).toHaveBeenCalledWith({ id: "p", directory: "/picked" });
  } finally { vi.unstubAllGlobals(); }
});

it("keeps the current folder when the picker is cancelled", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  try {
    render(<ProjectFolderSettings projects={projects} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Choose folder…" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Project") as HTMLInputElement).value).toBe("/old");
  } finally { vi.unstubAllGlobals(); }
});

it("prevents duplicate submissions while a folder move is pending", async () => {
  let complete!: (value: unknown) => void;
  move.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  render(<ProjectFolderSettings projects={projects} onSaved={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "/new" } });
  const form = screen.getByLabelText("Project").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(move).toHaveBeenCalledOnce();
  expect((screen.getByLabelText("Project") as HTMLInputElement).disabled).toBe(true);
  complete({ data: { ...projects[0], directory: "/new" } });
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Project folder saved"));
});

it("retains a successful save when refreshing the workspace fails", async () => {
  move.mockResolvedValue({ data: { ...projects[0], directory: "/saved" } });
  render(<ProjectFolderSettings projects={projects} onSaved={vi.fn().mockRejectedValue(new Error("Offline"))} />);
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: "/saved" } });
  fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("folder saved. Refresh"));
  expect((screen.getByLabelText("Project") as HTMLInputElement).value).toBe("/saved");
});

it("retries a failed migration using the path returned by the picker", async () => {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  move.mockResolvedValueOnce({ serverError: "Folder is temporarily unavailable" })
    .mockResolvedValueOnce({ data: { ...projects[0], directory: ["", "home", "test", "picked"].join("/") } });
  const fetchPicker = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ path: ["", "home", "test", "picked"].join("/") }) });
  vi.stubGlobal("fetch", fetchPicker);
  try {
    render(<ProjectFolderSettings projects={projects} homeDirectory={["", "home", "test"].join("/")} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await screen.findByText("Folder is temporarily unavailable");
    expect((screen.getByLabelText("Project") as HTMLInputElement).value).toBe("~/picked");
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
    await screen.findByText("Project folder saved");
    expect(fetchPicker).toHaveBeenCalledOnce();
    expect(move).toHaveBeenNthCalledWith(2, { id: "p", directory: ["", "home", "test", "picked"].join("/") });
    expect(onSaved).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps manual folder entry available after the native chooser fails", async () => {
  const error = "Folder selection could not be completed. You can enter the path manually.";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error }) }));
  try {
    move.mockResolvedValue({ data: { ...projects[0], directory: "/manual" } });
    render(<ProjectFolderSettings projects={projects} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await screen.findByText(error);
    expect(move).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Project") as HTMLInputElement).value).toBe("/old");

    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "/manual" } });
    fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
    await screen.findByText("Project folder saved");
    expect(move).toHaveBeenCalledExactlyOnceWith({ id: "p", directory: "/manual" });
  } finally {
    vi.unstubAllGlobals();
  }
});
