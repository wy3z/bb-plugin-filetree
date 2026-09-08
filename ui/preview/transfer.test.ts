import { describe, expect, it, vi } from "vitest";
import type { NativeFilesData } from "../native-files-data";
import {
  fetchTransferPayload,
  NativeFileTransferError,
  readBoundedResponse,
} from "./transfer";
function dataWithTransfer(path = "src/app.ts"): NativeFilesData {
  return {
    listRoots: vi.fn(),
    listDirectory: vi.fn(),
    search: vi.fn(),
    gitStatus: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    createTransfer: vi.fn(async () => ({
      contentUrl: "/api/v1/native-file-transfers/token",
      expiresAtMs: Date.now() + 60000,
      filename: "app.ts",
      mimeType: "text/plain",
      modifiedAtMs: 1,
      path,
      rootId: "root-a",
      sha256: "a".repeat(64),
      sizeBytes: 3,
    })),
  };
}
describe("native file transfers", () => {
  it("rejects a transfer response for a different selected path", async () => {
    await expect(
      fetchTransferPayload({
        data: dataWithTransfer("outside.ts"),
        fetcher: vi.fn(),
        path: "src/app.ts",
        rootId: "root-a",
        signal: new AbortController().signal,
        threadId: "thread-a",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NativeFileTransferError>>({
        code: "stale-selection",
      }),
    );
  });
  it("rejects an oversized declared body without reading it", async () => {
    const response = new Response("outside", {
      headers: { "content-length": "500" },
      status: 200,
    });
    await expect(
      readBoundedResponse(response, 10, new AbortController().signal),
    ).rejects.toEqual(expect.objectContaining({ code: "too-large" }));
  });
});
