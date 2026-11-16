import { loadWorkspaceState } from "@/core/load-workspace-state";
import { requirePageAccess } from "@/core/page-access";
import { Workspace } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: {
  searchParams?: Promise<{ view?: string | string[] }>;
}) {
  await requirePageAccess();

  const view = (await searchParams)?.view;
  const initialView = view === "archive" || view === "trash" || view === "queue" ? view : undefined;
  return <Workspace initialState={await loadWorkspaceState()} initialView={initialView} />;
}
