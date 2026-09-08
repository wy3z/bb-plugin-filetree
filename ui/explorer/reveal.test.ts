import { describe, expect, it, vi } from "vitest";
import { revealFile } from "./reveal.js";
describe("file reveal", () => {
  it("loads ancestors sequentially and expands only confirmed directories", async () => {
    const calls: string[] = [];
    const expanded: string[] = [];
    const result = await revealFile({
      path: "src/deep/file.ts",
      signal: new AbortController().signal,
      loadDirectory: async (path) => {
        calls.push(path);
        if (path === "")
          return {
            entries: [{ name: "src", path: "src", kind: "directory" }],
            truncated: false,
          };
        if (path === "src")
          return {
            entries: [{ name: "deep", path: "src/deep", kind: "directory" }],
            truncated: false,
          };
        return {
          entries: [
            { name: "file.ts", path: "src/deep/file.ts", kind: "file" },
          ],
          truncated: false,
        };
      },
      expand: (path) => expanded.push(path),
    });
    expect(result).toBe("found");
    expect(calls).toEqual(["", "src", "src/deep"]);
    expect(expanded).toEqual(["src", "src/deep"]);
  });
  it("aborts a stale reveal before it can expand a late ancestor", async () => {
    const controller = new AbortController();
    const expand = vi.fn();
    const pending = revealFile({
      path: "src/file.ts",
      signal: controller.signal,
      loadDirectory: async () => {
        await Promise.resolve();
        controller.abort();
        return {
          entries: [{ name: "src", path: "src", kind: "directory" }],
          truncated: false,
        };
      },
      expand,
    });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(expand).not.toHaveBeenCalled();
  });
});
