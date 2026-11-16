import { UserFacingError } from "../core/user-facing-error";
export class StorageLockBusy extends Error {
  constructor(readonly key: string) {
    super("Another operation is in progress. Try again.");
  }
}

export interface Storage {
  moveProject?(id: string, directory: string): Promise<import("../core/schema").Project>;
  createProject?(project: import("../core/schema").Project): Promise<import("../core/schema").Project>;
  list<T>(collection: string): Promise<T[]>;
  entries<T>(collection: string): Promise<{ id: string; value: T }[]>;
  get<T>(collection: string, id: string): Promise<T | undefined>;
  put<T>(collection: string, id: string, value: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  lock<T>(key: string, work: () => Promise<T>): Promise<T>;
  putBlob(key: string, value: Uint8Array, mime: string): Promise<void>;
  deleteBlob(key: string): Promise<void>;
  getBlob(
    key: string,
  ): Promise<{ bytes: Uint8Array; mime: string } | undefined>;
}
export function safeKey(key: string) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(key) ||
    key.split("/").some((p) => p === ".." || p === ".")
  )
    throw new UserFacingError("Invalid storage key");
  return key;
}
