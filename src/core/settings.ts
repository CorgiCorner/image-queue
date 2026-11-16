import { UserFacingError } from "./user-facing-error";
import { configuration } from "@/core/config";
import type { Storage } from "../storage/types";
import { ProjectStorage } from "../storage/project-storage";
import type { Provider } from "./schema";

function isLocalStore(store: Storage): boolean {
  const workspace = store instanceof ProjectStorage ? store.workspace : store;
  return "root" in workspace;
}

async function encryptionKey() {
  const secret = configuration("SETTINGS_SECRET");
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret))
    throw new UserFacingError(
      "Set SETTINGS_SECRET to a random 32-byte hex value before saving keys");
  const bytes = Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(secret.slice(index * 2, index * 2 + 2), 16),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function saveKey(
  store: Storage,
  provider: Provider,
  value: string,
) {
  if (configuration("STORAGE_DRIVER") === "cloudflare")
    throw new UserFacingError(
      "Configure this provider as an IMAGE_QUEUE platform secret in Cloudflare.");
  if (/[\r\n\0]/.test(value))
    throw new UserFacingError("API key contains invalid characters");
  if (isLocalStore(store)) {
    const { saveLocalCredential } = await import("../storage/credentials");
    await saveLocalCredential(provider, value);
    await store.put("secrets", provider, { external: true });
    return;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  await store.put("secrets", provider, {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted)),
  });
}
export async function readKey(store: Storage, provider: Provider) {
  const names = {
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    gateway: "AI_GATEWAY_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  if (configuration(names[provider])) return configuration(names[provider])!;
  if (isLocalStore(store)) {
    const { localCredential } = await import("../storage/credentials");
    const value = await localCredential(provider);
    if (value) return value;
  }
  const saved = await store.get<{
    iv: number[];
    data: number[];
    disabled?: boolean;
  }>("secrets", provider);
  if (!saved || saved.disabled || !saved.iv)
    throw new UserFacingError("Connect this provider in Settings first");
  const value = new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(saved.iv) },
      await encryptionKey(),
      new Uint8Array(saved.data),
    ),
  );
  if (isLocalStore(store)) {
    const { saveLocalCredential } = await import("../storage/credentials");
    await saveLocalCredential(provider, value);
    await store.put("secrets", provider, { external: true });
  }
  return value;
}

export async function removeKey(store: Storage, provider: Provider) {
  const names = {
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    gateway: "AI_GATEWAY_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  if (configuration(names[provider]))
    throw new UserFacingError(
      "This key is configured in the server environment. Remove it there first.");
  if (isLocalStore(store)) {
    const { removeLocalCredential } = await import("../storage/credentials");
    await removeLocalCredential(provider);
  }
  await store.put("secrets", provider, { disabled: true });
  await store.put("models", provider, []);
}
