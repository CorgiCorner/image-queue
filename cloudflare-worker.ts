// @ts-ignore OpenNext generates this module during the Cloudflare build.
import handler from "./.open-next/worker.js";
import { maintainTrash } from "./src/core/maintenance";
import { CloudflareStorage } from "./src/storage/cloudflare";

type StorageBindings = ConstructorParameters<typeof CloudflareStorage>;
type Environment = { DB: StorageBindings[0]; BLOBS: StorageBindings[1] };

export default {
  fetch: handler.fetch,
  async scheduled(event: { scheduledTime: number }, env: Environment) {
    await maintainTrash(new CloudflareStorage(env.DB, env.BLOBS), event.scheduledTime);
  },
};
