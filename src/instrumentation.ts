export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configuration } = await import("./core/config");
  if (configuration("STORAGE_DRIVER") === "cloudflare") return;
  const support = (await import("./core/platform-support")).platformSupport(process.platform, process.arch);
  if (support.warning) console.warn(support.warning);
  const { storage } = await import("./storage");
  const { startTrashMaintenance } = await import("./core/maintenance");
  const state = globalThis as typeof globalThis & {
    imageQueueTrashMaintenance?: () => void;
    imageQueueLocalRunner?: Awaited<ReturnType<typeof import("./storage/local-runner").startLocalRunner>>;
  };
  state.imageQueueLocalRunner ??= await (await import("./storage/local-runner")).startLocalRunner(await storage());
  state.imageQueueTrashMaintenance ??= startTrashMaintenance(storage, () => {
    console.error("Trash maintenance failed. It will retry on the next interval.");
  });
}
