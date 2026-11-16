import { notFound } from "next/navigation";
import { requirePageAccess } from "@/core/page-access";
import { loadWorkspaceState } from "@/core/load-workspace-state";
import { Workspace } from "@/components/workspace";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requirePageAccess();
  const { projectId } = await params;
  const state = await loadWorkspaceState();
  if (projectId !== "inbox" && !state.projects.some((project) => project.id === projectId)) notFound();
  return <Workspace key={projectId} initialProject={projectId} initialState={state} />;
}
