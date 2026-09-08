import { describe, expect, it } from "vitest";
import {
  OFFICE_ZIP_MAX_COMPRESSION_RATIO,
  OFFICE_ZIP_MAX_ENTRY_BYTES,
  ZipPreflightError,
  preflightOfficeZip,
} from "./zip-preflight.js";
function centralArchive(
  options: {
    name?: string;
    flags?: number;
    compressed?: number;
    uncompressed?: number;
    extra?: Uint8Array;
    disk?: number;
  } = {},
): ArrayBuffer {
  const name = new TextEncoder().encode(options.name ?? "word/document.xml");
  const extra = options.extra ?? new Uint8Array();
  const centralSize = 46 + name.byteLength + extra.byteLength;
  const bytes = new Uint8Array(centralSize + 22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(8, options.flags ?? 0, true);
  view.setUint32(20, options.compressed ?? 1, true);
  view.setUint32(24, options.uncompressed ?? 1, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint16(30, extra.byteLength, true);
  view.setUint16(34, options.disk ?? 0, true);
  bytes.set(name, 46);
  bytes.set(extra, 46 + name.byteLength);
  const eocd = centralSize;
  view.setUint32(eocd, 0x06054b50, true);
  view.setUint16(eocd + 8, 1, true);
  view.setUint16(eocd + 10, 1, true);
  view.setUint32(eocd + 12, centralSize, true);
  view.setUint32(eocd + 16, 0, true);
  return bytes.buffer;
}
describe("Office ZIP preflight", () => {
  it("accepts a bounded single-disk archive directory", () => {
    expect(preflightOfficeZip(centralArchive())).toEqual({
      entryCount: 1,
      expandedBytes: 1,
    });
  });
  it.each([
    [{ name: "../secret.xml" }, "unsafe entry path"],
    [{ name: "/absolute.xml" }, "unsafe entry path"],
    [{ flags: 1 }, "Encrypted"],
    [{ disk: 1 }, "central directory"],
    [
      { compressed: 1, uncompressed: OFFICE_ZIP_MAX_ENTRY_BYTES + 1 },
      "too large",
    ],
    [
      { compressed: 1, uncompressed: OFFICE_ZIP_MAX_COMPRESSION_RATIO + 1 },
      "compression ratio",
    ],
    [{ extra: new Uint8Array([1, 0, 0, 0]) }, "ZIP64"],
  ] as const)("rejects hostile archives", (options, message) => {
    expect(() => preflightOfficeZip(centralArchive(options))).toThrow(message);
  });
  it("rejects malformed end records", () => {
    expect(() => preflightOfficeZip(new ArrayBuffer(22))).toThrow(
      ZipPreflightError,
    );
  });
});
