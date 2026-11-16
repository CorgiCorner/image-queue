import { StorageLockBusy, type Storage, safeKey } from "./types";

interface Database {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
  };
}
interface Bucket {
  delete(key: string): Promise<unknown>;
  put(key: string, value: Uint8Array, options: unknown): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
}
export class CloudflareStorage implements Storage {
  constructor(
    private db: Database,
    private bucket: Bucket,
  ) {}
  async list<T>(collection: string) {
    const { results } = await this.db
      .prepare("SELECT value FROM records WHERE collection = ?")
      .bind(safeKey(collection))
      .all<{ value: string }>();
    return results.map((r) => JSON.parse(r.value) as T);
  }
  async entries<T>(collection: string): Promise<{ id: string; value: T }[]> {
    const { results } = await this.db.prepare("SELECT id, value FROM records WHERE collection = ?")
      .bind(safeKey(collection)).all<{ id: string; value: string }>();
    return results.map(record => ({ id: record.id, value: JSON.parse(record.value) as T }));
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const row = await this.db
      .prepare("SELECT value FROM records WHERE collection = ? AND id = ?")
      .bind(safeKey(collection), safeKey(id))
      .first<{ value: string }>();
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  async put<T>(collection: string, id: string, value: T) {
    await this.db
      .prepare(
        "INSERT INTO records(collection,id,value) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value",
      )
      .bind(safeKey(collection), safeKey(id), JSON.stringify(value))
      .run();
  }
  async delete(collection: string, id: string) {
    await this.db.prepare("DELETE FROM records WHERE collection = ? AND id = ?")
      .bind(safeKey(collection), safeKey(id)).run();
  }
  async lock<T>(key: string, work: () => Promise<T>) {
    const token = crypto.randomUUID();
    try {
      await this.db
        .prepare("INSERT INTO locks(id,token) VALUES(?,?)")
        .bind(safeKey(key), token)
        .run();
    } catch {
      throw new StorageLockBusy(key);
    }
    try {
      return await work();
    } finally {
      await this.db
        .prepare("DELETE FROM locks WHERE id=? AND token=?")
        .bind(key, token)
        .run();
    }
  }
  async putBlob(key: string, bytes: Uint8Array, mime: string) {
    await this.bucket.put(safeKey(key), bytes, {
      httpMetadata: { contentType: mime },
    });
  }
  async deleteBlob(key: string) {
    await this.bucket.delete(safeKey(key));
  }
  async getBlob(key: string) {
    const object = await this.bucket.get(safeKey(key));
    return object
      ? {
          bytes: new Uint8Array(await object.arrayBuffer()),
          mime: object.httpMetadata?.contentType ?? "application/octet-stream",
        }
      : undefined;
  }
}
