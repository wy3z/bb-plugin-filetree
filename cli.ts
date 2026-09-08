import { randomUUID } from "node:crypto";
import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contracts/rpc.js";
import type { FilesService } from "./backend/service.js";
const usage =
  "bb files <roots|list|search|git|read|download> [path-or-query] [--thread ID] [--root ID]";
export function registerFilesCli(bb: BbPluginApi, files: FilesService) {
  bb.cli.register({
    name: "files",
    summary:
      "Read workspace files, search paths, inspect Git status, and prepare downloads",
    commands: [
      {
        name: "roots",
        summary: "List authorized workspace and project roots",
        usage: "roots [--thread ID]",
      },
      {
        name: "list",
        summary: "List a directory",
        usage: "list [path] [--thread ID] [--root ID]",
      },
      {
        name: "search",
        summary: "Search relative file paths",
        usage: "search <query> [--thread ID] [--root ID]",
      },
      {
        name: "git",
        summary: "Read Git status",
        usage: "git [--thread ID] [--root ID]",
      },
      {
        name: "read",
        summary: "Read UTF-8 text up to 128 KiB",
        usage: "read <path> [--thread ID] [--root ID]",
      },
      {
        name: "download",
        summary: "Prepare a verified download valid for five minutes",
        usage: "download <path> [--thread ID] [--root ID]",
      },
    ],
    run: async (argv, context) => {
      try {
        let threadId = context.threadId;
        let rootId: string | undefined;
        const args: string[] = [];
        for (let index = 0; index < argv.length; index++) {
          const arg = argv[index];
          if (arg === "--thread" || arg === "--root") {
            const value = argv[++index];
            if (!value || value.startsWith("--"))
              throw new Error(`${arg} requires a value`);
            if (arg === "--thread") threadId = value;
            else rootId = value;
          } else if (arg.startsWith("--") && arg !== "--help")
            throw new Error(`Unknown option ${arg}`);
          else args.push(arg);
        }
        const command = args.shift() ?? "--help";
        if (command === "--help") return { exitCode: 0, stdout: usage + "\n" };
        if (!threadId)
          throw new Error("Pass --thread ID or run from a BB thread");
        if (args.length > 1)
          throw new Error("Quote paths or queries containing spaces");
        const roots = await files.roots(threadId);
        let value: JsonValue;
        if (command === "roots") value = roots;
        else {
          if (roots.kind !== "ready") throw new Error(roots.reason);
          rootId ??= roots.activeRootId;
          const root = { threadId, rootId };
          if (command === "list")
            value = await files.directory(
              rpcContract.directory.input.parse({
                ...root,
                path: args[0] ?? "",
              }),
            );
          else if (command === "search")
            value = await files.search(
              rpcContract.search.input.parse({
                ...root,
                query: args[0],
                limit: 200,
                operationId: randomUUID(),
              }),
            );
          else if (command === "git")
            value = await files.gitStatus(
              rpcContract.gitStatus.input.parse({
                ...root,
                operationId: randomUUID(),
              }),
            );
          else if (command === "download" || command === "read") {
            const transfer = await files.transfer(
              rpcContract.transfer.input.parse({
                ...root,
                path: args[0],
                operationId: randomUUID(),
              }),
            );
            if (command === "download") value = transfer;
            else {
              if (transfer.sizeBytes > 128 * 1024)
                throw new Error("Text exceeds 128 KiB; use download");
              const id = new URL(
                transfer.contentUrl,
                "http://localhost",
              ).searchParams.get("id");
              const download = files.download(id ?? "");
              if (!download) throw new Error("Transfer expired");
              const text = new TextDecoder("utf-8", { fatal: true }).decode(
                download.bytes,
              );
              if (text.includes("\0"))
                throw new Error("Binary file; use download");
              value = { path: args[0], content: text, sha256: transfer.sha256 };
            }
          } else throw new Error(usage);
        }
        const stdout = JSON.stringify(value, null, 2) + "\n";
        if (Buffer.byteLength(stdout) > 1000000)
          throw new Error(
            "Result exceeds the CLI output limit; narrow the query",
          );
        return { exitCode: 0, stdout };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
}
