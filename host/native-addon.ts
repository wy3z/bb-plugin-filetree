import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { nativeAssets } from "../generated/native-assets.js";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export interface NativeAddonStat {
  device: string;
  inode: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  mtimeMs: number;
  size: number;
}
export interface NativeAddonDirent {
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  name: string;
}
export interface NativeAddonGitResult {
  code: number;
  stderr: Buffer;
  stdout: Buffer;
}
export interface NativeFilesAddon {
  cancelGit(id: number): void;
  canonicalPath(fd: number): string;
  close(fd: number): void;
  dirClose(dirId: number): void;
  dirOpen(fd: number): number;
  dirRead(dirId: number): NativeAddonDirent | null;
  dup(fd: number): number;
  gitStatusAt(
    dirfd: number,
    file: string,
    args: string[],
    timeoutMs: number,
    maxBytes: number,
    env: string[],
  ): {
    id: number;
    promise: Promise<NativeAddonGitResult>;
  };
  open(path: string, flags: number): number;
  openat(dirfd: number, name: string, flags: number): number;
  supportsOpenat2(): boolean;
}
const here = dirname(fileURLToPath(import.meta.url));
const ADDON_CANDIDATES = [
  join(here, "native", "build", "Release", "host_native_files.node"),
  join(here, "native", "build", "Debug", "host_native_files.node"),
  join(here, "host_native_files.node"),
  join(here, "..", "..", "..", "dist", "host_native_files.node"),
];
export function nativeFilesAddonCandidates(): readonly string[] {
  return ADDON_CANDIDATES;
}
export function loadNativeFilesAddon(): NativeFilesAddon | null {
  const require = createRequire(import.meta.url);
  for (const candidate of ADDON_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    try {
      return require(candidate) as NativeFilesAddon;
    } catch {
      continue;
    }
  }
  return null;
}
let prepared: Promise<void> | null = null;
export function prepareNativeAddon(tempDir: string): Promise<void> {
  prepared ??= (async () => {
    const asset = nativeAssets[`${process.platform}-${process.arch}`];
    if (!asset)
      throw new Error(
        `Files has no native addon for ${process.platform}-${process.arch}. Build the plugin for this host platform.`,
      );
    const bytes = Buffer.from(asset.base64, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
      throw new Error("Files native addon digest mismatch");
    const target = join(tempDir, `files-${asset.sha256}.node`);
    await writeFile(target, bytes, { mode: 0o600 });
    ADDON_CANDIDATES.unshift(target);
    if (loadNativeFilesAddon() === null)
      throw new Error("Files native addon cannot load on this host");
  })();
  return prepared;
}
