import { expect, it } from "vitest";
import config from "../next.config";

it("does not log server function arguments containing credentials", () => {
  expect(config.logging).not.toBe(false);
  expect(config.logging && config.logging.serverFunctions).toBe(false);
});
