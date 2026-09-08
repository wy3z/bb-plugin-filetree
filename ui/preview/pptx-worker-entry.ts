import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import { preflightOfficeZip } from "./zip-preflight.js";
class WorkerDomParser {
  parseFromString(source: string, mimeType: string): object {
    const document = new XmlDomParser().parseFromString(source, mimeType);
    Reflect.set(document, "querySelector", () => null);
    return document;
  }
}
Reflect.set(globalThis, "DOMParser", WorkerDomParser);
function bytesToBase64(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes);
  const chunks: string[] = [];
  const chunkSize = 32768;
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...values.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(""));
}
async function materializeBlobUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("A PPTX resource could not be decoded.");
  const mimeType =
    response.headers.get("content-type") ?? "application/octet-stream";
  return `data:${mimeType};base64,${bytesToBase64(await response.arrayBuffer())}`;
}
async function materializeBlobUrls(
  value: unknown,
  cache: Map<string, Promise<string>>,
  seen: WeakMap<object, object>,
): Promise<unknown> {
  if (typeof value === "string" && value.startsWith("blob:")) {
    let materialized = cache.get(value);
    if (materialized === undefined) {
      materialized = materializeBlobUrl(value);
      cache.set(value, materialized);
    }
    return materialized;
  }
  if (typeof value !== "object" || value === null) return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (value instanceof Map) {
    const mapped = new Map<unknown, unknown>();
    seen.set(value, mapped);
    for (const [key, entry] of value) {
      mapped.set(
        await materializeBlobUrls(key, cache, seen),
        await materializeBlobUrls(entry, cache, seen),
      );
    }
    return mapped;
  }
  if (Array.isArray(value)) {
    const mapped: unknown[] = [];
    seen.set(value, mapped);
    for (const entry of value) {
      mapped.push(await materializeBlobUrls(entry, cache, seen));
    }
    return mapped;
  }
  const mapped: Record<string, unknown> = {};
  seen.set(value, mapped);
  for (const [key, entry] of Object.entries(value)) {
    mapped[key] = await materializeBlobUrls(entry, cache, seen);
  }
  return mapped;
}
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const bytes =
    typeof event.data === "object" && event.data !== null
      ? Reflect.get(event.data, "bytes")
      : null;
  if (!(bytes instanceof ArrayBuffer)) {
    self.postMessage({ error: "The PPTX worker received invalid input." });
    return;
  }
  void (async () => {
    preflightOfficeZip(bytes);
    const { extractPPTX, parsePPTX } = await import("pptx-viewer");
    const archive = await extractPPTX(bytes);
    const blobUrls = new Map<string, Promise<string>>();
    try {
      const presentation = await parsePPTX(archive);
      return await materializeBlobUrls(presentation, blobUrls, new WeakMap());
    } finally {
      archive.cleanup();
      for (const url of blobUrls.keys()) URL.revokeObjectURL(url);
    }
  })().then(
    (result) => self.postMessage(result),
    (error: unknown) =>
      self.postMessage({
        error:
          error instanceof Error ? error.message : "PPTX conversion failed.",
      }),
  );
});
