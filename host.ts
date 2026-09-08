import { randomUUID } from "node:crypto";
import {
  experimental_defineHostEntry,
  type ExperimentalHostRpcContext,
  type ExperimentalHostWatchSubscription,
} from "@get-bb/plugin-sdk/host";
import { hostContract, hostSignals } from "./contracts/host.js";
import { NativeFileHostService } from "./host/service.js";
import { prepareNativeAddon } from "./host/native-addon.js";
export function createFilesHostEntry() {
  const service = new NativeFileHostService();
  const watches = new Map<
    string,
    {
      expires: number;
      subscription: Promise<ExperimentalHostWatchSubscription>;
    }
  >();
  async function prune() {
    for (const [id, value] of watches) {
      if (value.expires > Date.now()) continue;
      watches.delete(id);
      await (await value.subscription).dispose();
    }
  }
  const timer = setInterval(() => {
    void prune().catch(() => undefined);
  }, 30000);
  timer.unref();
  async function bound<T>(
    rootPath: string,
    context: ExperimentalHostRpcContext<typeof hostSignals>,
    run: (bindingId: string, operationId: string) => Promise<T>,
  ) {
    context.signal.throwIfAborted();
    await prepareNativeAddon(context.experimental_paths.tempDir);
    const { rootBindingId } = await service.bindRoot(rootPath);
    const operationId = randomUUID();
    const abort = () => service.cancel(operationId);
    context.signal.addEventListener("abort", abort, { once: true });
    try {
      context.signal.throwIfAborted();
      const result = await run(rootBindingId, operationId);
      context.signal.throwIfAborted();
      return result;
    } finally {
      context.signal.removeEventListener("abort", abort);
      await service.releaseRoot(rootBindingId);
    }
  }
  return experimental_defineHostEntry({
    contract: hostContract,
    experimental_signals: hostSignals,
    handlers: {
      directory: (input, ctx) =>
        bound(input.rootPath, ctx, (id) =>
          service.listDirectory(id, input.path),
        ),
      search: (input, ctx) =>
        bound(input.rootPath, ctx, (id, op) =>
          service.search(id, input.query, input.limit, op),
        ),
      gitStatus: (input, ctx) =>
        bound(input.rootPath, ctx, (id, op) => service.gitStatus(id, op)),
      watch: async ({ rootPath, threadId, rootId }, ctx) => {
        const key = JSON.stringify([threadId, rootId, rootPath]);
        const existing = watches.get(key);
        if (existing) {
          existing.expires = Date.now() + 75000;
          await existing.subscription;
          return { watching: true };
        }
        if (watches.size >= 100) throw new Error("Too many open Files watches");
        const subscription = ctx.experimental_watch(
          {
            rootPath,
            ignoredPaths: [".git/objects", "node_modules"],
            debounceMs: 150,
            maxWaitMs: 1000,
          },
          async () => {
            await ctx.experimental_emitSignal("changed", { threadId, rootId });
          },
        );
        watches.set(key, { expires: Date.now() + 75000, subscription });
        try {
          await subscription;
        } catch (error) {
          watches.delete(key);
          throw error;
        }
        return { watching: true };
      },
    },
    dispose: async () => {
      clearInterval(timer);
      await Promise.allSettled(
        [...watches.values()].map(async (value) =>
          (await value.subscription).dispose(),
        ),
      );
      watches.clear();
      await service.dispose();
    },
  });
}
export default createFilesHostEntry();
