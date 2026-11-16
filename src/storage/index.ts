import { configuration } from "@/core/config";
import type { Storage } from "./types";
let localStore: { root: string; store: import("./fs").FileStorage } | undefined;
export async function storage(): Promise<Storage> {
  if (configuration("STORAGE_DRIVER") === "cloudflare") {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const { CloudflareStorage } = await import("./cloudflare");
    const bindings = env as unknown as ConstructorParameters<
      typeof CloudflareStorage
    > extends [infer D, infer B]
      ? { DB: D; BLOBS: B }
      : never;
    return new CloudflareStorage(bindings.DB, bindings.BLOBS);
  }
  const root = configuration("STORAGE_DIR") ?? `${process.cwd()}/storage`;
  if (!localStore || localStore.root !== root) {
    const { FileStorage } = await import("./fs");
    localStore = { root, store: new FileStorage(root) };
  }
  const { openProjectStorage } = await import("./open-project-storage");
  return openProjectStorage(localStore.store);
}
