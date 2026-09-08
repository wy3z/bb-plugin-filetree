import type {
  NativeFilesEntry,
  NativeFilesGitChange,
} from "../native-files-ui-types.js";
import { buildCompactTree, type CompactTreeNode } from "./compact-chains.js";
export function gitStatusLabel(change: NativeFilesGitChange): string {
  const labels: string[] = [];
  if (change.conflicted) labels.push("conflicted");
  if (change.indexStatus !== ".") labels.push(`index ${change.indexStatus}`);
  if (change.worktreeStatus !== ".")
    labels.push(`worktree ${change.worktreeStatus}`);
  if (change.generated) labels.push("generated");
  if (change.previousPath !== null) labels.push(`from ${change.previousPath}`);
  return labels.join(", ");
}
export function changedFilesTree(
  changes: readonly NativeFilesGitChange[],
  hideGenerated: boolean,
): readonly CompactTreeNode[] {
  return buildCompactTree(
    changes
      .filter((change) => !hideGenerated || !change.generated)
      .map((change) => ({
        entry: {
          name: change.path.split("/").at(-1) ?? change.path,
          path: change.path,
          kind: "file" as const,
        },
        change,
      })),
  );
}
export function changeByPath(
  changes: readonly NativeFilesGitChange[],
): ReadonlyMap<string, NativeFilesGitChange> {
  return new Map(changes.map((change) => [change.path, change]));
}
export function descendantChangeCount(
  directoryPath: string,
  changes: readonly NativeFilesGitChange[],
): number {
  const prefix = directoryPath === "" ? "" : `${directoryPath}/`;
  return changes.filter((change) => change.path.startsWith(prefix)).length;
}
export function entryFromChange(
  change: NativeFilesGitChange,
): NativeFilesEntry {
  return {
    name: change.path.split("/").at(-1) ?? change.path,
    path: change.path,
    kind: "file",
  };
}
