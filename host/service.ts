import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  NATIVE_FILE_DIRECTORY_ENTRY_LIMIT,
  NATIVE_FILE_GIT_ENTRY_LIMIT,
  NATIVE_FILE_SEARCH_SCAN_LIMIT,
  type NativeFileEntry,
  type NativeFileGitChange,
  type NativeFileGitStatusResult,
  type NativeFileSnapshot,
} from "../contracts/model.js";
import mimeTypes from "mime-types";
import {
  assertRelativePath,
  closeOpenedPath,
  createOpenatPrimitive,
  OPEN_DIRECTORY_FLAGS,
  openRelativePath,
  type ConfinementDependencies,
  type ConfinementDirent,
  type OpenatPrimitive,
} from "./confinement.js";
import { NativeFileHostError, remapFilesystemError } from "./errors.js";
export { NativeFileHostError, type NativeFileHostErrorCode } from "./errors.js";
const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;
const GIT_TIMEOUT_MS = 15000;
const GIT_STATUS_ARGS = [
  "-c",
  "core.fsmonitor=",
  "-c",
  "core.useBuiltinFSMonitor=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "credential.helper=",
  "-c",
  "diff.external=",
  "-c",
  "submodule.recurse=false",
  "-c",
  "status.relativePaths=true",
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "--untracked-files=all",
  "--ignore-submodules=all",
  "--",
  ".",
];
const DEFERRED_SEARCH_DIRECTORIES = new Set([
  ".cache",
  ".next",
  ".pnpm-store",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);
interface RootBinding {
  canonicalPath: string;
  primitive: OpenatPrimitive;
  rootFd: number;
}
interface NativeFileServiceHooks {
  afterOpen?: (
    operation: "git" | "list" | "read" | "search",
    path: string,
  ) => Promise<void>;
}
function childPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}
function compareEntries(
  first: NativeFileEntry,
  second: NativeFileEntry,
): number {
  if (first.kind !== second.kind) return first.kind === "directory" ? -1 : 1;
  return first.name.localeCompare(second.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
function visibleDirent(dirent: ConfinementDirent): boolean {
  return (
    dirent.name !== ".git" &&
    !dirent.isSymbolicLink &&
    (dirent.isDirectory || dirent.isFile)
  );
}
function queryMatches(relativePath: string, query: string): boolean {
  const haystack = relativePath.toLocaleLowerCase();
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}
function validateGitPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  assertRelativePath(normalized, false);
  return normalized;
}
function statusCode(value: string): NativeFileGitChange["indexStatus"] {
  if (
    value === "." ||
    value === "M" ||
    value === "T" ||
    value === "A" ||
    value === "D" ||
    value === "R" ||
    value === "C" ||
    value === "U" ||
    value === "?"
  ) {
    return value;
  }
  throw new Error(`Unsupported Git status ${JSON.stringify(value)}`);
}
function fixedFields(
  value: string,
  count: number,
): {
  fields: string[];
  rest: string;
} {
  const fields: string[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const next = value.indexOf(" ", offset);
    if (next < 0) throw new Error("Malformed Git status output");
    fields.push(value.slice(offset, next));
    offset = next + 1;
  }
  const rest = value.slice(offset);
  if (rest.length === 0) throw new Error("Malformed Git status output");
  return { fields, rest };
}
function parseGitStatus(output: Buffer): {
  branch: string | null;
  headSha: string | null;
  changes: NativeFileGitChange[];
  truncated: boolean;
} {
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(output);
  const records = text.split("\0");
  let branch: string | null = null;
  let headSha: string | null = null;
  const changes: NativeFileGitChange[] = [];
  let truncated = false;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      headSha = value === "(initial)" ? null : value.slice(0, 128);
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      branch = value === "(detached)" ? null : value.slice(0, 1024);
      continue;
    }
    if (record.startsWith("# ") || record.startsWith("! ")) continue;
    let pathValue: string;
    let previousPath: string | null = null;
    let indexStatus: NativeFileGitChange["indexStatus"];
    let worktreeStatus: NativeFileGitChange["worktreeStatus"];
    let conflicted = false;
    if (record.startsWith("? ")) {
      pathValue = validateGitPath(record.slice(2));
      indexStatus = "?";
      worktreeStatus = "?";
    } else {
      const kind = record[0];
      const fieldCount =
        kind === "1" ? 7 : kind === "2" ? 8 : kind === "u" ? 9 : 0;
      if (fieldCount === 0 || record[1] !== " ") continue;
      const parsed = fixedFields(record.slice(2), fieldCount);
      const xy = parsed.fields[0] ?? "";
      if (xy.length !== 2) throw new Error("Malformed Git status output");
      pathValue = validateGitPath(parsed.rest);
      if (kind === "2") {
        const previous = records[index + 1];
        if (!previous) throw new Error("Malformed Git rename output");
        previousPath = validateGitPath(previous);
        index += 1;
      }
      indexStatus = statusCode(xy[0] ?? ".");
      worktreeStatus = statusCode(xy[1] ?? ".");
      conflicted =
        kind === "u" || indexStatus === "U" || worktreeStatus === "U";
    }
    if (changes.length >= NATIVE_FILE_GIT_ENTRY_LIMIT) {
      truncated = true;
      continue;
    }
    changes.push({
      conflicted,
      generated: false,
      indexStatus,
      path: pathValue,
      previousPath,
      worktreeStatus,
    });
  }
  return { branch, headSha, changes, truncated };
}
export class NativeFileHostService {
  private readonly bindings = new Map<string, RootBinding>();
  private readonly operations = new Map<string, AbortController>();
  private primitiveInstance: OpenatPrimitive | undefined;
  constructor(
    private readonly hooks: NativeFileServiceHooks = {},
    private readonly dependencies: ConfinementDependencies = {},
  ) {}
  private primitive(): OpenatPrimitive {
    if (!this.primitiveInstance) {
      this.primitiveInstance = createOpenatPrimitive(this.dependencies);
    }
    return this.primitiveInstance;
  }
  async bindRoot(rootPath: string): Promise<{
    identity: {
      canonicalPath: string;
      device: string;
      inode: string;
    };
    rootBindingId: string;
  }> {
    const primitive = this.primitive();
    if (!path.posix.isAbsolute(rootPath) || rootPath.includes("\0")) {
      throw new NativeFileHostError(
        "native_file_invalid_path",
        "Root path must be absolute",
      );
    }
    let rootFd: number;
    try {
      rootFd = await primitive.openRoot(rootPath, OPEN_DIRECTORY_FLAGS);
    } catch (error) {
      remapFilesystemError(error);
    }
    try {
      const stat = await primitive.fstat(rootFd);
      if (!stat.isDirectory) {
        throw new NativeFileHostError(
          "native_file_invalid_path",
          "Root must be a directory",
        );
      }
      const canonicalPath = await primitive.canonicalPath(rootFd);
      const rootBindingId = randomUUID();
      this.bindings.set(rootBindingId, {
        canonicalPath,
        primitive,
        rootFd,
      });
      return {
        identity: {
          canonicalPath,
          device: stat.device,
          inode: stat.inode,
        },
        rootBindingId,
      };
    } catch (error) {
      if (!this.bindingsHasFd(rootFd)) {
        await primitive.close(rootFd).catch(() => undefined);
      }
      remapFilesystemError(error);
    }
  }
  private bindingsHasFd(rootFd: number): boolean {
    for (const binding of this.bindings.values()) {
      if (binding.rootFd === rootFd) return true;
    }
    return false;
  }
  async releaseRoot(rootBindingId: string): Promise<{
    released: boolean;
  }> {
    const binding = this.bindings.get(rootBindingId);
    if (!binding) return { released: false };
    this.bindings.delete(rootBindingId);
    await binding.primitive.close(binding.rootFd).catch(() => undefined);
    return { released: true };
  }
  async dispose(): Promise<void> {
    for (const controller of this.operations.values()) controller.abort();
    this.operations.clear();
    const bindings = [...this.bindings.values()];
    this.bindings.clear();
    await Promise.all(
      bindings.map((binding) =>
        binding.primitive.close(binding.rootFd).catch(() => undefined),
      ),
    );
  }
  private requireBinding(rootBindingId: string): RootBinding {
    const binding = this.bindings.get(rootBindingId);
    if (!binding) {
      throw new NativeFileHostError(
        "native_file_binding_unknown",
        "Root binding is no longer available",
      );
    }
    return binding;
  }
  private operation(operationId: string): AbortController {
    const existing = this.operations.get(operationId);
    if (existing) existing.abort();
    const controller = new AbortController();
    this.operations.set(operationId, controller);
    return controller;
  }
  private finishOperation(
    operationId: string,
    controller: AbortController,
  ): void {
    if (this.operations.get(operationId) === controller)
      this.operations.delete(operationId);
  }
  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new NativeFileHostError(
        "native_file_operation_cancelled",
        "Native file operation cancelled",
      );
    }
  }
  cancel(operationId: string): {
    cancelled: boolean;
  } {
    const controller = this.operations.get(operationId);
    if (!controller) return { cancelled: false };
    controller.abort();
    return { cancelled: true };
  }
  async listDirectory(rootBindingId: string, relativePath: string) {
    const binding = this.requireBinding(rootBindingId);
    const opened = await openRelativePath(
      binding.primitive,
      binding.rootFd,
      relativePath,
      "directory",
    );
    try {
      await this.hooks.afterOpen?.("list", relativePath);
      const entries: NativeFileEntry[] = [];
      let truncated = false;
      for await (const dirent of binding.primitive.iterateDirents(opened.fd)) {
        if (!visibleDirent(dirent)) continue;
        if (entries.length >= NATIVE_FILE_DIRECTORY_ENTRY_LIMIT) {
          truncated = true;
          break;
        }
        entries.push({
          kind: dirent.isDirectory ? "directory" : "file",
          name: dirent.name,
          path: childPath(relativePath, dirent.name),
        });
      }
      entries.sort(compareEntries);
      return { entries, truncated };
    } finally {
      await closeOpenedPath(binding.primitive, opened);
    }
  }
  async search(
    rootBindingId: string,
    query: string,
    limit: number,
    operationId: string,
  ) {
    const controller = this.operation(operationId);
    const queue = [""];
    const deferred: string[] = [];
    const matches: NativeFileEntry[] = [];
    let queueIndex = 0;
    let deferredIndex = 0;
    let scanned = 0;
    let truncated = false;
    try {
      while (queueIndex < queue.length || deferredIndex < deferred.length) {
        this.throwIfCancelled(controller.signal);
        const relativePath =
          queueIndex < queue.length
            ? queue[queueIndex++]
            : deferred[deferredIndex++];
        if (relativePath === undefined) break;
        const binding = this.requireBinding(rootBindingId);
        let opened: {
          fd: number;
          parents: number[];
        };
        try {
          opened = await openRelativePath(
            binding.primitive,
            binding.rootFd,
            relativePath,
            "directory",
          );
        } catch (error) {
          if (relativePath === "") throw error;
          continue;
        }
        try {
          await this.hooks.afterOpen?.("search", relativePath);
          for await (const dirent of binding.primitive.iterateDirents(
            opened.fd,
          )) {
            this.throwIfCancelled(controller.signal);
            if (scanned >= NATIVE_FILE_SEARCH_SCAN_LIMIT) {
              truncated = true;
              break;
            }
            scanned += 1;
            if (!visibleDirent(dirent)) continue;
            const nextPath = childPath(relativePath, dirent.name);
            if (queryMatches(nextPath, query)) {
              matches.push({
                kind: dirent.isDirectory ? "directory" : "file",
                name: dirent.name,
                path: nextPath,
              });
              if (matches.length >= limit) {
                truncated = true;
                break;
              }
            }
            if (dirent.isDirectory) {
              (DEFERRED_SEARCH_DIRECTORIES.has(dirent.name)
                ? deferred
                : queue
              ).push(nextPath);
            }
          }
        } finally {
          await closeOpenedPath(binding.primitive, opened);
        }
        if (truncated) break;
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
          truncated ||
          queueIndex < queue.length ||
          deferredIndex < deferred.length,
      };
    } finally {
      this.finishOperation(operationId, controller);
    }
  }
  async read(
    rootBindingId: string,
    relativePath: string,
    maxBytes: number,
  ): Promise<NativeFileSnapshot> {
    const binding = this.requireBinding(rootBindingId);
    const opened = await openRelativePath(
      binding.primitive,
      binding.rootFd,
      relativePath,
      "file",
    );
    try {
      await this.hooks.afterOpen?.("read", relativePath);
      const before = await binding.primitive.fstat(opened.fd);
      if (before.size > maxBytes) {
        throw new NativeFileHostError(
          "native_file_too_large",
          `File exceeds ${maxBytes} bytes`,
        );
      }
      const bytes = await binding.primitive.readFile(opened.fd, before.size);
      if (bytes.byteLength > maxBytes) {
        throw new NativeFileHostError(
          "native_file_too_large",
          `File exceeds ${maxBytes} bytes`,
        );
      }
      let contentEncoding: "base64" | "utf8" = "base64";
      let content = bytes.toString("base64");
      try {
        content = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
        contentEncoding = "utf8";
      } catch {
        contentEncoding = "base64";
      }
      return {
        content,
        contentEncoding,
        mimeType: mimeTypes.lookup(relativePath) || "application/octet-stream",
        modifiedAtMs: before.mtimeMs,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
      };
    } finally {
      await closeOpenedPath(binding.primitive, opened);
    }
  }
  async gitStatus(
    rootBindingId: string,
    operationId: string,
  ): Promise<NativeFileGitStatusResult> {
    const controller = this.operation(operationId);
    const binding = this.requireBinding(rootBindingId);
    try {
      await this.hooks.afterOpen?.("git", "");
      this.throwIfCancelled(controller.signal);
      const result = await binding.primitive.gitStatusAt(
        binding.rootFd,
        GIT_STATUS_ARGS,
        {
          maxBytes: GIT_OUTPUT_LIMIT,
          signal: controller.signal,
          timeoutMs: GIT_TIMEOUT_MS,
        },
      );
      if (result.code !== 0) {
        const reason = result.stderr.toString("utf8").slice(0, 1000);
        if (/not a git repository|must be run in a work tree/iu.test(reason)) {
          return {
            kind: "not-repository",
            reason: "The selected root is not a Git worktree.",
          };
        }
        return { kind: "unavailable", reason: reason || "Git status failed" };
      }
      const prefixResult = await binding.primitive.gitStatusAt(
        binding.rootFd,
        ["rev-parse", "--show-prefix"],
        {
          maxBytes: 16384,
          signal: controller.signal,
          timeoutMs: GIT_TIMEOUT_MS,
        },
      );
      if (prefixResult.code !== 0)
        return {
          kind: "unavailable",
          reason: "Git workspace prefix could not be resolved",
        };
      const prefix = prefixResult.stdout.toString("utf8").replace(/\r?\n$/, "");
      const parsed = parseGitStatus(result.stdout);
      const changes = parsed.changes.flatMap((change) => {
        if (!change.path.startsWith(prefix)) return [];
        const relativePath = change.path.slice(prefix.length);
        assertRelativePath(relativePath, false);
        const previousPath = change.previousPath?.startsWith(prefix)
          ? change.previousPath.slice(prefix.length)
          : null;
        if (previousPath !== null) assertRelativePath(previousPath, false);
        return [{ ...change, path: relativePath, previousPath }];
      });
      return { kind: "ready", ...parsed, changes };
    } finally {
      this.finishOperation(operationId, controller);
    }
  }
}
