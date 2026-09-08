import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import * as api from "./api.js";
export const rpcContract = defineRpcContract({
  roots: {
    input: api.nativeFileRootsRequestSchema,
    output: api.nativeFileRootsResponseSchema,
  },
  directory: {
    input: api.nativeFileListDirectoryRequestSchema,
    output: api.nativeFileListDirectoryResponseSchema,
  },
  search: {
    input: api.nativeFileSearchRequestSchema,
    output: api.nativeFileSearchResponseSchema,
  },
  gitStatus: {
    input: api.nativeFileGitStatusRequestSchema,
    output: api.nativeFileGitStatusResponseSchema,
  },
  transfer: {
    input: api.nativeFileCreateTransferRequestSchema,
    output: api.nativeFileTransferResponseSchema,
  },
  cancel: {
    input: api.nativeFileCancelOperationRequestSchema,
    output: api.nativeFileCancelOperationResponseSchema,
  },
  watch: {
    input: api.nativeFileRootsRequestSchema,
    output: z
      .object({ watching: z.boolean(), rootIds: z.array(z.string()) })
      .strict(),
  },
});
