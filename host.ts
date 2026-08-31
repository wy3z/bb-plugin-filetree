import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { filetreeHostContract, type FileTreeEntry } from "./contract.js";

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_SEARCHED_ENTRIES = 30_000;
const DEFERRED_SEARCH_DIRS = new Set([
  ".cache",
  ".next",
  ".pnpm-store",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

function relativeSegments(relativePath: string): string[] {
  if (relativePath === "") return [];
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || segment.includes("\0"),
    )
  ) {
    throw new Error("Invalid workspace-relative path");
  }
  return segments;
}

function resolveWithinRoot(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...relativeSegments(relativePath));
  const relative = path.relative(root, target);
  if (
    relative !== "" &&
    (relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative))
  ) {
    throw new Error("Path leaves the workspace root");
  }
  return target;
}

function childPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

function compareEntries(first: FileTreeEntry, second: FileTreeEntry): number {
  if (first.kind !== second.kind) {
    return first.kind === "directory" ? -1 : 1;
  }
  return first.name.localeCompare(second.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function listDirectory(
  rootPath: string,
  relativePath: string,
): Promise<FileTreeEntry[]> {
  const absolutePath = resolveWithinRoot(rootPath, relativePath);
  const dirents = await readdir(absolutePath, { withFileTypes: true });
  const entries: FileTreeEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.name === ".git" || dirent.isSymbolicLink()) continue;
    if (!dirent.isDirectory() && !dirent.isFile()) continue;
    entries.push({
      name: dirent.name,
      path: childPath(relativePath, dirent.name),
      kind: dirent.isDirectory() ? "directory" : "file",
    });
  }
  return entries.sort(compareEntries);
}

function matchesQuery(relativePath: string, query: string): boolean {
  const haystack = relativePath.toLocaleLowerCase();
  const tokens = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function searchPriority(name: string): number {
  return DEFERRED_SEARCH_DIRS.has(name) ? 1 : 0;
}

async function searchFiles(
  rootPath: string,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<{ matches: FileTreeEntry[]; truncated: boolean }> {
  const root = path.resolve(rootPath);
  const queue: Array<{ absolutePath: string; relativePath: string }> = [
    { absolutePath: root, relativePath: "" },
  ];
  const deferred: Array<{ absolutePath: string; relativePath: string }> = [];
  const matches: FileTreeEntry[] = [];
  let scanned = 0;

  while ((queue.length > 0 || deferred.length > 0) && scanned < MAX_SEARCHED_ENTRIES) {
    if (signal.aborted) throw new Error("Search cancelled");
    const current = queue.shift() ?? deferred.shift();
    if (current === undefined) break;

    let dirents;
    try {
      dirents = await readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      if (signal.aborted) throw new Error("Search cancelled");
      if (dirent.name === ".git" || dirent.isSymbolicLink()) continue;
      if (!dirent.isDirectory() && !dirent.isFile()) continue;
      scanned += 1;
      const relativePath = childPath(current.relativePath, dirent.name);

      if (dirent.isFile() && matchesQuery(relativePath, query)) {
        matches.push({ name: dirent.name, path: relativePath, kind: "file" });
        if (matches.length >= limit) {
          return { matches, truncated: true };
        }
      }

      if (dirent.isDirectory() && scanned < MAX_SEARCHED_ENTRIES) {
        const next = {
          absolutePath: path.join(current.absolutePath, dirent.name),
          relativePath,
        };
        if (searchPriority(dirent.name) === 0) queue.push(next);
        else deferred.push(next);
      }
    }
  }

  matches.sort((first, second) =>
    first.path.localeCompare(second.path, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return {
    matches,
    truncated: queue.length > 0 || deferred.length > 0 || scanned >= MAX_SEARCHED_ENTRIES,
  };
}

async function readTextFile(rootPath: string, relativePath: string) {
  const absolutePath = resolveWithinRoot(rootPath, relativePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    return {
      kind: "unsupported" as const,
      reason: "This path is not a regular file.",
      sizeBytes: Math.max(0, Math.trunc(fileStat.size)),
    };
  }
  const sizeBytes = Math.max(0, Math.trunc(fileStat.size));
  if (sizeBytes > MAX_PREVIEW_BYTES) {
    return {
      kind: "unsupported" as const,
      reason: `File is too large to preview (${(sizeBytes / 1024 / 1024).toFixed(1)} MB).`,
      sizeBytes,
    };
  }

  const bytes = await readFile(absolutePath);
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      kind: "text" as const,
      content,
      modifiedAtMs: fileStat.mtimeMs,
      sizeBytes,
    };
  } catch {
    return {
      kind: "unsupported" as const,
      reason: "Binary files are not previewed yet.",
      sizeBytes,
    };
  }
}

export default experimental_defineHostEntry({
  contract: filetreeHostContract,
  handlers: {
    async listDirectory({ rootPath, relativePath }) {
      return { entries: await listDirectory(rootPath, relativePath) };
    },
    async search({ rootPath, query, limit }, context) {
      return searchFiles(rootPath, query, limit, context.signal);
    },
    async readFile({ rootPath, relativePath }) {
      return readTextFile(rootPath, relativePath);
    },
  },
});
