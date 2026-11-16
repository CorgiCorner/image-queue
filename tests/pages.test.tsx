import { headers } from "next/headers";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  forbidden: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;403"); },
}));
vi.mock("../src/core/access", () => ({ verifyAccess: vi.fn(async () => {}) }));
vi.mock("../src/core/load-workspace-state", () => ({
  loadWorkspaceState: vi.fn(async () => ({ projects: [{ id: "sample-project" }], jobs: [] })),
}));
vi.mock("../src/components/workspace", () => ({ Workspace: () => null }));

import JobPage from "../src/app/jobs/[id]/page";
import Layout from "../src/app/layout";
import ProjectPage from "../src/app/p/[projectId]/page";
import Page from "../src/app/page";
import Settings from "../src/app/settings/page";
import Website from "../src/app/website/page";
import { verifyAccess } from "../src/core/access";
import { loadWorkspaceState } from "../src/core/load-workspace-state";

it("renders route entry points", async () => {
  expect((await Page({})).props.initialState).toEqual({ projects: [{ id: "sample-project" }], jobs: [] });
  expect(await Layout({ children: "test" })).toBeTruthy();
  expect(
    (await ProjectPage({ params: Promise.resolve({ projectId: "sample-project" }) })).props
      .initialProject,
  ).toBe("sample-project");
  expect(
    (await JobPage({ params: Promise.resolve({ id: "one" }) })).props
      .initialJob,
  ).toBe("one");
});
it("renders the standalone settings and public website routes", async () => {
  expect((await Settings({})).props).toMatchObject({ settingsPage: true, initialState: { projects: [{ id: "sample-project" }], jobs: [] } });
  expect((await Website()).props.className).toBe("public-site");
});

it.each(["localhost:3215", "127.0.0.1:3391", "[::1]:3215"])("renders the local site at %s without loading private workspace state", async (host) => {
  vi.mocked(headers).mockResolvedValueOnce(new Headers({ host }));
  vi.mocked(loadWorkspaceState).mockClear();
  const html = renderToStaticMarkup(await Website());

  expect(html).toContain('class="public-site"');
  expect(html).toContain("Open dashboard");
  expect(html).toContain('href="/"');
  expect(loadWorkspaceState).not.toHaveBeenCalled();
});

it("public website directs visitors to installation and external documentation", async () => {
  vi.mocked(headers).mockResolvedValueOnce(new Headers({ host: "images.example.com" }));
  const html = renderToStaticMarkup(await Website());
  expect(html).not.toContain("Open dashboard");
  expect(html).not.toContain('href="/settings"');
  expect(html).toContain('href="#install"');
  expect(html).toContain("git clone https://github.com/corgicorner/image-queue.git");
  expect(html).toContain("cd image-queue");
  expect(html).toContain("Do I need an API key?");
  expect(html).toContain("An image studio for your ChatGPT plan.");
  expect(html).toContain("Set up with ChatGPT");
  expect(html).toContain("codex://threads/new?");
  expect(html).toContain("Not affiliated with OpenAI");
  expect(html).not.toContain("Image generation for your coding agents.");
});

it.each([["openrouter", "openrouter"], ["unknown", undefined], [["google", "openai"], undefined]])(
  "validates the requested initial provider (%j)", async (provider, expected) => {
    const page = await Settings({ searchParams: Promise.resolve({ provider }) });
    expect(page.props.initialProvider).toBe(expected);
  },
);

it.each([
  { view: "queue", expected: "queue" },
  { view: "archive", expected: "archive" },
  { view: "trash", expected: "trash" },
  { view: "missing", expected: undefined },
  { view: ["queue", "trash"], expected: undefined },
])("initializes the dashboard for view $view", async ({ view, expected }) => {
  const page = await Page({ searchParams: Promise.resolve({ view }) });
  expect(page.props.initialView).toBe(expected);
});

it.each([
  ["dashboard", () => Page({})],
  ["settings", () => Settings({})],
  ["project", () => ProjectPage({ params: Promise.resolve({ projectId: "sample-project" }) })],
  ["job", () => JobPage({ params: Promise.resolve({ id: "one" }) })],
] as const)("blocks private state reads on the %s route when access is denied", async (_route, open) => {
  vi.mocked(loadWorkspaceState).mockClear();
  const denied = new Error("Access denied");
  vi.mocked(verifyAccess).mockRejectedValueOnce(denied);

  await expect(open()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;403");
  expect(loadWorkspaceState).not.toHaveBeenCalled();
});

it("forwards the access assertion before loading the project state", async () => {
  vi.mocked(headers).mockResolvedValueOnce(new Headers({ "cf-access-jwt-assertion": "test-assertion" }));
  vi.mocked(verifyAccess).mockClear();
  vi.mocked(loadWorkspaceState).mockClear();

  const page = await ProjectPage({ params: Promise.resolve({ projectId: "sample-project" }) });

  expect(verifyAccess).toHaveBeenCalledWith("test-assertion");
  expect(verifyAccess).toHaveBeenCalledBefore(vi.mocked(loadWorkspaceState));
  expect(page.props.initialProject).toBe("sample-project");
});

it("returns the project not-found result for an unknown project ID", async () => {
  await expect(ProjectPage({ params: Promise.resolve({ projectId: "missing" }) }))
    .rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
});

it("preserves the Inbox link without a stored project record", async () => {
  const page = await ProjectPage({ params: Promise.resolve({ projectId: "inbox" }) });
  expect(page.props.initialProject).toBe("inbox");
});
