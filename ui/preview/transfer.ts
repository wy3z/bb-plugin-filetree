import type { NativeFileTransferResponse } from "../../contracts/api";
import type { NativeFilesData } from "../native-files-data";
import { normalizedMimeType } from "./preview-router";
export const NATIVE_FILES_BINARY_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const NATIVE_FILES_IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
export interface TransferPayload {
  bytes: ArrayBuffer;
  mimeType: string;
  transfer: NativeFileTransferResponse;
}
export class NativeFileTransferError extends Error {
  constructor(
    readonly code:
      | "expired"
      | "not-found"
      | "stale-root"
      | "stale-selection"
      | "too-large"
      | "transfer-failed",
    message: string,
  ) {
    super(message);
    this.name = "NativeFileTransferError";
  }
}
export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  if (!response.ok) {
    throw new NativeFileTransferError(
      response.status === 404
        ? "not-found"
        : response.status === 410
          ? "expired"
          : "transfer-failed",
      response.status === 404
        ? "The selected file is no longer available."
        : response.status === 410
          ? "The file transfer expired."
          : `File transfer failed (${response.status}).`,
    );
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new NativeFileTransferError(
      "too-large",
      "The file exceeds the preview transfer limit.",
    );
  }
  if (response.body === null) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new NativeFileTransferError(
        "too-large",
        "The file exceeds the preview transfer limit.",
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new NativeFileTransferError(
          "too-large",
          "The file exceeds the preview transfer limit.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
export async function fetchTransferPayload(options: {
  data: NativeFilesData;
  fetcher?: typeof fetch;
  maxBytes?: number;
  path: string;
  rootId: string;
  signal: AbortSignal;
  threadId: string;
}): Promise<TransferPayload> {
  const transfer = await options.data.createTransfer({
    path: options.path,
    rootId: options.rootId,
    signal: options.signal,
    threadId: options.threadId,
  });
  if (transfer.rootId !== options.rootId || transfer.path !== options.path) {
    throw new NativeFileTransferError(
      "stale-selection",
      "The file selection changed before transfer began.",
    );
  }
  if (transfer.expiresAtMs <= Date.now()) {
    throw new NativeFileTransferError(
      "expired",
      "The file transfer expired before it could be used.",
    );
  }
  const response = await (options.fetcher ?? fetch)(transfer.contentUrl, {
    credentials: "same-origin",
    signal: options.signal,
  });
  const bytes = await readBoundedResponse(
    response,
    options.maxBytes ?? NATIVE_FILES_BINARY_PREVIEW_MAX_BYTES,
    options.signal,
  );
  return {
    bytes,
    mimeType: normalizedMimeType(
      response.headers.get("content-type") ?? transfer.mimeType,
    ),
    transfer,
  };
}
export function decodeUtf8(bytes: ArrayBuffer): string {
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (content.includes("\0"))
    throw new Error(
      "This file contains binary data and cannot be shown as source.",
    );
  return content;
}
