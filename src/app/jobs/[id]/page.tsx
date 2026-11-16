import { loadWorkspaceState } from "@/core/load-workspace-state";
import { requirePageAccess } from "@/core/page-access";
import { Workspace } from "@/components/workspace";
export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageAccess();
  const { id } = await params;
  return <Workspace key={id} initialJob={id} initialState={await loadWorkspaceState()} />;
}
