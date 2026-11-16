import { UserFacingError } from "../core/user-facing-error";
import { z } from "zod";
import { idSchema } from "../core/schema";
import { hash } from "../core/schema";
import { recordProject } from "./project-record";
import { safeKey, type Storage } from "./types";

const projectCollections = new Set([
  "projects", "jobs", "references", "topics", "notes", "asset-meta",
  "stack-counters", "correction-intents", "prepared-corrections",
]);

/** Workspace records stay central; registered projects own their records. */
export class ProjectStorage implements Storage {
  constructor(
    readonly workspace: Storage,
    readonly projects: ReadonlyMap<string, Storage>,
    readonly createProject?: (project: import("../core/schema").Project) => Promise<import("../core/schema").Project>,
    private readonly refreshProjects?: () => Promise<void>,
    private readonly coordinate?: <T>(work: () => Promise<T>) => Promise<T>,
    readonly moveProject?: (id: string, directory: string) => Promise<import("../core/schema").Project>,
  ) {}
  private stores() { return [this.workspace, ...this.projects.values()]; }
  private routedStore(route: unknown) {
    if (!route) return undefined;
    const parsed = z.object({ projectId: idSchema.nullable() }).parse(route);
    if (parsed.projectId === null) return this.workspace;
    const store = this.projects.get(parsed.projectId);
    if (!store) throw new UserFacingError("Project storage is unavailable");
    return store;
  }
  async entries<T>(collection: string) {
    safeKey(collection);
    if (!projectCollections.has(collection)) return this.workspace.entries<T>(collection);
    await this.refreshProjects?.();
    const snapshots = new Map<Storage, Map<string, T>>();
    const ids = new Set<string>();
    for (const store of this.stores()) {
      const values = new Map((await store.entries<T>(collection)).map(entry => [entry.id, entry.value]));
      snapshots.set(store, values);
      for (const id of values.keys()) ids.add(id);
    }
    const entries: { id: string; value: T }[] = [];
    const markers = new Map<string, { deleted?: boolean } | undefined>();
    const orderedIds = [...ids];
    const batchSize = 32;
    for (let offset = 0; offset < orderedIds.length; offset += batchSize) {
      await Promise.all(orderedIds.slice(offset, offset + batchSize).map(async id => {
        const routeId = await hash(`${collection}/${id}`);
        markers.set(id, await this.workspace.get<{ deleted?: boolean }>("record-routes", routeId));
      }));
    }
    for (const id of orderedIds) {
      const marker = markers.get(id);
      if (marker && "deleted" in marker) {
        z.object({ deleted: z.literal(true) }).parse(marker);
        continue;
      }
      const routed = this.routedStore(marker);
      if (routed) {
        const value = snapshots.get(routed)?.get(id);
        if (value !== undefined) entries.push({ id, value });
        continue;
      }
      let value: T | undefined;
      for (const values of snapshots.values()) {
        const candidate = values.get(id);
        if (candidate === undefined) continue;
        if (value !== undefined && JSON.stringify(value) !== JSON.stringify(candidate))
          throw new Error(`Conflicting project record: ${collection}/${id}`);
        value = candidate;
      }
      if (value !== undefined) entries.push({ id, value });
    }
    return entries;
  }
  async list<T>(collection: string) {
    return (await this.entries<T>(collection)).map(entry => entry.value);
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    safeKey(collection);
    safeKey(id);
    if (projectCollections.has(collection)) await this.refreshProjects?.();
    return this.read<T>(collection, id);
  }
  private async read<T>(collection: string, id: string): Promise<T | undefined> {
    if (!projectCollections.has(collection)) return this.workspace.get<T>(collection, id);
    const marker = await this.workspace.get<{ deleted?: boolean }>("record-routes", await hash(`${collection}/${id}`));
    if (marker && "deleted" in marker) {
      z.object({ deleted: z.literal(true) }).parse(marker);
      return undefined;
    }
    const routed = this.routedStore(marker);
    if (routed) return routed.get<T>(collection, id);
    let found: T | undefined;
    for (const store of this.stores()) {
      const value = await store.get<T>(collection, id);
      if (value === undefined) continue;
      if (found !== undefined && JSON.stringify(found) !== JSON.stringify(value))
        throw new Error(`Conflicting project record: ${collection}/${id}`);
      found = value;
    }
    return found;
  }
  async recover() {
    const pending = await this.workspace.entries<unknown>("project-writes");
    if (!pending.length) return;
    const recover = async () => {
      for (const entry of pending) {
        const operation = z.object({ collection: z.string(), id: z.string(), value: z.unknown() }).parse(entry.value);
        safeKey(operation.collection);
        safeKey(operation.id);
        if (!projectCollections.has(operation.collection) || entry.id !== await hash(`${operation.collection}/${operation.id}`))
          throw new UserFacingError("Invalid pending project operation");
        await this.write(operation.collection, operation.id, operation.value, JSON.stringify(entry.value));
      }
    };
    // A journal may belong to a live writer. Share its mutation boundary before replay.
    return this.coordinate ? this.coordinate(recover) : recover();
  }
  put<T>(collection: string, id: string, value: T) {
    return this.coordinate ? this.coordinate(() => this.write(collection, id, value)) : this.write(collection, id, value);
  }
  private async write<T>(collection: string, id: string, value: T, expectedOperation?: string) {
    safeKey(collection);
    safeKey(id);
    if (!projectCollections.has(collection)) return this.workspace.put(collection, id, value);
    await this.refreshProjects?.();
    return this.workspace.lock(`record-write-${await hash(`${collection}/${id}`)}`, async () => {
      if (expectedOperation !== undefined) {
        const marker = await this.workspace.get<{ deleted?: boolean }>("record-routes", await hash(`${collection}/${id}`));
        if (marker?.deleted === true) {
          await this.workspace.delete("project-writes", await hash(`${collection}/${id}`));
          return;
        }
        const current = await this.workspace.get("project-writes", await hash(`${collection}/${id}`));
        if (JSON.stringify(current) !== expectedOperation) return;
      }
      const projectId = await recordProject(this, collection, id, value);
      const target = projectId ? this.projects.get(projectId) ?? this.workspace : this.workspace;
      if (target !== this.workspace && value && typeof value === "object") {
        const record = value as { blobKey?: string; thumbnailKey?: string };
        for (const key of [record.blobKey, record.thumbnailKey]) {
          if (!key) continue;
          const blob = await this.getBlob(key);
          if (!blob) throw new UserFacingError("Project file is unavailable");
          await target.putBlob(key, blob.bytes, blob.mime);
          const copied = await target.getBlob(key);
          if (!copied || copied.mime !== blob.mime || await hash(copied.bytes) !== await hash(blob.bytes))
            throw new UserFacingError("Project file verification failed");
        }
      }
      const operationId = await hash(`${collection}/${id}`);
      await this.workspace.put("project-writes", operationId, { collection, id, value });
      await target.put(collection, id, value);
      const saved = await target.get(collection, id);
      if (JSON.stringify(saved) !== JSON.stringify(value)) throw new UserFacingError("Project record verification failed");
      await this.workspace.put("record-routes", await hash(`${collection}/${id}`), { projectId: target === this.workspace ? null : projectId });
      for (const store of this.stores()) {
        if (store !== target) await store.delete(collection, id);
      }
      if (collection === "jobs") {
        for (const related of ["notes", "correction-intents", "prepared-corrections"] as const) {
          for (const entry of await this.entries<{ imageId?: string }>(related)) {
            if (entry.value.imageId === id) await this.put(related, entry.id, entry.value);
          }
        }
        const metadata = await this.get("asset-meta", id);
        if (metadata !== undefined) await this.put("asset-meta", id, metadata);
      }
      if (value && typeof value === "object") {
        const record = value as { blobKey?: string; thumbnailKey?: string };
        for (const key of new Set([record.blobKey, record.thumbnailKey])) {
          if (!key) continue;
          const saved = await target.getBlob(key);
          if (!saved) continue;
          for (const previous of this.stores()) {
            if (previous === target) continue;
            const copy = await previous.getBlob(key);
            if (!copy) continue;
            const owners = await Promise.all(["jobs", "references"].map(name =>
              previous.list<{ blobKey?: string; thumbnailKey?: string }>(name),
            ));
            if (owners.flat().some(owner => owner.blobKey === key || owner.thumbnailKey === key)) continue;
            if (saved.mime !== copy.mime || await hash(saved.bytes) !== await hash(copy.bytes)) continue;
            await previous.deleteBlob(key);
          }
        }
      }
      await this.workspace.delete("project-writes", operationId);
    });
  }

  async delete(collection: string, id: string) {
    return this.coordinate ? this.coordinate(() => this.deleteRecord(collection, id)) : this.deleteRecord(collection, id);
  }
  private async deleteRecord(collection: string, id: string) {
    safeKey(collection);
    safeKey(id);
    if (!projectCollections.has(collection)) return this.workspace.delete(collection, id);
    await this.refreshProjects?.();
    return this.workspace.lock(`record-write-${await hash(`${collection}/${id}`)}`, async () => {
      await this.workspace.put("record-routes", await hash(`${collection}/${id}`), { deleted: true });
      for (const store of this.stores()) await store.delete(collection, id);
      await this.workspace.delete("project-writes", await hash(`${collection}/${id}`));
    });
  }
  lock<T>(key: string, work: () => Promise<T>) { return this.workspace.lock(key, work); }
  async putBlob(key: string, bytes: Uint8Array, mime: string) {
    return this.coordinate ? this.coordinate(() => this.writeBlob(key, bytes, mime)) : this.writeBlob(key, bytes, mime);
  }
  private async writeBlob(key: string, bytes: Uint8Array, mime: string) {
    safeKey(key);
    await this.refreshProjects?.();
    const owners = new Set<string>();
    for (const collection of ["jobs", "references"] as const) {
      for (const record of await this.list<{ projectId?: string; blobKey?: string; thumbnailKey?: string }>(collection)) {
        if (record.projectId && (record.blobKey === key || record.thumbnailKey === key)) owners.add(record.projectId);
      }
    }
    if (key.startsWith("thumbs/")) {
      for (const entry of await this.entries<{ hash?: string }>("asset-meta")) {
        if (entry.value.hash && key.startsWith(`thumbs/${entry.value.hash}/`)) {
          const projectId = await recordProject(this, "asset-meta", entry.id, entry.value);
          if (projectId) owners.add(projectId);
        }
      }
    }
    const targets = new Set([...owners].map(id => this.projects.get(id) ?? this.workspace));
    if (!targets.size) targets.add(this.workspace);
    const digest = await hash(bytes);
    for (const target of targets) {
      await target.putBlob(key, bytes, mime);
      const saved = await target.getBlob(key);
      if (!saved || saved.mime !== mime || await hash(saved.bytes) !== digest)
        throw new UserFacingError("Project file verification failed");
    }
  }
  async getBlob(key: string) {
    await this.refreshProjects?.();
    let found: Awaited<ReturnType<Storage["getBlob"]>>;
    for (const store of this.stores()) {
      const blob = await store.getBlob(key);
      if (!blob) continue;
      if (found && (found.mime !== blob.mime || await hash(found.bytes) !== await hash(blob.bytes)))
        throw new UserFacingError("Conflicting project file");
      found = blob;
    }
    return found;
  }
  async deleteBlob(key: string) {
    return this.coordinate ? this.coordinate(() => this.removeBlob(key)) : this.removeBlob(key);
  }
  private async removeBlob(key: string) {
    await this.refreshProjects?.();
    for (const store of this.stores()) await store.deleteBlob(key);
  }
}
