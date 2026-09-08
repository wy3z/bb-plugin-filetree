import { describe, expect, it } from "vitest";
import type { NativeFilesGitChange } from "../native-files-ui-types";
import { changedFilesTree, gitStatusLabel } from "./git-tree.js";
const changes: NativeFilesGitChange[] = [
  {
    path: "src/generated/output.ts",
    previousPath: null,
    indexStatus: "A",
    worktreeStatus: "M",
    generated: true,
    conflicted: false,
  },
  {
    path: "src/renamed.ts",
    previousPath: "src/old.ts",
    indexStatus: "R",
    worktreeStatus: ".",
    generated: false,
    conflicted: false,
  },
  {
    path: "conflict.ts",
    previousPath: null,
    indexStatus: "U",
    worktreeStatus: "U",
    generated: false,
    conflicted: true,
  },
];
describe("Git tree presentation", () => {
  it("filters generated paths without collapsing staged and worktree state", () => {
    const tree = changedFilesTree(changes, true);
    expect(JSON.stringify(tree)).not.toContain("generated/output.ts");
    expect(JSON.stringify(tree)).toContain("src/renamed.ts");
    expect(gitStatusLabel(changes[0]!)).toContain("index A");
    expect(gitStatusLabel(changes[0]!)).toContain("worktree M");
  });
  it("keeps rename origin and conflict state on the terminal file", () => {
    const tree = changedFilesTree(changes, false);
    expect(JSON.stringify(tree)).toContain("src/old.ts");
    expect(gitStatusLabel(changes[2]!)).toContain("conflicted");
  });
});
