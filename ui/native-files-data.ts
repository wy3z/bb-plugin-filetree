import type {
  NativeFileGitStatusResponse,
  NativeFileListDirectoryResponse,
  NativeFileRootsResponse,
  NativeFileSearchResponse,
  NativeFileTransferResponse,
} from "../contracts/api";
interface NativeFilesThreadRequest {
  signal: AbortSignal;
  threadId: string;
}
interface NativeFilesRootRequest extends NativeFilesThreadRequest {
  rootId: string;
}
interface NativeFilesPathRequest extends NativeFilesRootRequest {
  path: string;
}
export interface NativeFilesSearchRequest extends NativeFilesRootRequest {
  limit: number;
  query: string;
}
export interface NativeFilesInvalidation {
  rootIds: readonly string[] | null;
}
export interface NativeFilesData {
  listRoots(
    request: NativeFilesThreadRequest,
  ): Promise<NativeFileRootsResponse>;
  listDirectory(
    request: NativeFilesPathRequest,
  ): Promise<NativeFileListDirectoryResponse>;
  search(request: NativeFilesSearchRequest): Promise<NativeFileSearchResponse>;
  createTransfer(
    request: NativeFilesPathRequest,
  ): Promise<NativeFileTransferResponse>;
  gitStatus(
    request: NativeFilesRootRequest,
  ): Promise<NativeFileGitStatusResponse>;
  subscribe(
    threadId: string,
    listener: (invalidation: NativeFilesInvalidation) => void,
  ): () => void;
}
