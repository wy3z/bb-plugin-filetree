import { describe, expect, it } from "vitest";
import { NATIVE_FILES_STATE_MAX_BYTES } from "../native-files-ui-types";
import {
  readPersistedRootChoice,
  readPersistedRootState,
  rootChoiceKey,
  rootStateKey,
  writePersistedRootChoice,
  writePersistedRootState,
} from "./persistence";
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
describe("native files persistence", () => {
  it("uses its own namespace and ignores the earlier filetree plugin state", () => {
    const target = storage();
    target.setItem(
      "bb-filetree:root-choice:v1:thread-a",
      JSON.stringify({ rootId: "plugin-root" }),
    );
    writePersistedRootChoice(target, "thread-a", "native-root", 100);
    expect(rootChoiceKey("thread-a")).toBe(
      "bb-plugin-files:root-choice:v1:thread-a",
    );
    expect(readPersistedRootChoice(target, "thread-a", 100)).toBe(
      "native-root",
    );
  });
  it("drops path traversal and bounds expanded state before writing", () => {
    const target = storage();
    writePersistedRootState(
      target,
      {
        expandedPaths: [
          "src",
          "../outside",
          ...Array.from({ length: 2000 }, (_, index) => `dir-${index}`),
        ],
        rootId: "root-a",
        searchQuery: "query",
        selectedPath: "src/index.ts",
        scrollTop: 42,
        threadId: "thread-a",
      },
      100,
    );
    const raw = target.getItem(rootStateKey("thread-a", "root-a"));
    expect(raw).not.toBeNull();
    expect(new TextEncoder().encode(raw ?? "").byteLength).toBeLessThanOrEqual(
      NATIVE_FILES_STATE_MAX_BYTES,
    );
    const restored = readPersistedRootState(target, "thread-a", "root-a", 100);
    expect(restored?.expandedPaths).not.toContain("../outside");
    expect(restored?.expandedPaths.length).toBeLessThanOrEqual(512);
  });
  it("removes stale and malformed persisted state", () => {
    const target = storage();
    target.setItem(rootStateKey("thread-a", "root-a"), "not-json");
    expect(
      readPersistedRootState(target, "thread-a", "root-a", 100),
    ).toBeNull();
    expect(target.getItem(rootStateKey("thread-a", "root-a"))).toBeNull();
  });
});
