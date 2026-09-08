import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { hostContract, hostSignals } from "../contracts/host.js";
import {
  NATIVE_FILE_TRANSFER_MAX_BYTES,
  NATIVE_FILE_TRANSFER_TTL_MS,
} from "../contracts/model.js";
import type {
  NativeFileRoot,
  NativeFileTransferResponse,
} from "../contracts/api.js";
import {
  listAuthorizedNativeFileRoots,
  resolveAuthorizedNativeFileRoot,
} from "./roots.js";
type Host = ExperimentalHostClient<typeof hostContract, typeof hostSignals>;
type RootRequest = {
  threadId: string;
  rootId: string;
};
type FileRequest = RootRequest & {
  path: string;
};
const sdkFileSchema = z.object({
  content: z.string().max(Math.ceil(NATIVE_FILE_TRANSFER_MAX_BYTES / 3) * 4),
  contentEncoding: z.enum(["utf8", "base64"]),
  sizeBytes: z.number().int().nonnegative().max(NATIVE_FILE_TRANSFER_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  mimeType: z.string().min(1).max(500).default("application/octet-stream"),
  modifiedAtMs: z.number().nonnegative().nullable().default(null),
});
export class FilesService {
  private readonly operations = new Map<string, AbortController>();
  private readonly transfers = new Map<
    string,
    {
      bytes: Buffer;
      metadata: NativeFileTransferResponse;
    }
  >();
  private reservedBytes = 0;
  private transferBytes = 0;
  constructor(
    private readonly sdk: BbPluginApi["sdk"],
    private readonly host: Host,
    private readonly pluginId: string,
  ) {}
  roots(threadId: string) {
    return listAuthorizedNativeFileRoots(this.sdk, threadId);
  }
  private async authorized<T>(
    input: RootRequest,
    run: (root: NativeFileRoot) => Promise<T>,
  ): Promise<T> {
    const root = await resolveAuthorizedNativeFileRoot(
      this.sdk,
      input.threadId,
      input.rootId,
    );
    const value = await run(root);
    await resolveAuthorizedNativeFileRoot(
      this.sdk,
      input.threadId,
      input.rootId,
    );
    return value;
  }
  private async operation<T>(
    input: RootRequest & {
      operationId: string;
    },
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([
      input.threadId,
      input.rootId,
      input.operationId,
    ]);
    if (this.operations.has(key))
      throw new Error("This operation is already running");
    const controller = new AbortController();
    this.operations.set(key, controller);
    try {
      return await run(controller.signal);
    } finally {
      if (this.operations.get(key) === controller) this.operations.delete(key);
    }
  }
  cancel(
    input: RootRequest & {
      operationId: string;
    },
  ) {
    const controller = this.operations.get(
      JSON.stringify([input.threadId, input.rootId, input.operationId]),
    );
    controller?.abort();
    return { cancelled: controller !== undefined };
  }
  directory(input: FileRequest) {
    return this.authorized(input, async (root) => ({
      ...(await this.host.call(
        "directory",
        { rootPath: root.rootPath, path: input.path },
        { hostId: root.hostId },
      )),
      rootId: root.rootId,
      path: input.path,
    }));
  }
  search(
    input: RootRequest & {
      query: string;
      limit: number;
      operationId: string;
    },
  ) {
    return this.operation(input, (signal) =>
      this.authorized(input, async (root) => ({
        ...(await this.host.call(
          "search",
          { rootPath: root.rootPath, query: input.query, limit: input.limit },
          { hostId: root.hostId, signal },
        )),
        rootId: root.rootId,
      })),
    );
  }
  gitStatus(
    input: RootRequest & {
      operationId: string;
    },
  ) {
    return this.operation(input, (signal) =>
      this.authorized(input, async (root) => ({
        ...(await this.host.call(
          "gitStatus",
          { rootPath: root.rootPath },
          { hostId: root.hostId, signal },
        )),
        rootId: root.rootId,
      })),
    );
  }
  async watch(threadId: string) {
    const roots = await this.roots(threadId);
    if (roots.kind !== "ready") return { watching: false, rootIds: [] };
    const results = await Promise.allSettled(
      roots.roots.map((root) =>
        this.host.call(
          "watch",
          { rootPath: root.rootPath, threadId, rootId: root.rootId },
          { hostId: root.hostId },
        ),
      ),
    );
    return {
      watching: results.every((result) => result.status === "fulfilled"),
      rootIds: roots.roots.map((root) => root.rootId),
    };
  }
  private pruneTransfers() {
    for (const [id, value] of this.transfers) {
      if (value.metadata.expiresAtMs > Date.now()) continue;
      this.transferBytes -= value.bytes.length;
      this.transfers.delete(id);
    }
  }
  transfer(
    input: FileRequest & { operationId: string },
  ): Promise<NativeFileTransferResponse> {
    return this.operation(input, (signal) =>
      this.captureTransfer(input, signal),
    );
  }
  private async captureTransfer(
    input: FileRequest,
    signal: AbortSignal,
  ): Promise<NativeFileTransferResponse> {
    this.pruneTransfers();
    if (
      this.transferBytes + this.reservedBytes + NATIVE_FILE_TRANSFER_MAX_BYTES >
      100 * 1024 * 1024
    )
      throw new Error(
        "Too many file transfers; try again after existing transfers expire",
      );
    this.reservedBytes += NATIVE_FILE_TRANSFER_MAX_BYTES;
    try {
      const result = await this.authorized(input, async (root) => {
        signal.throwIfAborted();
        const snapshot = sdkFileSchema.parse(
          await this.sdk.files.read({
            hostId: root.hostId,
            path: path.posix.join(root.rootPath, input.path),
            rootPath: root.rootPath,
            signal,
          }),
        );
        signal.throwIfAborted();
        const bytes = Buffer.from(snapshot.content, snapshot.contentEncoding);
        if (
          bytes.length !== snapshot.sizeBytes ||
          createHash("sha256").update(bytes).digest("hex") !== snapshot.sha256
        )
          throw new Error("File snapshot integrity check failed");
        return { bytes, snapshot };
      });
      signal.throwIfAborted();
      for (const existing of this.transfers.values()) {
        if (
          existing.metadata.rootId === input.rootId &&
          existing.metadata.path === input.path &&
          existing.metadata.sha256 === result.snapshot.sha256 &&
          existing.metadata.expiresAtMs > Date.now()
        )
          return existing.metadata;
      }
      const id = randomUUID();
      const metadata: NativeFileTransferResponse = {
        contentUrl: `/api/v1/plugins/${encodeURIComponent(this.pluginId)}/http/download?id=${id}`,
        expiresAtMs: Date.now() + NATIVE_FILE_TRANSFER_TTL_MS,
        filename: path.posix.basename(input.path),
        mimeType: result.snapshot.mimeType,
        modifiedAtMs: result.snapshot.modifiedAtMs,
        path: input.path,
        rootId: input.rootId,
        sha256: result.snapshot.sha256,
        sizeBytes: result.bytes.length,
      };
      this.transfers.set(id, { bytes: result.bytes, metadata });
      this.transferBytes += result.bytes.length;
      return metadata;
    } finally {
      this.reservedBytes -= NATIVE_FILE_TRANSFER_MAX_BYTES;
    }
  }
  download(id: string) {
    this.pruneTransfers();
    return this.transfers.get(id) ?? null;
  }
  dispose() {
    for (const controller of this.operations.values()) controller.abort();
    this.operations.clear();
    this.transfers.clear();
    this.transferBytes = 0;
  }
}
