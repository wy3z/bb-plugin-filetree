import path from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  filetreeHostContract,
  filetreeHostSignals,
  filetreeRpcContract,
  type WorkspaceContext,
} from "./contract.js";

interface ResolvedWorkspace {
  environmentId: string;
  hostId: string;
  rootName: string;
  rootPath: string;
}

interface ActiveSearch {
  threadId: string;
  scopeId: string;
  controller: AbortController;
}

interface ActiveWatch {
  threadId: string;
  hostId: string;
}

const EARLY_CANCEL_TTL_MS = 30_000;

function workspaceBasename(rootPath: string): string {
  const api = path.win32.isAbsolute(rootPath) ? path.win32 : path.posix;
  return api.basename(rootPath) || rootPath;
}

function watchChannel(watchId: string): string {
  return `workspace-watch:${watchId}`;
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: filetreeHostContract,
    experimental_signals: filetreeHostSignals,
  });
  const activeSearches = new Map<string, ActiveSearch>();
  const activeSearchByScope = new Map<string, string>();
  const earlyCancelledSearches = new Map<string, NodeJS.Timeout>();
  const activeWatches = new Map<string, ActiveWatch>();

  function rememberEarlyCancellation(searchId: string): void {
    const existing = earlyCancelledSearches.get(searchId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(
      () => earlyCancelledSearches.delete(searchId),
      EARLY_CANCEL_TTL_MS,
    );
    timer.unref?.();
    earlyCancelledSearches.set(searchId, timer);
  }

  function consumeEarlyCancellation(searchId: string): boolean {
    const timer = earlyCancelledSearches.get(searchId);
    if (timer === undefined) return false;
    clearTimeout(timer);
    earlyCancelledSearches.delete(searchId);
    return true;
  }

  async function resolveWorkspace(
    threadId: string,
  ): Promise<ResolvedWorkspace | null> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) return null;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.path === null || environment.hostId === null) return null;
    return {
      environmentId: environment.id,
      hostId: environment.hostId,
      rootName: workspaceBasename(environment.path),
      rootPath: environment.path,
    };
  }

  async function workspaceContext(threadId: string): Promise<WorkspaceContext> {
    const workspace = await resolveWorkspace(threadId);
    return workspace === null
      ? {
          kind: "unavailable",
          reason: "This thread does not have an active workspace.",
        }
      : {
          kind: "ready",
          environmentId: workspace.environmentId,
          rootName: workspace.rootName,
          rootPath: workspace.rootPath,
        };
  }

  async function requireWorkspace(threadId: string): Promise<ResolvedWorkspace> {
    const workspace = await resolveWorkspace(threadId);
    if (workspace === null) {
      throw new Error("This thread does not have an active workspace.");
    }
    return workspace;
  }

  const unsubscribeWatchSignals = host.experimental_onSignal(
    "workspaceChanged",
    ({ hostId, payload }) => {
      const active = activeWatches.get(payload.watchId);
      if (active === undefined || active.hostId !== hostId) return;
      bb.realtime.publish(watchChannel(payload.watchId), payload.event);
    },
  );

  const unsubscribeWorkerExit = host.experimental_onWorkerExit(({ hostId }) => {
    for (const [watchId, active] of activeWatches) {
      if (active.hostId !== hostId) continue;
      activeWatches.delete(watchId);
      bb.realtime.publish(watchChannel(watchId), {
        kind: "watch-error",
        message: "Workspace watcher stopped unexpectedly.",
      });
    }
  });

  bb.rpc.register(filetreeRpcContract, {
    workspace: ({ threadId }) => workspaceContext(threadId),

    async listDirectory({ threadId, path: relativePath }) {
      const workspace = await requireWorkspace(threadId);
      return host.call(
        "listDirectory",
        { rootPath: workspace.rootPath, relativePath },
        { hostId: workspace.hostId },
      );
    },

    async search({ threadId, scopeId, searchId, query, limit }) {
      if (consumeEarlyCancellation(searchId)) {
        throw new Error("Search cancelled");
      }

      const previousSearchId = activeSearchByScope.get(scopeId);
      if (previousSearchId !== undefined && previousSearchId !== searchId) {
        activeSearches
          .get(previousSearchId)
          ?.controller.abort(new Error("Search superseded"));
      }

      const controller = new AbortController();
      activeSearches.set(searchId, { threadId, scopeId, controller });
      activeSearchByScope.set(scopeId, searchId);

      try {
        const workspace = await requireWorkspace(threadId);
        if (consumeEarlyCancellation(searchId)) {
          controller.abort(new Error("Search cancelled"));
        }
        if (controller.signal.aborted) {
          throw controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new Error("Search cancelled");
        }
        return await host.call(
          "search",
          { rootPath: workspace.rootPath, query, limit },
          { hostId: workspace.hostId, signal: controller.signal },
        );
      } finally {
        activeSearches.delete(searchId);
        if (activeSearchByScope.get(scopeId) === searchId) {
          activeSearchByScope.delete(scopeId);
        }
      }
    },

    cancelSearch({ threadId, searchId }) {
      const active = activeSearches.get(searchId);
      if (active?.threadId === threadId) {
        active.controller.abort(new Error("Search cancelled"));
        return { cancelled: true };
      }
      rememberEarlyCancellation(searchId);
      return { cancelled: false };
    },

    async startWatch({ threadId, watchId }) {
      const workspace = await requireWorkspace(threadId);
      const existing = activeWatches.get(watchId);
      if (existing !== undefined) {
        activeWatches.delete(watchId);
        try {
          await host.call(
            "stopWatch",
            { watchId },
            { hostId: existing.hostId },
          );
        } catch {}
      }

      activeWatches.set(watchId, {
        threadId,
        hostId: workspace.hostId,
      });
      try {
        await host.call(
          "startWatch",
          { rootPath: workspace.rootPath, watchId },
          { hostId: workspace.hostId },
        );
        return { started: true };
      } catch (error) {
        if (activeWatches.get(watchId)?.threadId === threadId) {
          activeWatches.delete(watchId);
        }
        throw error;
      }
    },

    async stopWatch({ threadId, watchId }) {
      const active = activeWatches.get(watchId);
      if (active === undefined || active.threadId !== threadId) {
        return { stopped: false };
      }
      activeWatches.delete(watchId);
      try {
        return await host.call(
          "stopWatch",
          { watchId },
          { hostId: active.hostId },
        );
      } catch {
        return { stopped: false };
      }
    },

    async readFile({ threadId, path: relativePath }) {
      const workspace = await requireWorkspace(threadId);
      return host.call(
        "readFile",
        { rootPath: workspace.rootPath, relativePath },
        { hostId: workspace.hostId },
      );
    },
  });

  bb.onDispose(async () => {
    unsubscribeWatchSignals();
    unsubscribeWorkerExit();

    for (const active of activeSearches.values()) {
      active.controller.abort(new Error("Plugin disposed"));
    }
    activeSearches.clear();
    activeSearchByScope.clear();
    for (const timer of earlyCancelledSearches.values()) clearTimeout(timer);
    earlyCancelledSearches.clear();

    const watches = [...activeWatches.entries()];
    activeWatches.clear();
    await Promise.allSettled(
      watches.map(([watchId, active]) =>
        host.call("stopWatch", { watchId }, { hostId: active.hostId }),
      ),
    );
  });
}
