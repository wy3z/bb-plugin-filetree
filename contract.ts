import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const fileTreeEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    kind: z.enum(["file", "directory"]),
  })
  .strict();

export type FileTreeEntry = z.infer<typeof fileTreeEntrySchema>;

const directoryListingSchema = z
  .object({
    entries: z.array(fileTreeEntrySchema),
    truncated: z.boolean(),
  })
  .strict();

export const workspaceContextSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      environmentId: z.string(),
      rootName: z.string(),
      rootPath: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      reason: z.string(),
    })
    .strict(),
]);

export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;

export const filePreviewSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      content: z.string(),
      modifiedAtMs: z.number(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unsupported"),
      reason: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
]);

export type FilePreview = z.infer<typeof filePreviewSchema>;

export const workspaceWatchChangeSchema = z
  .object({
    path: z.string(),
    type: z.enum(["create", "update", "delete"]),
  })
  .strict();

export const workspaceWatchEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("changed"),
      changes: z.array(workspaceWatchChangeSchema),
    })
    .strict(),
  z.object({ kind: z.literal("rescan-required") }).strict(),
  z
    .object({
      kind: z.literal("watch-error"),
      message: z.string(),
    })
    .strict(),
]);

export type WorkspaceWatchEvent = z.infer<typeof workspaceWatchEventSchema>;

export const filetreeHostSignals = {
  workspaceChanged: {
    payload: z
      .object({
        watchId: z.string().min(1).max(200),
        event: workspaceWatchEventSchema,
      })
      .strict(),
  },
} as const;

const threadPathSchema = z
  .object({
    threadId: z.string().min(1),
    path: z.string(),
  })
  .strict();

const searchSchema = z
  .object({
    threadId: z.string().min(1),
    scopeId: z.string().min(1).max(200),
    searchId: z.string().min(1).max(200),
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(200),
  })
  .strict();

const watchSchema = z
  .object({
    threadId: z.string().min(1),
    watchId: z.string().min(1).max(200),
  })
  .strict();

export const filetreeRpcContract = defineRpcContract({
  workspace: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: workspaceContextSchema,
  },
  listDirectory: {
    input: threadPathSchema,
    output: directoryListingSchema,
  },
  search: {
    input: searchSchema,
    output: z
      .object({
        matches: z.array(fileTreeEntrySchema),
        truncated: z.boolean(),
      })
      .strict(),
  },
  cancelSearch: {
    input: z
      .object({
        threadId: z.string().min(1),
        searchId: z.string().min(1).max(200),
      })
      .strict(),
    output: z.object({ cancelled: z.boolean() }).strict(),
  },
  startWatch: {
    input: watchSchema,
    output: z.object({ started: z.boolean() }).strict(),
  },
  stopWatch: {
    input: watchSchema,
    output: z.object({ stopped: z.boolean() }).strict(),
  },
  readFile: {
    input: threadPathSchema,
    output: filePreviewSchema,
  },
});

export const filetreeHostContract = defineRpcContract({
  listDirectory: {
    input: z
      .object({
        rootPath: z.string().min(1),
        relativePath: z.string(),
      })
      .strict(),
    output: directoryListingSchema,
  },
  search: {
    input: z
      .object({
        rootPath: z.string().min(1),
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(200),
      })
      .strict(),
    output: z
      .object({
        matches: z.array(fileTreeEntrySchema),
        truncated: z.boolean(),
      })
      .strict(),
  },
  startWatch: {
    input: z
      .object({
        rootPath: z.string().min(1),
        watchId: z.string().min(1).max(200),
      })
      .strict(),
    output: z.object({ started: z.boolean() }).strict(),
  },
  stopWatch: {
    input: z.object({ watchId: z.string().min(1).max(200) }).strict(),
    output: z.object({ stopped: z.boolean() }).strict(),
  },
  readFile: {
    input: z
      .object({
        rootPath: z.string().min(1),
        relativePath: z.string().min(1),
      })
      .strict(),
    output: filePreviewSchema,
  },
});
