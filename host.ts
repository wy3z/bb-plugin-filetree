import { opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  filetreeHostContract,
  filetreeHostSignals,
  type FileTreeEntry,
  type WorkspaceWatchEvent,
} from "./contract.js";

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_SEARCHED_ENTRIES = 30_000;
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_DIRECTORY_RESULT_BYTES = 2 * 1024 * 1024;
const WATCH_IGNORED_PATHS = [
  ".git",
  ".cache",
  ".next",
  ".pnpm-store",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
] as const;
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

interface WatchSubscription {
  dispose(): Promise<void>;
}

const activeWatches = new Map<string, WatchSubscription>();

function relativeSegments(relativePath: string): string[] {
  if (relativePath === "") return [];
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\0"),
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

function isVisibleEntry(dirent: {
  name: string;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}): boolean {
  return (
    dirent.name !== ".git" &&
    !dirent.isSymbolicLink() &&
    (dirent.isDirectory() || dirent.isFile())
  );
}

async function listDirectory(rootPath: string, relativePath: string) {
  const absolutePath = resolveWithinRoot(rootPath, relativePath);
  const directory = await opendir(absolutePath);
  const entries: FileTreeEntry[] = [];
  let resultBytes = 0;
  let truncated = false;

  for await (const dirent of directory) {
    if (!isVisibleEntry(dirent)) continue;
    const entry: FileTreeEntry = {
      name: dirent.name,
      path: childPath(relativePath, dirent.name),
      kind: dirent.isDirectory() ? "directory" : "file",
    };
    const entryBytes = Buffer.byteLength(JSON.stringify(entry));
    if (
      entries.length >= MAX_DIRECTORY_ENTRIES ||
      resultBytes + entryBytes > MAX_DIRECTORY_RESULT_BYTES
    ) {
      truncated = true;
      break;
    }
    entries.push(entry);
    resultBytes += entryBytes;
  }

  entries.sort(compareEntries);
  return { entries, truncated };
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

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Search cancelled");
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
  let queueIndex = 0;
  let deferredIndex = 0;
  let scanned = 0;
  let scanLimitReached = false;

  while (queueIndex < queue.length || deferredIndex < deferred.length) {
    throwIfAborted(signal);
    const current =
      queueIndex < queue.length
        ? queue[queueIndex++]
        : deferred[deferredIndex++];
    if (current === undefined) break;

    let directory;
    try {
      directory = await opendir(current.absolutePath);
    } catch {
      continue;
    }

    try {
      for await (const dirent of directory) {
        throwIfAborted(signal);
        if (scanned >= MAX_SEARCHED_ENTRIES) {
          scanLimitReached = true;
          break;
        }
        scanned += 1;
        if (!isVisibleEntry(dirent)) continue;

        const relativePath = childPath(current.relativePath, dirent.name);
        if (dirent.isFile() && matchesQuery(relativePath, query)) {
          matches.push({ name: dirent.name, path: relativePath, kind: "file" });
          if (matches.length >= limit) {
            return { matches, truncated: true };
          }
        }

        if (dirent.isDirectory()) {
          const next = {
            absolutePath: path.join(current.absolutePath, dirent.name),
            relativePath,
          };
          if (searchPriority(dirent.name) === 0) queue.push(next);
          else deferred.push(next);
        }
      }
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof Error && error.name === "AbortError") throw error;
    }

    if (scanLimitReached) break;
  }

  matches.sort((first, second) =>
    first.path.localeCompare(second.path, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return {
    matches,
    truncated:
      scanLimitReached || queueIndex < queue.length || deferredIndex < deferred.length,
  };
}

function normalizeWatchPath(rootPath: string, changedPath: string): string | null {
  const root = path.resolve(rootPath);
  const relative = path.isAbsolute(changedPath)
    ? path.relative(root, path.resolve(changedPath))
    : changedPath;
  const normalized = relative.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (
    normalized === "" ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeWatchEvent(
  rootPath: string,
  event:
    | {
        readonly kind: "changed";
        readonly changes: readonly {
          readonly path: string;
          readonly type: "create" | "update" | "delete";
        }[];
      }
    | { readonly kind: "rescan-required" }
    | { readonly kind: "watch-error"; readonly message: string },
): WorkspaceWatchEvent {
  if (event.kind === "rescan-required") return event;
  if (event.kind === "watch-error") return event;
  return {
    kind: "changed",
    changes: event.changes.flatMap((change) => {
      const relativePath = normalizeWatchPath(rootPath, change.path);
      return relativePath === null
        ? []
        : [{ path: relativePath, type: change.type }];
    }),
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
  experimental_signals: filetreeHostSignals,
  handlers: {
    async listDirectory({ rootPath, relativePath }) {
      return listDirectory(rootPath, relativePath);
    },
    async search({ rootPath, query, limit }, context) {
      return searchFiles(rootPath, query, limit, context.signal);
    },
    async startWatch({ rootPath, watchId }, context) {
      const existing = activeWatches.get(watchId);
      if (existing !== undefined) await existing.dispose();

      const resolvedRoot = path.resolve(rootPath);
      const subscription = await context.experimental_watch(
        {
          rootPath: resolvedRoot,
          ignoredPaths: WATCH_IGNORED_PATHS,
          debounceMs: 125,
          maxWaitMs: 750,
        },
        async (event) => {
          await context.experimental_emitSignal("workspaceChanged", {
            watchId,
            event: normalizeWatchEvent(resolvedRoot, event),
          });
        },
      );
      activeWatches.set(watchId, subscription);
      return { started: true };
    },
    async stopWatch({ watchId }) {
      const subscription = activeWatches.get(watchId);
      if (subscription === undefined) return { stopped: false };
      activeWatches.delete(watchId);
      await subscription.dispose();
      return { stopped: true };
    },
    async readFile({ rootPath, relativePath }) {
      return readTextFile(rootPath, relativePath);
    },
  },
  async dispose() {
    const watches = [...activeWatches.values()];
    activeWatches.clear();
    await Promise.allSettled(watches.map((watch) => watch.dispose()));
  },
});
