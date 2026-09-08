import { constants as fsConstants } from "node:fs";
import { fstat as fstatCallback, read as readCallback } from "node:fs";
import { open, opendir, realpath, type FileHandle } from "node:fs/promises";
import { NativeFileHostError, remapFilesystemError } from "./errors.js";
import { loadNativeFilesAddon, type NativeFilesAddon } from "./native-addon.js";
import { resolveTrustedGit, scrubbedGitEnvPairs } from "./git-env.js";
import { spawnGitAtPath, type SpawnGitResult } from "./spawn-git.js";
const O_CLOEXEC =
  (
    fsConstants as {
      O_CLOEXEC?: number;
    }
  ).O_CLOEXEC ?? 0;
function fstatOpenedFd(fd: number): Promise<{
  dev: bigint;
  ino: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  mtimeMs: bigint;
  size: bigint;
}> {
  return new Promise((resolve, reject) => {
    fstatCallback(fd, { bigint: true }, (error, stats) => {
      if (error) reject(error);
      else resolve(stats);
    });
  });
}
export const OPEN_DIRECTORY_FLAGS =
  fsConstants.O_RDONLY |
  fsConstants.O_DIRECTORY |
  fsConstants.O_NOFOLLOW |
  O_CLOEXEC;
export const OPEN_FILE_FLAGS =
  fsConstants.O_RDONLY |
  fsConstants.O_NOFOLLOW |
  fsConstants.O_NONBLOCK |
  O_CLOEXEC;
export interface ConfinementStat {
  device: string;
  inode: string;
  isDirectory: boolean;
  isFile: boolean;
  mtimeMs: number;
  size: number;
}
export interface ConfinementDirent {
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  name: string;
}
export interface OpenatPrimitive {
  canonicalPath(fd: number): Promise<string>;
  close(fd: number): Promise<void>;
  dup(fd: number, flags: number): Promise<number>;
  fstat(fd: number): Promise<ConfinementStat>;
  gitStatusAt(
    dirfd: number,
    args: string[],
    options: {
      maxBytes: number;
      signal: AbortSignal;
      timeoutMs: number;
    },
  ): Promise<SpawnGitResult>;
  iterateDirents(fd: number): AsyncIterable<ConfinementDirent>;
  openRoot(path: string, flags: number): Promise<number>;
  openat(dirfd: number, name: string, flags: number): Promise<number>;
  readFile(fd: number, size: number): Promise<Buffer>;
}
export interface ConfinementDependencies {
  nativeAddon?: NativeFilesAddon | null;
  platform?: NodeJS.Platform;
  primitive?: OpenatPrimitive;
}
export function linuxDescriptorPath(fd: number, segment?: string): string {
  const base = `/proc/self/fd/${fd}`;
  return segment === undefined ? base : `${base}/${segment}`;
}
export function assertRelativePath(value: string, allowEmpty: boolean): void {
  const segments = value.split("/");
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    (!allowEmpty && value.length === 0) ||
    (value.length > 0 &&
      segments.some(
        (segment) =>
          segment.length === 0 || segment === "." || segment === "..",
      ))
  ) {
    throw new NativeFileHostError(
      "native_file_invalid_path",
      "Path must be a normalized relative path",
    );
  }
}
export function assertComponent(name: string): void {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new NativeFileHostError(
      "native_file_invalid_path",
      "Path must be a normalized relative path",
    );
  }
}
function confinementUnavailable(platform: string): never {
  throw new NativeFileHostError(
    "native_file_confinement_unavailable",
    `Native Files confinement is unavailable on ${platform}`,
  );
}
function toConfinementStat(stat: {
  dev: bigint | number;
  ino: bigint | number;
  isDirectory(): boolean;
  isFile(): boolean;
  mtimeMs: bigint | number;
  size: bigint | number;
}): ConfinementStat {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    mtimeMs: Number(stat.mtimeMs),
    size: Number(stat.size),
  };
}
async function readOpenedFd(fd: number, size: number): Promise<Buffer> {
  if (size === 0) return Buffer.alloc(0);
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = await new Promise<number>((resolve, reject) => {
      readCallback(
        fd,
        buffer,
        offset,
        size - offset,
        offset,
        (error, count) => {
          if (error) reject(error);
          else resolve(count);
        },
      );
    });
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}
export function createLinuxProcFdPrimitive(): OpenatPrimitive {
  const handles = new Map<number, FileHandle>();
  const adopt = (handle: FileHandle): number => {
    handles.set(handle.fd, handle);
    return handle.fd;
  };
  const closeFd = async (fd: number): Promise<void> => {
    const handle = handles.get(fd);
    if (handle) {
      handles.delete(fd);
      await handle.close();
      return;
    }
    throw new Error(`Unknown confined descriptor ${fd}`);
  };
  return {
    async openRoot(path, flags) {
      return adopt(await open(path, flags));
    },
    async openat(dirfd, name, flags) {
      assertComponent(name);
      return adopt(await open(linuxDescriptorPath(dirfd, name), flags));
    },
    async dup(fd, flags) {
      return adopt(await open(linuxDescriptorPath(fd), flags));
    },
    async close(fd) {
      await closeFd(fd);
    },
    async fstat(fd) {
      const handle = handles.get(fd);
      if (!handle) throw new Error(`Unknown confined descriptor ${fd}`);
      return toConfinementStat(await handle.stat({ bigint: true }));
    },
    async canonicalPath(fd) {
      return await realpath(linuxDescriptorPath(fd));
    },
    async readFile(fd, size) {
      const handle = handles.get(fd);
      if (!handle) throw new Error(`Unknown confined descriptor ${fd}`);
      if (size === 0) return Buffer.alloc(0);
      const bytes = await handle.readFile();
      return bytes.byteLength > size ? bytes.subarray(0, size) : bytes;
    },
    async *iterateDirents(fd) {
      const directory = await opendir(linuxDescriptorPath(fd));
      try {
        for await (const dirent of directory) {
          yield {
            isDirectory: dirent.isDirectory(),
            isFile: dirent.isFile(),
            isSymbolicLink: dirent.isSymbolicLink(),
            name: dirent.name,
          };
        }
      } finally {
        await directory.close().catch(() => undefined);
      }
    },
    gitStatusAt(dirfd, args, options) {
      return spawnGitAtPath(linuxDescriptorPath(dirfd), args, options);
    },
  };
}
export function createNativeOpenatPrimitive(
  addon: NativeFilesAddon,
): OpenatPrimitive {
  return {
    async openRoot(path, flags) {
      return addon.open(path, flags);
    },
    async openat(dirfd, name, flags) {
      assertComponent(name);
      return addon.openat(dirfd, name, flags);
    },
    async dup(fd) {
      return addon.dup(fd);
    },
    async close(fd) {
      addon.close(fd);
    },
    async fstat(fd) {
      return toConfinementStat(await fstatOpenedFd(fd));
    },
    async canonicalPath(fd) {
      return addon.canonicalPath(fd);
    },
    async readFile(fd, size) {
      return await readOpenedFd(fd, size);
    },
    async *iterateDirents(fd) {
      const dirId = addon.dirOpen(fd);
      try {
        for (;;) {
          const entry = addon.dirRead(dirId);
          if (entry === null) break;
          yield entry;
        }
      } finally {
        addon.dirClose(dirId);
      }
    },
    async gitStatusAt(dirfd, args, options) {
      const started = addon.gitStatusAt(
        dirfd,
        resolveTrustedGit(),
        args,
        options.timeoutMs,
        options.maxBytes,
        scrubbedGitEnvPairs(),
      );
      const onAbort = () => addon.cancelGit(started.id);
      options.signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (options.signal.aborted) {
          addon.cancelGit(started.id);
          throw new NativeFileHostError(
            "native_file_operation_cancelled",
            "Git operation cancelled",
          );
        }
        const result = await started.promise;
        if (options.signal.aborted) {
          throw new NativeFileHostError(
            "native_file_operation_cancelled",
            "Git operation cancelled",
          );
        }
        return result;
      } catch (error) {
        if (options.signal.aborted) {
          throw new NativeFileHostError(
            "native_file_operation_cancelled",
            "Git operation cancelled",
          );
        }
        throw error;
      } finally {
        options.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
export function createOpenatPrimitive(
  dependencies: ConfinementDependencies = {},
): OpenatPrimitive {
  if (dependencies.primitive) return dependencies.primitive;
  const platform = dependencies.platform ?? process.platform;
  const addon =
    dependencies.nativeAddon === undefined
      ? loadNativeFilesAddon()
      : dependencies.nativeAddon;
  if (addon) return createNativeOpenatPrimitive(addon);
  confinementUnavailable(platform);
}
export async function openRelativePath(
  primitive: OpenatPrimitive,
  rootFd: number,
  relativePath: string,
  kind: "file" | "directory",
): Promise<{
  fd: number;
  parents: number[];
}> {
  assertRelativePath(relativePath, kind === "directory");
  const segments = relativePath === "" ? [] : relativePath.split("/");
  const parents: number[] = [];
  let parent = rootFd;
  try {
    if (segments.length === 0) {
      return {
        fd: await primitive.dup(rootFd, OPEN_DIRECTORY_FLAGS),
        parents,
      };
    }
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === undefined) throw new Error("Missing path segment");
      const final = index === segments.length - 1;
      const flags =
        final && kind === "file" ? OPEN_FILE_FLAGS : OPEN_DIRECTORY_FLAGS;
      const child = await primitive.openat(parent, segment, flags);
      if (parent !== rootFd) parents.push(parent);
      parent = child;
    }
    const stat = await primitive.fstat(parent);
    if (
      (kind === "file" && !stat.isFile) ||
      (kind === "directory" && !stat.isDirectory)
    ) {
      await primitive.close(parent);
      throw new NativeFileHostError(
        "native_file_invalid_path",
        kind === "file"
          ? "Path is not a regular file"
          : "Path is not a directory",
      );
    }
    return { fd: parent, parents };
  } catch (error) {
    if (parent !== rootFd && !parents.includes(parent)) {
      await primitive.close(parent).catch(() => undefined);
    }
    await Promise.all(
      parents.map((fd) => primitive.close(fd).catch(() => undefined)),
    );
    remapFilesystemError(error);
  }
}
export async function closeOpenedPath(
  primitive: OpenatPrimitive,
  opened: {
    fd: number;
    parents: number[];
  },
): Promise<void> {
  await primitive.close(opened.fd).catch(() => undefined);
  await Promise.all(
    opened.parents.map((fd) => primitive.close(fd).catch(() => undefined)),
  );
}
