import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { z } from "zod";
import { hostContract, hostSignals } from "../contracts/host.js";
import { nativeFileRootsResponseSchema } from "../contracts/api.js";
import { createFilesHostEntry } from "../host.js";
import plugin from "../server.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "files-plugin-test-"));
  const workspace = join(directory, "workspace");
  const workerTemp = join(directory, "worker");
  await mkdir(workspace);
  await mkdir(workerTemp);
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const worker = experimental_createHostEntryHarness(createFilesHostEntry(), {
    experimental_paths: { dataDir: directory, tempDir: workerTemp },
  });
  cleanups.push(() => worker.experimental_dispose());
  let currentPath = workspace;
  const read = vi.fn(
    async (input: Parameters<BbPluginApi["sdk"]["files"]["read"]>[0]) => {
      input.signal?.throwIfAborted();
      const bytes = await readFile(input.path);
      return {
        content: bytes.toString("base64"),
        contentEncoding: "base64" as const,
        path: input.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.length,
        mimeType: "application/octet-stream",
        modifiedAtMs: (await stat(input.path)).mtimeMs,
      };
    },
  );
  const backend = createFakePluginHost({
    pluginId: "files",
    sdk: {
      files: { read },
      threads: {
        get: async () => ({
          id: "thread-1",
          projectId: "project-1",
          environmentId: "env-1",
        }),
      },
      environments: {
        get: async () => ({
          id: "env-1",
          projectId: "project-1",
          hostId: "host-1",
          name: "Workspace",
          path: currentPath,
          status: "ready",
          isGitRepo: false,
        }),
      },
      projects: {
        get: async () => ({
          id: "project-1",
          name: "Project",
          sources: [
            {
              id: "source-1",
              hostId: "host-1",
              path: workspace,
              isDefault: true,
            },
          ],
        }),
      },
    },
    experimental_callHostRpc: async ({ method, input, signal }) => {
      switch (method) {
        case "directory":
          return worker.experimental_call(
            method,
            hostContract.directory.input.parse(input),
            { signal },
          );
        case "search":
          return worker.experimental_call(
            method,
            hostContract.search.input.parse(input),
            { signal },
          );
        case "gitStatus":
          return worker.experimental_call(
            method,
            hostContract.gitStatus.input.parse(input),
            { signal },
          );
        default:
          throw new Error(`Unexpected method ${method}`);
      }
    },
  });
  cleanups.push(() => backend.harness.dispose());
  plugin(backend.bb);
  const roots = nativeFileRootsResponseSchema.parse(
    await backend.harness.callRpc("roots", { threadId: "thread-1" }),
  );
  if (roots.kind !== "ready") throw new Error("Fixture root missing");
  return {
    ...backend,
    read,
    worker,
    workspace,
    rootId: roots.activeRootId,
    roots,
    moveRoot: () => {
      currentPath = join(directory, "moved");
    },
  };
}
describe("Files plugin server and host", () => {
  it("deduplicates the workspace source and rejects caller-supplied host paths", async () => {
    const test = await setup();
    expect(test.roots.roots).toHaveLength(1);
    await expect(
      test.harness.callRpc("directory", {
        threadId: "thread-1",
        rootId: test.rootId,
        path: "",
        rootPath: "/",
      }),
    ).rejects.toThrow();
    await expect(
      test.harness.callRpc("directory", {
        threadId: "thread-1",
        rootId: test.rootId,
        path: "../",
      }),
    ).rejects.toThrow();
    expect(test.harness.inspection.experimental_hostRpcCalls).toHaveLength(0);
  });
  it("lists and searches through the host and refuses stale root identities", async () => {
    const test = await setup();
    await writeFile(join(test.workspace, "hello.txt"), "Hello");
    expect(
      await test.harness.callRpc("directory", {
        threadId: "thread-1",
        rootId: test.rootId,
        path: "",
      }),
    ).toMatchObject({ entries: [{ name: "hello.txt", kind: "file" }] });
    expect(
      await test.harness.callRpc("search", {
        threadId: "thread-1",
        rootId: test.rootId,
        query: "hello",
        limit: 20,
        operationId: "search-1",
      }),
    ).toMatchObject({ matches: [{ path: "hello.txt" }] });
    test.moveRoot();
    await expect(
      test.harness.callRpc("directory", {
        threadId: "thread-1",
        rootId: test.rootId,
        path: "",
      }),
    ).rejects.toThrow(/stale/);
  });
  it("downloads an immutable maximum-size file through SDK reads", async () => {
    const test = await setup();
    const bytes = Buffer.alloc(25 * 1024 * 1024, 0xff);
    await writeFile(join(test.workspace, "large.bin"), bytes);
    const transfer = z.object({ contentUrl: z.string() }).parse(
      await test.harness.callRpc("transfer", {
        threadId: "thread-1",
        rootId: test.rootId,
        path: "large.bin",
        operationId: "transfer-1",
      }),
    );
    await writeFile(join(test.workspace, "large.bin"), "changed");
    const url = new URL(transfer.contentUrl, "http://localhost");
    const response = await test.harness.fetchHttp(
      "GET",
      `/download${url.search}`,
    );
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(test.read).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "host-1",
        path: join(test.workspace, "large.bin"),
        rootPath: test.workspace,
      }),
    );
    expect(test.harness.inspection.experimental_hostRpcCalls).toHaveLength(0);
  });
  it("preserves a UTF-8 BOM and reuses an unchanged download snapshot", async () => {
    const test = await setup();
    const bytes = Buffer.from("\ufeffHello plugin", "utf8");
    await writeFile(join(test.workspace, "bom.txt"), bytes);
    const request = {
      threadId: "thread-1",
      rootId: test.rootId,
      path: "bom.txt",
      operationId: "transfer-bom",
    };
    const first = z
      .object({ contentUrl: z.string() })
      .parse(await test.harness.callRpc("transfer", request));
    const second = z
      .object({ contentUrl: z.string() })
      .parse(await test.harness.callRpc("transfer", request));
    expect(second.contentUrl).toBe(first.contentUrl);
    const url = new URL(first.contentUrl, "http://localhost");
    const response = await test.harness.fetchHttp(
      "GET",
      `/download${url.search}`,
    );
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("exports the same read-only behavior through the plugin CLI", async () => {
    const test = await setup();
    await writeFile(join(test.workspace, "hello.txt"), "Hello plugin");
    const registration = test.harness.inspection.registrations.cli;
    expect(registration).toBeDefined();
    const result = await registration?.run(["read", "hello.txt"], {
      threadId: "thread-1",
    });
    expect(result?.exitCode).toBe(0);
    expect(JSON.parse(result?.stdout ?? "null")).toMatchObject({
      content: "Hello plugin",
    });
  });
  it("rejects a changed root before publishing read bytes", async () => {
    const test = await setup();
    await writeFile(join(test.workspace, "file.txt"), "hello");
    const read = test.read.getMockImplementation()!;
    test.read.mockImplementationOnce(async (input) => {
      const result = await read(input);
      test.moveRoot();
      return result;
    });
    await expect(
      test.harness.callRpc("transfer", {
        threadId: "thread-1",
        rootId: test.rootId,
        path: "file.txt",
        operationId: "changed-root",
      }),
    ).rejects.toThrow(/stale/);
  });

  it("rejects corrupt SDK bytes and returns an expired download after its lease", async () => {
    const test = await setup();
    await writeFile(join(test.workspace, "file.txt"), "hello");
    const read = test.read.getMockImplementation()!;
    test.read.mockImplementationOnce(async (input) => ({
      ...(await read(input)),
      sha256: "0".repeat(64),
    }));
    const request = {
      threadId: "thread-1",
      rootId: test.rootId,
      path: "file.txt",
      operationId: "transfer-test",
    };
    await expect(test.harness.callRpc("transfer", request)).rejects.toThrow(
      /integrity/,
    );
    const transfer = z
      .object({ contentUrl: z.string(), expiresAtMs: z.number() })
      .parse(await test.harness.callRpc("transfer", request));
    vi.spyOn(Date, "now").mockReturnValue(transfer.expiresAtMs + 1);
    const response = await test.harness.fetchHttp(
      "GET",
      `/download${new URL(transfer.contentUrl, "http://localhost").search}`,
    );
    expect(response.status).toBe(410);
  });

  it("bounds concurrent SDK reads, aborts them, and frees reservations on failure", async () => {
    const test = await setup();
    await writeFile(join(test.workspace, "file.txt"), "hello");
    const read = test.read.getMockImplementation()!;
    test.read.mockImplementation(
      (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const requests = Array.from({ length: 4 }, (_, index) => ({
      threadId: "thread-1",
      rootId: test.rootId,
      path: "file.txt",
      operationId: `transfer-${index}`,
    }));
    const pending = requests.map((request) =>
      test.harness.callRpc("transfer", request).catch((error) => error),
    );
    await vi.waitFor(() => expect(test.read).toHaveBeenCalledTimes(4));
    await expect(
      test.harness.callRpc("transfer", {
        ...requests[0],
        operationId: "overflow",
      }),
    ).rejects.toThrow(/Too many/);
    for (const request of requests)
      await test.harness.callRpc("cancel", {
        threadId: request.threadId,
        rootId: request.rootId,
        operationId: request.operationId,
      });
    for (const result of await Promise.all(pending))
      expect(result).toBeInstanceOf(Error);
    test.read.mockImplementation(read);
    await expect(
      test.harness.callRpc("transfer", {
        ...requests[0],
        operationId: "retry",
      }),
    ).resolves.toMatchObject({ sizeBytes: 5 });
  });
});
