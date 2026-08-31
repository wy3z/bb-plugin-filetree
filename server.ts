import path from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  filetreeHostContract,
  filetreeRpcContract,
  type WorkspaceContext,
} from "./contract.js";

interface ResolvedWorkspace {
  environmentId: string;
  hostId: string;
  rootName: string;
  rootPath: string;
}

function workspaceBasename(rootPath: string): string {
  const api = path.win32.isAbsolute(rootPath) ? path.win32 : path.posix;
  return api.basename(rootPath) || rootPath;
}

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({ contract: filetreeHostContract });

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

    async search({ threadId, query, limit }) {
      const workspace = await requireWorkspace(threadId);
      return host.call(
        "search",
        { rootPath: workspace.rootPath, query, limit },
        { hostId: workspace.hostId },
      );
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
}
