import type { McpServer } from "@modelcontextprotocol/server";
import { publicErrorMessage } from "../core/user-facing-error";

/** Preserve SDK overloads and validation while protecting every registered handler. */
export function protectToolErrors(server: McpServer) {
  server.registerTool = new Proxy(server.registerTool, {
    apply(register, target, args) {
      const handler = args[args.length - 1];
      args[args.length - 1] = async (...input: unknown[]) => {
        try {
          return await Reflect.apply(handler, undefined, input);
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: publicErrorMessage(error) }] };
        }
      };
      return Reflect.apply(register, target, args);
    },
  });
  server.registerResource = new Proxy(server.registerResource, {
    apply(register, target, args) {
      const handler = args[args.length - 1];
      args[args.length - 1] = async (...input: unknown[]) => {
        try {
          return await Reflect.apply(handler, undefined, input);
        } catch (error) {
          throw new Error(publicErrorMessage(error));
        }
      };
      return Reflect.apply(register, target, args);
    },
  });
}
