import { UserFacingError } from "../core/user-facing-error";
import {
  mkdir,
  open,
  lstat,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { StorageLockBusy, type Storage, safeKey } from "./types";
export class FileStorage implements Storage {
  private directories = new Set<string>();
  constructor(readonly root: string) {}
  private async location(key: string) {
    const target = path.resolve(this.root, safeKey(key));
    const directory = path.dirname(target);
    if (!this.directories.has(directory)) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const [root, parent] = await Promise.all([
        realpath(this.root),
        realpath(directory),
      ]);
      if (parent !== root && !parent.startsWith(root + path.sep))
        throw new UserFacingError("Storage path escapes root");
      this.directories.add(directory);
    }
    const [currentRoot, currentParent] = await Promise.all([
      realpath(this.root),
      realpath(directory),
    ]);
    if (
      currentParent !== currentRoot &&
      !currentParent.startsWith(currentRoot + path.sep)
    )
      throw new UserFacingError("Storage path escapes root");
    try {
      if ((await lstat(target)).isSymbolicLink())
        throw new UserFacingError("Storage path escapes root through a symbolic link");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return target;
  }
  async list<T>(collection: string): Promise<T[]> {
    return (await this.entries<T>(collection)).map(entry => entry.value);
  }
  async entries<T>(collection: string): Promise<{ id: string; value: T }[]> {
    const directory = path.dirname(await this.location(`${collection}/index`));
    const files = (await readdir(directory)).filter(file => file.endsWith(".json"));
    const entries: {id:string; value:T}[] = [];
    for(let offset=0;offset<files.length;offset+=32) {
      const batch=await Promise.all(files.slice(offset,offset+32).map(async file=>{
        const id=file.slice(0,-5);
        return {id,value:await this.get<T>(collection,id)};
      }));
      for(const {id,value} of batch)if(value!==undefined)entries.push({id,value});
    }
    return entries;
  }
  async get<T>(collection: string, id: string): Promise<T | undefined> {
    try {
      return JSON.parse(
        await readFile(await this.location(`${collection}/${id}.json`), "utf8"),
      ) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async put<T>(collection: string, id: string, value: T) {
    const target = await this.location(`${collection}/${id}.json`);
    const temporary = `${target}.${crypto.randomUUID()}.partial`;
    await writeFile(temporary, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, target);
  }
  async delete(collection: string, id: string) {
    await rm(await this.location(`${collection}/${id}.json`), { force: true });
  }
  async lock<T>(key: string, work: () => Promise<T>) {
    const legacy = await this.location(`locks/${safeKey(key)}.lock`);
    try {
      await lstat(legacy);
      // No ownership metadata exists in the old protocol. Never guess that
      // an older application's directory lock is abandoned.
      throw new StorageLockBusy(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // A permanent inode is required: unlinking a released lock lets another
    // process lock an old descriptor while a third locks its replacement.
    const file = await this.location(`locks/${safeKey(key)}.kernel`);
    const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_CREAT, 0o600);
    try {
      const { default: native } = await import("fs-native-extensions");
      if (!native.tryLock(handle.fd)) throw new StorageLockBusy(key);
      return await work();
    } finally {
      // Closing the descriptor releases the kernel lock, including on process
      // termination. Do not remove the file or directory.
      await handle.close();
    }
  }
  async putBlob(key: string, bytes: Uint8Array, mime: string) {
    const target = await this.location(`blobs/${key}`);
    const temp = `${target}.${crypto.randomUUID()}.partial`;
    await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
    await rename(temp, target);
    await this.put(
      "blob-meta",
      await import("../core/schema").then((m) => m.hash(key)),
      { mime },
    );
  }
  async deleteBlob(key: string) {
    await rm(await this.location(`blobs/${key}`), { force: true });
    await this.delete("blob-meta", await import("../core/schema").then(m => m.hash(key)));
  }
  async getBlob(key: string) {
    const meta = await this.get<{ mime: string }>(
      "blob-meta",
      await import("../core/schema").then((m) => m.hash(key)),
    );
    if (!meta) return undefined;
    try {
      return {
        bytes: new Uint8Array(
          await readFile(await this.location(`blobs/${key}`)),
        ),
        mime: meta.mime,
      };
    } catch (error) {
      // A disposable cache file may have been evicted independently of its metadata.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
