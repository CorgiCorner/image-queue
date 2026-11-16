import "./settings.css";
import { loadWorkspaceState } from "@/core/load-workspace-state";
import { homedir } from "node:os";
import { requirePageAccess } from "@/core/page-access";
import { settingsSchema } from "@/core/schema";
import { Workspace } from "@/components/workspace";
export default async function SettingsPage({ searchParams }: {
  searchParams?: Promise<{ provider?: string | string[] }>;
}) {
  await requirePageAccess();

  const selectedProvider = settingsSchema.shape.provider.safeParse((await searchParams)?.provider);
  return <Workspace initialState={await loadWorkspaceState()} settingsPage
    settingsHomeDirectory={homedir()} initialProvider={selectedProvider.data} />;
}
