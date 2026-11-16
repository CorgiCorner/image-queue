import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ exec: vi.fn(), end: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mock.exec }));
import {
  localCredential,
  saveLocalCredential,
  removeLocalCredential,
} from "../src/storage/credentials";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("IMAGE_QUEUE_CREDENTIALS_DIR", "");
  mock.exec.mockImplementation((_file, args, _options, callback) => {
    callback(null, args[0] === "find-generic-password" ? "test-value\n" : "");
    return { stdin: { end: mock.end } };
  });
});
it.skipIf(process.platform !== "darwin")(
  "sends keychain secrets through stdin and verifies the saved value",
  async () => {
    await saveLocalCredential("openai", "test-value");
    expect(mock.exec.mock.calls[0][1]).toEqual(["-i"]);
    expect(
      JSON.stringify(mock.exec.mock.calls.map((call) => call.slice(0, 3))),
    ).not.toContain("test-value");
    expect(mock.end).toHaveBeenCalledWith(
      expect.stringContaining('"test-value"'),
    );
    expect(await localCredential("openai")).toBe("test-value");
    await removeLocalCredential("openai");
  },
);
it.skipIf(process.platform !== "darwin")(
  "rejects keychain failures and recognizes a missing item",
  async () => {
    mock.exec.mockImplementation((_file, _args, _options, callback) => {
      callback({ code: 44 }, "");
      return { stdin: { end: mock.end } };
    });
    expect(await localCredential("openai")).toBeUndefined();
    await removeLocalCredential("openai");
    mock.exec.mockImplementation((_file, _args, _options, callback) => {
      callback({ code: 1 }, "");
      return { stdin: { end: mock.end } };
    });
    await expect(saveLocalCredential("openai", "test-value")).rejects.toThrow(
      "Credential store",
    );
  },
);
it.skipIf(process.platform !== "darwin")(
  "propagates read and delete failures",
  async () => {
    mock.exec.mockImplementation((_file, _args, _options, callback) => {
      callback({ code: 1 }, "");
      return { stdin: { end: mock.end } };
    });
    await expect(localCredential("openai")).rejects.toThrow("Credential store");
    await expect(removeLocalCredential("openai")).rejects.toThrow(
      "Credential store",
    );
  },
);
it.skipIf(process.platform !== "darwin")(
  "rejects a keychain save that did not persist",
  async () => {
    await expect(
      saveLocalCredential("openai", "different-value"),
    ).rejects.toThrow("did not confirm");
  },
);
