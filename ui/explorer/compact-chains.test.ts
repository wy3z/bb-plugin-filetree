import { describe, expect, it } from "vitest";
import { buildCompactTree } from "./compact-chains.js";
describe("compact directory chains", () => {
  it("compacts presentation labels while retaining every true path", () => {
    const tree = buildCompactTree([
      {
        entry: {
          name: "file.ts",
          path: "src/features/deep/file.ts",
          kind: "file",
        },
      },
    ]);
    expect(tree[0]?.chain).toEqual({
      label: "src/features/deep",
      segmentPaths: ["src", "src/features", "src/features/deep"],
      targetPath: "src/features/deep",
    });
    expect(tree[0]?.children[0]?.chain.targetPath).toBe(
      "src/features/deep/file.ts",
    );
  });
  it("stops compaction at branches", () => {
    const tree = buildCompactTree([
      { entry: { name: "a.ts", path: "src/a.ts", kind: "file" } },
      { entry: { name: "b.ts", path: "src/b.ts", kind: "file" } },
    ]);
    expect(tree[0]?.chain.label).toBe("src");
    expect(tree[0]?.children.map((child) => child.chain.targetPath)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});
