import { UserFacingError } from "../core/user-facing-error";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { configuration } from "../core/config";
import type { Provider } from "../core/schema";

function keychain(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/usr/bin/security",
      args,
      { encoding: "utf8" },
      (error, stdout) => {
        if (error)
          reject(
            Object.assign(new UserFacingError("Credential store operation failed"), {
              code: error.code,
            }),
          );
        else resolve(stdout.trim());
      },
    );
    if (input) child.stdin?.end(input);
  });
}
function useKeychain() {
  return process.platform === "darwin" && !configuration("CREDENTIALS_DIR");
}
function directory() {
  return (
    configuration("CREDENTIALS_DIR") ??
    path.join(homedir(), ".config", "image-queue", "credentials")
  );
}
export async function localCredential(
  provider: Provider,
): Promise<string | undefined> {
  if (useKeychain()) {
    try {
      return await keychain([
        "find-generic-password",
        "-s",
        "image-queue",
        "-a",
        provider,
        "-w",
      ]);
    } catch (error) {
      if ((error as { code: number }).code === 44) return undefined;
      throw error;
    }
  }
  try {
    return await readFile(path.join(directory(), `${provider}.key`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function saveLocalCredential(provider: Provider, value: string) {
  if (useKeychain()) {
    // Interactive stdin keeps the key out of command arguments and process listings.
    const quoted =
      '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
    await keychain(
      ["-i"],
      `add-generic-password -U -s image-queue -a ${provider} -w ${quoted}\n`,
    );
    if (await localCredential(provider) !== value) throw new UserFacingError("Credential store did not confirm the saved key");
    return;
  }
  const root = directory();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const target = path.join(root, `${provider}.key`);
  const temporary = `${target}.${crypto.randomUUID()}.partial`;
  await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}
export async function removeLocalCredential(provider: Provider) {
  if (useKeychain()) {
    try {
      await keychain([
        "delete-generic-password",
        "-s",
        "image-queue",
        "-a",
        provider,
      ]);
    } catch (error) {
      if ((error as { code: number }).code !== 44) throw error;
    }
    return;
  }
  await rm(path.join(directory(), `${provider}.key`), { force: true });
}
