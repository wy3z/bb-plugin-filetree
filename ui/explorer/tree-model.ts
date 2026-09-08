import type {
  NativeFilesEntry,
  NativeFilesGitChange,
} from "../native-files-ui-types.js";
import type { CompactTreeNode } from "./compact-chains.js";
export type DirectorySnapshot =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      entries: readonly NativeFilesEntry[];
      truncated: boolean;
    }
  | {
      status: "error";
      message: string;
    };
export interface ExplorerTreeRow {
  entry: NativeFilesEntry;
  level: number;
  compactLabel: string | null;
  compactSegmentPaths: readonly string[];
  change: NativeFilesGitChange | null;
  childState: DirectorySnapshot | null;
  expanded: boolean;
}
function compareEntries(
  left: NativeFilesEntry,
  right: NativeFilesEntry,
): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
export function flattenDirectoryTree(options: {
  directories: ReadonlyMap<string, DirectorySnapshot>;
  expanded: ReadonlySet<string>;
  changes: ReadonlyMap<string, NativeFilesGitChange>;
}): readonly ExplorerTreeRow[] {
  const rows: ExplorerTreeRow[] = [];
  const append = (parentPath: string, level: number) => {
    const directory = options.directories.get(parentPath);
    if (directory?.status !== "ready") return;
    for (const entry of [...directory.entries].sort(compareEntries)) {
      const expanded =
        entry.kind === "directory" && options.expanded.has(entry.path);
      rows.push({
        entry,
        level,
        compactLabel: null,
        compactSegmentPaths: [],
        change: options.changes.get(entry.path) ?? null,
        childState:
          entry.kind === "directory"
            ? (options.directories.get(entry.path) ?? null)
            : null,
        expanded,
      });
      if (expanded) append(entry.path, level + 1);
    }
  };
  append("", 1);
  return rows;
}
export function flattenCompactTree(
  nodes: readonly CompactTreeNode[],
  collapsed: ReadonlySet<string>,
): readonly ExplorerTreeRow[] {
  const rows: ExplorerTreeRow[] = [];
  const append = (values: readonly CompactTreeNode[], level: number) => {
    for (const value of values) {
      const expanded =
        value.kind === "directory" && !collapsed.has(value.chain.targetPath);
      rows.push({
        entry:
          value.entry ??
          ({
            name: value.chain.label,
            path: value.chain.targetPath,
            kind: value.kind,
          } satisfies NativeFilesEntry),
        level,
        compactLabel: value.chain.label,
        compactSegmentPaths: value.chain.segmentPaths,
        change: value.change,
        childState: null,
        expanded,
      });
      if (expanded) append(value.children, level + 1);
    }
  };
  append(nodes, 1);
  return rows;
}
export function parentRowPath(
  rows: readonly ExplorerTreeRow[],
  rowIndex: number,
): string | null {
  const row = rows[rowIndex];
  if (row === undefined || row.level <= 1) return null;
  for (let index = rowIndex - 1; index >= 0; index -= 1) {
    const candidate = rows[index]!;
    if (candidate.level < row.level) return candidate.entry.path;
  }
  return null;
}
export function firstChildPath(
  rows: readonly ExplorerTreeRow[],
  rowIndex: number,
): string | null {
  const row = rows[rowIndex];
  const next = rows[rowIndex + 1];
  return row !== undefined && next?.level === row.level + 1
    ? next.entry.path
    : null;
}
