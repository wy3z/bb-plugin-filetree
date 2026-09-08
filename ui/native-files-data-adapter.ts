import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contracts/rpc.js";
import type {
  NativeFilesData,
  NativeFilesInvalidation,
} from "./native-files-data.js";
export function createFilesData(rpc: PluginRpcClient<typeof rpcContract>) {
  const listeners = new Map<
    string,
    Set<(event: NativeFilesInvalidation) => void>
  >();
  async function cancellable<T>(
    request: {
      threadId: string;
      rootId: string;
      signal: AbortSignal;
    },
    run: (operationId: string) => Promise<T>,
  ): Promise<T> {
    request.signal.throwIfAborted();
    const operationId = crypto.randomUUID();
    const cancel = () => {
      void rpc
        .call("cancel", {
          threadId: request.threadId,
          rootId: request.rootId,
          operationId,
        })
        .catch(() => undefined);
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await run(operationId);
      request.signal.throwIfAborted();
      return result;
    } finally {
      request.signal.removeEventListener("abort", cancel);
    }
  }
  const data: NativeFilesData = {
    listRoots: ({ threadId }) => rpc.call("roots", { threadId }),
    listDirectory: ({ threadId, rootId, path }) =>
      rpc.call("directory", { threadId, rootId, path }),
    createTransfer: (input) =>
      cancellable(input, (operationId) =>
        rpc.call("transfer", {
          threadId: input.threadId,
          rootId: input.rootId,
          path: input.path,
          operationId,
        }),
      ),
    search: (input) =>
      cancellable(input, (operationId) =>
        rpc.call("search", {
          threadId: input.threadId,
          rootId: input.rootId,
          query: input.query,
          limit: input.limit,
          operationId,
        }),
      ),
    gitStatus: (input) =>
      cancellable(input, (operationId) =>
        rpc.call("gitStatus", {
          threadId: input.threadId,
          rootId: input.rootId,
          operationId,
        }),
      ),
    subscribe: (threadId, listener) => {
      let set = listeners.get(threadId);
      if (!set) {
        set = new Set();
        listeners.set(threadId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(threadId);
      };
    },
  };
  return {
    data,
    changed(threadId: string, rootIds: readonly string[] | null) {
      for (const listener of listeners.get(threadId) ?? [])
        listener({ rootIds });
    },
  };
}
