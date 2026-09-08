export const OFFICE_ZIP_MAX_ENTRIES = 4096;
export const OFFICE_ZIP_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const OFFICE_ZIP_MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
export const OFFICE_ZIP_MAX_COMPRESSION_RATIO = 200;
export interface ZipPreflightResult {
  entryCount: number;
  expandedBytes: number;
}
export class ZipPreflightError extends Error {}
const eocdSignature = 0x06054b50;
const centralSignature = 0x02014b50;
const zip64ExtraId = 0x0001;
function findEocd(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === eocdSignature) return offset;
  }
  throw new ZipPreflightError("The document is not a valid ZIP archive.");
}
function decodeName(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ZipPreflightError("The archive contains an invalid entry name.");
  }
}
function validateName(name: string): void {
  const normalized = name.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    name.length === 0 ||
    name.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-z]:\//iu.test(normalized) ||
    parts.includes("..")
  ) {
    throw new ZipPreflightError("The archive contains an unsafe entry path.");
  }
}
function rejectZip64Extra(
  view: DataView,
  offset: number,
  length: number,
): void {
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) {
      throw new ZipPreflightError("The archive contains malformed extra data.");
    }
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (cursor + size > end) {
      throw new ZipPreflightError("The archive contains malformed extra data.");
    }
    if (id === zip64ExtraId) {
      throw new ZipPreflightError("ZIP64 Office documents are not supported.");
    }
    cursor += size;
  }
}
export function preflightOfficeZip(buffer: ArrayBuffer): ZipPreflightResult {
  const view = new DataView(buffer);
  if (view.byteLength < 22) {
    throw new ZipPreflightError("The document is not a valid ZIP archive.");
  }
  const eocd = findEocd(view);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength !== view.byteLength) {
    throw new ZipPreflightError("The ZIP end record is malformed.");
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw new ZipPreflightError(
      "Multi-disk Office documents are not supported.",
    );
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ZipPreflightError("ZIP64 Office documents are not supported.");
  }
  if (entryCount > OFFICE_ZIP_MAX_ENTRIES) {
    throw new ZipPreflightError(
      "The document contains too many archive entries.",
    );
  }
  if (centralOffset + centralSize !== eocd || centralOffset > eocd) {
    throw new ZipPreflightError("The ZIP central directory is malformed.");
  }
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > eocd ||
      view.getUint32(cursor, true) !== centralSignature
    ) {
      throw new ZipPreflightError("The ZIP central directory is malformed.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const uncompressedBytes = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const startDisk = view.getUint16(cursor + 34, true);
    const recordEnd =
      cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (recordEnd > eocd || startDisk !== 0) {
      throw new ZipPreflightError("The ZIP central directory is malformed.");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new ZipPreflightError(
        "Encrypted Office documents are not supported.",
      );
    }
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      throw new ZipPreflightError("ZIP64 Office documents are not supported.");
    }
    const nameOffset = cursor + 46;
    validateName(decodeName(new Uint8Array(buffer, nameOffset, nameLength)));
    rejectZip64Extra(view, nameOffset + nameLength, extraLength);
    if (uncompressedBytes > OFFICE_ZIP_MAX_ENTRY_BYTES) {
      throw new ZipPreflightError(
        "An Office document entry is too large to preview.",
      );
    }
    expandedBytes += uncompressedBytes;
    if (expandedBytes > OFFICE_ZIP_MAX_EXPANDED_BYTES) {
      throw new ZipPreflightError(
        "The Office document expands beyond the preview limit.",
      );
    }
    if (
      uncompressedBytes > 0 &&
      (compressedBytes === 0 ||
        uncompressedBytes / compressedBytes > OFFICE_ZIP_MAX_COMPRESSION_RATIO)
    ) {
      throw new ZipPreflightError(
        "The Office document has an unsafe compression ratio.",
      );
    }
    cursor = recordEnd;
  }
  if (cursor !== eocd) {
    throw new ZipPreflightError(
      "The ZIP central directory entry count is inconsistent.",
    );
  }
  return { entryCount, expandedBytes };
}
