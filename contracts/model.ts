import { z } from "zod";
export const NATIVE_FILE_ROOT_LIMIT = 100;
export const NATIVE_FILE_DIRECTORY_ENTRY_LIMIT = 1000;
export const NATIVE_FILE_SEARCH_RESULT_LIMIT = 200;
export const NATIVE_FILE_SEARCH_SCAN_LIMIT = 30000;
export const NATIVE_FILE_GIT_ENTRY_LIMIT = 5000;
export const NATIVE_FILE_TEXT_PREVIEW_MAX_BYTES = 4 * 1024 * 1024;
export const NATIVE_FILE_TRANSFER_MAX_BYTES = 25 * 1024 * 1024;
export const NATIVE_FILE_TRANSFER_TTL_MS = 5 * 60 * 1000;
export const NATIVE_FILE_SNAPSHOT_CONTENT_MAX_LENGTH =
  Math.ceil((NATIVE_FILE_TRANSFER_MAX_BYTES * 4) / 3) + 4;
export const NATIVE_FILE_RELATIVE_PATH_MAX_LENGTH = 4096;
export const NATIVE_FILE_ROOT_PATH_MAX_LENGTH = 8192;
export const NATIVE_FILE_OPERATION_ID_MAX_LENGTH = 200;
export const NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH = 200;
function isValidRelativePath(value: string, allowEmpty: boolean): boolean {
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    (!allowEmpty && value.length === 0)
  ) {
    return false;
  }
  if (value.length === 0) {
    return true;
  }
  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}
export const nativeFileRootIdSchema = z.string().min(1).max(500);
export type NativeFileRootId = z.infer<typeof nativeFileRootIdSchema>;
export const nativeFileOperationIdSchema = z
  .string()
  .min(1)
  .max(NATIVE_FILE_OPERATION_ID_MAX_LENGTH);
export type NativeFileOperationId = z.infer<typeof nativeFileOperationIdSchema>;
export const nativeFileRelativePathSchema = z
  .string()
  .max(NATIVE_FILE_RELATIVE_PATH_MAX_LENGTH)
  .refine((value) => isValidRelativePath(value, true), {
    message: "Path must be workspace-relative",
  });
export type NativeFileRelativePath = z.infer<
  typeof nativeFileRelativePathSchema
>;
export const nativeFilePathSchema = z
  .string()
  .min(1)
  .max(NATIVE_FILE_RELATIVE_PATH_MAX_LENGTH)
  .refine((value) => isValidRelativePath(value, false), {
    message: "Path must identify a workspace-relative entry",
  });
export type NativeFilePath = z.infer<typeof nativeFilePathSchema>;
export const nativeFileEntryKindSchema = z.enum(["file", "directory"]);
export type NativeFileEntryKind = z.infer<typeof nativeFileEntryKindSchema>;
export const nativeFileEntrySchema = z
  .object({
    kind: nativeFileEntryKindSchema,
    name: z.string().min(1).max(NATIVE_FILE_RELATIVE_PATH_MAX_LENGTH),
    path: nativeFilePathSchema,
  })
  .strict();
export type NativeFileEntry = z.infer<typeof nativeFileEntrySchema>;
export const nativeFileDirectoryResultSchema = z
  .object({
    entries: z
      .array(nativeFileEntrySchema)
      .max(NATIVE_FILE_DIRECTORY_ENTRY_LIMIT),
    truncated: z.boolean(),
  })
  .strict();
export type NativeFileDirectoryResult = z.infer<
  typeof nativeFileDirectoryResultSchema
>;
export const nativeFileSearchResultSchema = z
  .object({
    matches: z
      .array(nativeFileEntrySchema)
      .max(NATIVE_FILE_SEARCH_RESULT_LIMIT),
    truncated: z.boolean(),
  })
  .strict();
export type NativeFileSearchResult = z.infer<
  typeof nativeFileSearchResultSchema
>;
export const nativeFileContentEncodingSchema = z.enum(["base64", "utf8"]);
export type NativeFileContentEncoding = z.infer<
  typeof nativeFileContentEncodingSchema
>;
export const nativeFileSnapshotSchema = z
  .object({
    content: z.string().max(NATIVE_FILE_SNAPSHOT_CONTENT_MAX_LENGTH),
    contentEncoding: nativeFileContentEncodingSchema,
    mimeType: z.string().min(1).max(500),
    modifiedAtMs: z.number().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(NATIVE_FILE_TRANSFER_MAX_BYTES),
  })
  .strict();
export type NativeFileSnapshot = z.infer<typeof nativeFileSnapshotSchema>;
export const nativeFileGitStatusCodeSchema = z.enum([
  ".",
  "M",
  "T",
  "A",
  "D",
  "R",
  "C",
  "U",
  "?",
]);
export type NativeFileGitStatusCode = z.infer<
  typeof nativeFileGitStatusCodeSchema
>;
export const nativeFileGitChangeSchema = z
  .object({
    conflicted: z.boolean(),
    generated: z.boolean(),
    indexStatus: nativeFileGitStatusCodeSchema,
    path: nativeFilePathSchema,
    previousPath: nativeFilePathSchema.nullable(),
    worktreeStatus: nativeFileGitStatusCodeSchema,
  })
  .strict();
export type NativeFileGitChange = z.infer<typeof nativeFileGitChangeSchema>;
export const nativeFileGitReadyResultSchema = z
  .object({
    branch: z.string().max(1024).nullable(),
    changes: z
      .array(nativeFileGitChangeSchema)
      .max(NATIVE_FILE_GIT_ENTRY_LIMIT),
    headSha: z.string().max(128).nullable(),
    kind: z.literal("ready"),
    truncated: z.boolean(),
  })
  .strict();
export const nativeFileGitNotRepositoryResultSchema = z
  .object({
    kind: z.literal("not-repository"),
    reason: z.string().min(1).max(1000),
  })
  .strict();
export const nativeFileGitUnavailableResultSchema = z
  .object({
    kind: z.literal("unavailable"),
    reason: z.string().min(1).max(1000),
  })
  .strict();
export const nativeFileGitStatusResultSchema = z.discriminatedUnion("kind", [
  nativeFileGitReadyResultSchema,
  nativeFileGitNotRepositoryResultSchema,
  nativeFileGitUnavailableResultSchema,
]);
export type NativeFileGitStatusResult = z.infer<
  typeof nativeFileGitStatusResultSchema
>;
export const nativeFileWatchEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("changed") }).strict(),
  z.object({ kind: z.literal("rescan-required") }).strict(),
  z
    .object({
      kind: z.literal("watch-error"),
      message: z.string().min(1).max(1000),
    })
    .strict(),
]);
export type NativeFileWatchEvent = z.infer<typeof nativeFileWatchEventSchema>;
