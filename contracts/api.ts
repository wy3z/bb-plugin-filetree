import { z } from "zod";
import {
  NATIVE_FILE_ROOT_LIMIT,
  NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH,
  NATIVE_FILE_SEARCH_RESULT_LIMIT,
  NATIVE_FILE_ROOT_PATH_MAX_LENGTH,
  NATIVE_FILE_TRANSFER_MAX_BYTES,
  nativeFileDirectoryResultSchema,
  nativeFileGitNotRepositoryResultSchema,
  nativeFileGitReadyResultSchema,
  nativeFileGitUnavailableResultSchema,
  nativeFileOperationIdSchema,
  nativeFilePathSchema,
  nativeFileRelativePathSchema,
  nativeFileRootIdSchema,
  nativeFileSearchResultSchema,
} from "./model.js";
export {
  NATIVE_FILE_DIRECTORY_ENTRY_LIMIT,
  NATIVE_FILE_GIT_ENTRY_LIMIT,
  NATIVE_FILE_ROOT_LIMIT,
  NATIVE_FILE_SEARCH_RESULT_LIMIT,
  NATIVE_FILE_SNAPSHOT_CONTENT_MAX_LENGTH,
  NATIVE_FILE_TEXT_PREVIEW_MAX_BYTES,
  NATIVE_FILE_TRANSFER_MAX_BYTES,
  NATIVE_FILE_TRANSFER_TTL_MS,
} from "./model.js";
const nativeFileThreadIdSchema = z.string().min(1).max(200);
const nativeFileRootPathSchema = z
  .string()
  .min(1)
  .max(NATIVE_FILE_ROOT_PATH_MAX_LENGTH)
  .startsWith("/");
export const nativeFileRootReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      environmentId: z.string().min(1).max(200),
      kind: z.literal("environment"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("project-source"),
      projectId: z.string().min(1).max(200),
      sourceId: z.string().min(1).max(200),
    })
    .strict(),
]);
export type NativeFileRootReference = z.infer<
  typeof nativeFileRootReferenceSchema
>;
export const nativeFileNavigationRootSchema = z.discriminatedUnion("kind", [
  z
    .object({
      environmentId: z.string().min(1).max(200),
      kind: z.literal("workspace"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("project-source"),
      projectId: z.string().min(1).max(200),
      sourceId: z.string().min(1).max(200),
    })
    .strict(),
]);
export type NativeFileNavigationRoot = z.infer<
  typeof nativeFileNavigationRootSchema
>;
export const nativeFileRootSchema = z
  .object({
    gitCapability: z.enum(["known-git", "known-non-git", "unknown"]),
    hostId: z.string().min(1).max(200),
    isActiveEnvironment: z.boolean(),
    label: z.string().min(1).max(500),
    navigationRoot: nativeFileNavigationRootSchema,
    projectId: z.string().min(1).max(200),
    reference: nativeFileRootReferenceSchema,
    rootId: nativeFileRootIdSchema,
    rootPath: nativeFileRootPathSchema,
  })
  .strict()
  .superRefine((root, context) => {
    if (root.reference.kind === "environment") {
      if (
        !root.isActiveEnvironment ||
        root.navigationRoot.kind !== "workspace" ||
        root.navigationRoot.environmentId !== root.reference.environmentId
      ) {
        context.addIssue({
          code: "custom",
          message: "Environment root identity is inconsistent",
        });
      }
      return;
    }
    if (
      root.isActiveEnvironment ||
      root.reference.projectId !== root.projectId ||
      root.navigationRoot.kind !== "project-source" ||
      root.navigationRoot.projectId !== root.projectId ||
      root.navigationRoot.sourceId !== root.reference.sourceId
    ) {
      context.addIssue({
        code: "custom",
        message: "Project source root identity is inconsistent",
      });
    }
  });
export type NativeFileRoot = z.infer<typeof nativeFileRootSchema>;
export const nativeFileRootsRequestSchema = z
  .object({ threadId: nativeFileThreadIdSchema })
  .strict();
export type NativeFileRootsRequest = z.infer<
  typeof nativeFileRootsRequestSchema
>;
export const nativeFileRootsResponseSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        activeRootId: nativeFileRootIdSchema,
        kind: z.literal("ready"),
        roots: z.array(nativeFileRootSchema).min(1).max(NATIVE_FILE_ROOT_LIMIT),
        threadId: nativeFileThreadIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("unavailable"),
        reason: z.string().min(1).max(1000),
        threadId: nativeFileThreadIdSchema,
      })
      .strict(),
  ])
  .superRefine((response, context) => {
    if (
      response.kind === "ready" &&
      !response.roots.some(
        (root) =>
          root.rootId === response.activeRootId && root.isActiveEnvironment,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Active root identity is missing",
      });
    }
  });
export type NativeFileRootsResponse = z.infer<
  typeof nativeFileRootsResponseSchema
>;
const nativeFileRootRequestFields = {
  rootId: nativeFileRootIdSchema,
  threadId: nativeFileThreadIdSchema,
} as const;
export const nativeFileListDirectoryRequestSchema = z
  .object({
    ...nativeFileRootRequestFields,
    path: nativeFileRelativePathSchema,
  })
  .strict();
export type NativeFileListDirectoryRequest = z.infer<
  typeof nativeFileListDirectoryRequestSchema
>;
export const nativeFileListDirectoryResponseSchema =
  nativeFileDirectoryResultSchema
    .extend({
      path: nativeFileRelativePathSchema,
      rootId: nativeFileRootIdSchema,
    })
    .strict();
export type NativeFileListDirectoryResponse = z.infer<
  typeof nativeFileListDirectoryResponseSchema
>;
export const nativeFileSearchRequestSchema = z
  .object({
    ...nativeFileRootRequestFields,
    limit: z.number().int().min(1).max(NATIVE_FILE_SEARCH_RESULT_LIMIT),
    operationId: nativeFileOperationIdSchema,
    query: z.string().trim().min(1).max(NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH),
  })
  .strict();
export type NativeFileSearchRequest = z.infer<
  typeof nativeFileSearchRequestSchema
>;
export const nativeFileSearchResponseSchema = nativeFileSearchResultSchema
  .extend({ rootId: nativeFileRootIdSchema })
  .strict();
export type NativeFileSearchResponse = z.infer<
  typeof nativeFileSearchResponseSchema
>;
export const nativeFileReadRequestSchema = z
  .object({
    ...nativeFileRootRequestFields,
    path: nativeFilePathSchema,
  })
  .strict();
export const nativeFileCreateTransferRequestSchema = nativeFileReadRequestSchema
  .extend({ operationId: nativeFileOperationIdSchema })
  .strict();
export type NativeFileCreateTransferRequest = z.infer<
  typeof nativeFileCreateTransferRequestSchema
>;
export const nativeFileTransferResponseSchema = z
  .object({
    contentUrl: z.string().min(1).max(4096),
    expiresAtMs: z.number().int().nonnegative(),
    filename: z.string().min(1).max(1024),
    mimeType: z.string().min(1).max(500),
    modifiedAtMs: z.number().nonnegative().nullable(),
    path: nativeFilePathSchema,
    rootId: nativeFileRootIdSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(NATIVE_FILE_TRANSFER_MAX_BYTES),
  })
  .strict();
export type NativeFileTransferResponse = z.infer<
  typeof nativeFileTransferResponseSchema
>;
export const nativeFileGitStatusRequestSchema = z
  .object({
    ...nativeFileRootRequestFields,
    operationId: nativeFileOperationIdSchema,
  })
  .strict();
export type NativeFileGitStatusRequest = z.infer<
  typeof nativeFileGitStatusRequestSchema
>;
export const nativeFileGitStatusResponseSchema = z.discriminatedUnion("kind", [
  nativeFileGitReadyResultSchema
    .extend({ rootId: nativeFileRootIdSchema })
    .strict(),
  nativeFileGitNotRepositoryResultSchema
    .extend({ rootId: nativeFileRootIdSchema })
    .strict(),
  nativeFileGitUnavailableResultSchema
    .extend({ rootId: nativeFileRootIdSchema })
    .strict(),
]);
export type NativeFileGitStatusResponse = z.infer<
  typeof nativeFileGitStatusResponseSchema
>;
export const nativeFileCancelOperationRequestSchema = z
  .object({
    ...nativeFileRootRequestFields,
    operationId: nativeFileOperationIdSchema,
  })
  .strict();
export type NativeFileCancelOperationRequest = z.infer<
  typeof nativeFileCancelOperationRequestSchema
>;
export const nativeFileCancelOperationResponseSchema = z
  .object({ cancelled: z.boolean() })
  .strict();
export type NativeFileCancelOperationResponse = z.infer<
  typeof nativeFileCancelOperationResponseSchema
>;
