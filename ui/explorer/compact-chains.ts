import type { NativeFilesCompactChain } from "../native-files-ui-types.js";
import type {
  NativeFilesEntry,
  NativeFilesGitChange,
} from "../native-files-ui-types.js";
interface MutableCompactNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children: Map<string, MutableCompactNode>;
  entry: NativeFilesEntry | null;
  change: NativeFilesGitChange | null;
}
export interface CompactTreeNode {
  chain: NativeFilesCompactChain;
  kind: "file" | "directory";
  children: readonly CompactTreeNode[];
  entry: NativeFilesEntry | null;
  change: NativeFilesGitChange | null;
}
function node(
  name: string,
  path: string,
  kind: "file" | "directory",
): MutableCompactNode {
  return { name, path, kind, children: new Map(), entry: null, change: null };
}
function compareNodes(
  left: MutableCompactNode,
  right: MutableCompactNode,
): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
function freezeCompact(current: MutableCompactNode): CompactTreeNode {
  const labels = [current.name];
  const segmentPaths = [current.path];
  let terminal = current;
  while (
    terminal.kind === "directory" &&
    terminal.entry === null &&
    terminal.children.size === 1
  ) {
    const child = terminal.children.values().next().value;
    if (child === undefined || child.kind !== "directory") break;
    labels.push(child.name);
    segmentPaths.push(child.path);
    terminal = child;
  }
  return {
    chain: {
      label: labels.join("/"),
      segmentPaths,
      targetPath: terminal.path,
    },
    kind: terminal.kind,
    children: [...terminal.children.values()]
      .sort(compareNodes)
      .map(freezeCompact),
    entry: terminal.entry,
    change: terminal.change,
  };
}
export function buildCompactTree(
  values: readonly {
    entry: NativeFilesEntry;
    change?: NativeFilesGitChange;
  }[],
): readonly CompactTreeNode[] {
  const root = node("", "", "directory");
  for (const value of values) {
    const parts = value.entry.path.split("/");
    let parent = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!;
      const path = parts.slice(0, index + 1).join("/");
      const isTerminal = index === parts.length - 1;
      const kind = isTerminal ? value.entry.kind : "directory";
      let child = parent.children.get(name);
      if (child === undefined) {
        child = node(name, path, kind);
        parent.children.set(name, child);
      }
      if (isTerminal) {
        child.kind = value.entry.kind;
        child.entry = value.entry;
        child.change = value.change ?? null;
      }
      parent = child;
    }
  }
  return [...root.children.values()].sort(compareNodes).map(freezeCompact);
}
