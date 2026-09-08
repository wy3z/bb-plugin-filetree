import { z } from "zod";
import type { NativeFileEntry, NativeFileGitChange } from "../contracts/model";
import type { NativeFileRoot } from "../contracts/api";
export const NATIVE_FILES_CLIENT_STATE_VERSION = 1;
export const NATIVE_FILES_CLIENT_STATE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const NATIVE_FILES_STATE_MAX_BYTES = 64 * 1024;
export const NATIVE_FILES_STATE_MAX_EXPANDED_PATHS = 512;
export type NativeFilesEntry = NativeFileEntry;
export type NativeFilesGitChange = NativeFileGitChange;
export type NativeFilesRoot = NativeFileRoot;
export interface NativeFilesSelection {
  path: string;
  root: NativeFilesRoot;
}
export interface NativeFilesPersistedRootState {
  expandedPaths: readonly string[];
  rootId: string;
  savedAtMs: number;
  searchQuery: string;
  selectedPath: string | null;
  scrollTop: number;
  threadId: string;
  version: typeof NATIVE_FILES_CLIENT_STATE_VERSION;
}
export interface NativeFilesCompactChain {
  label: string;
  segmentPaths: readonly string[];
  targetPath: string;
}
export const nativeFilesPersistedRootChoiceSchema = z
  .object({
    rootId: z.string().min(1).max(500),
    savedAtMs: z.number().int().nonnegative(),
    threadId: z.string().min(1).max(200),
    version: z.literal(NATIVE_FILES_CLIENT_STATE_VERSION),
  })
  .strict();
export const nativeFilesPersistedRootStateSchema = z
  .object({
    expandedPaths: z
      .array(z.string())
      .max(NATIVE_FILES_STATE_MAX_EXPANDED_PATHS),
    rootId: z.string().min(1).max(500),
    savedAtMs: z.number().int().nonnegative(),
    searchQuery: z.string().max(200),
    selectedPath: z.string().nullable(),
    scrollTop: z.number().nonnegative(),
    threadId: z.string().min(1).max(200),
    version: z.literal(NATIVE_FILES_CLIENT_STATE_VERSION),
  })
  .strict();
