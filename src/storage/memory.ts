import { StorageLockBusy, safeKey, type Storage } from "./types";

export class MemoryStorage implements Storage {
  private records = new Map<string, Map<string, unknown>>();
  private blobs = new Map<string, { bytes: Uint8Array; mime: string }>();
  private locks = new Set<string>();

  async list<T>(collection: string): Promise<T[]> {
    safeKey(collection);
    return structuredClone([
      ...(this.records.get(collection)?.values() ?? []),
    ]) as T[];
  }
  async entries<T>(collection: string): Promise<{ id: string; value: T }[]> {
    safeKey(collection);
    return [...(this.records.get(collection)?.entries() ?? [])].map(([id, value]) => ({ id, value: structuredClone(value) as T }));
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    safeKey(collection);
    safeKey(id);
    return structuredClone(this.records.get(collection)?.get(id)) as
      | T
      | undefined;
  }
  async put<T>(collection: string, id: string, value: T) {
    safeKey(collection);
    safeKey(id);
    let records = this.records.get(collection);
    if (!records) {
      records = new Map();
      this.records.set(collection, records);
    }
    records.set(id, structuredClone(value));
  }
  async delete(collection: string, id: string) {
    safeKey(collection);
    safeKey(id);
    this.records.get(collection)?.delete(id);
  }
  async lock<T>(key: string, work: () => Promise<T>): Promise<T> {
    safeKey(key);
    if (this.locks.has(key))
      throw new StorageLockBusy(key);
    this.locks.add(key);
    try {
      return await work();
    } finally {
      this.locks.delete(key);
    }
  }
  async putBlob(key: string, bytes: Uint8Array, mime: string) {
    safeKey(key);
    this.blobs.set(key, { bytes: bytes.slice(), mime });
  }
  async deleteBlob(key: string) {
    this.blobs.delete(safeKey(key));
  }
  async getBlob(key: string) {
    safeKey(key);
    return structuredClone(this.blobs.get(key));
  }
}
