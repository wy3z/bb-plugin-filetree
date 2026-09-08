import { describe, expect, it } from "vitest";
import { normalizedMimeType, routePreview } from "./preview-router.js";
describe("preview routing", () => {
  it.each([
    ["readme.md", null, "markdown"],
    ["page.HTML", "application/octet-stream", "html"],
    ["scan.pdf", "application/octet-stream", "pdf"],
    ["photo.bin", "image/png", "image"],
    ["letter.docx", "application/zip", "docx"],
    ["book.xlsx", "application/zip", "xlsx"],
    ["slides.pptx", "application/zip", "pptx"],
    ["main.ts", "application/octet-stream", "source"],
    ["archive.bin", "application/octet-stream", "unsupported"],
  ] as const)("routes %s to %s", (path, mime, expected) => {
    expect(routePreview(path, mime).kind).toBe(expected);
  });
  it("rejects malformed server content types", () => {
    expect(normalizedMimeType("text/html\r\nx-bad: yes")).toBe(
      "application/octet-stream",
    );
  });
});
