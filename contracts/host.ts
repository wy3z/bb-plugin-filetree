import {
  defineRpcContract,
  type ExperimentalHostSignals,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  nativeFileDirectoryResultSchema,
  nativeFileSearchResultSchema,
  nativeFileGitStatusResultSchema,
  nativeFileRelativePathSchema,
} from "./model.js";
const rootPath = z.string().min(1).max(8192).startsWith("/");
const root = z.object({ rootPath }).strict();
export const hostContract = defineRpcContract({
  directory: {
    input: root.extend({ path: nativeFileRelativePathSchema }).strict(),
    output: nativeFileDirectoryResultSchema,
  },
  search: {
    input: root
      .extend({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(200),
      })
      .strict(),
    output: nativeFileSearchResultSchema,
  },
  gitStatus: { input: root, output: nativeFileGitStatusResultSchema },
  watch: {
    input: root
      .extend({
        threadId: z.string().min(1).max(200),
        rootId: z.string().min(1).max(500),
      })
      .strict(),
    output: z.object({ watching: z.boolean() }).strict(),
  },
});
export const hostSignals = {
  changed: {
    payload: z.object({ threadId: z.string(), rootId: z.string() }).strict(),
  },
} satisfies ExperimentalHostSignals;
