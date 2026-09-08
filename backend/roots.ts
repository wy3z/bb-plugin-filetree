import { createHash } from "node:crypto";
import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  NATIVE_FILE_ROOT_LIMIT,
  type NativeFileRoot,
  type NativeFileRootReference,
} from "../contracts/api.js";
function normalizedAbsolutePath(value: string): string | null {
  if (!path.posix.isAbsolute(value) || value.includes("\0")) return null;
  return path.posix.normalize(value);
}
function rootIdFor(root: {
  hostId: string;
  projectId: string;
  reference: NativeFileRootReference;
  rootPath: string;
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        reference: root.reference,
        projectId: root.projectId,
        hostId: root.hostId,
        rootPath: root.rootPath,
      }),
    )
    .digest("hex");
  return `files-v1-${digest}`;
}
function unavailable(threadId: string, reason: string) {
  return { kind: "unavailable" as const, reason, threadId };
}
export async function listAuthorizedNativeFileRoots(
  sdk: BbPluginApi["sdk"],
  threadId: string,
) {
  const thread = await sdk.threads.get({ threadId });
  if (!thread.environmentId) {
    return unavailable(
      threadId,
      "The thread does not have a workspace environment.",
    );
  }
  let environment;
  try {
    environment = await sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.status !== "ready" || environment.path === null)
      return unavailable(threadId, "The thread workspace is not ready.");
  } catch {
    return unavailable(threadId, "The thread workspace is not ready.");
  }
  const environmentPath = normalizedAbsolutePath(environment.path);
  if (environmentPath === null) {
    return unavailable(threadId, "The thread workspace path is unavailable.");
  }
  const project = await sdk.projects.get({ projectId: thread.projectId });
  const activeReference = {
    environmentId: environment.id,
    kind: "environment" as const,
  };
  const activeBase = {
    hostId: environment.hostId,
    projectId: thread.projectId,
    reference: activeReference,
    rootPath: environmentPath,
  };
  const activeRootId = rootIdFor(activeBase);
  const roots: NativeFileRoot[] = [
    {
      gitCapability: environment.isGitRepo ? "known-git" : "known-non-git",
      hostId: environment.hostId,
      isActiveEnvironment: true,
      label: environment.name?.trim() || "Workspace",
      navigationRoot: { environmentId: environment.id, kind: "workspace" },
      projectId: thread.projectId,
      reference: activeReference,
      rootId: activeRootId,
      rootPath: environmentPath,
    },
  ];
  const seen = new Set([`${environment.hostId}\0${environmentPath}`]);
  const sources = project.sources
    .slice()
    .sort(
      (first, second) =>
        Number(second.isDefault) - Number(first.isDefault) ||
        first.id.localeCompare(second.id),
    );
  for (const source of sources) {
    if (roots.length >= NATIVE_FILE_ROOT_LIMIT) break;
    const rootPath = normalizedAbsolutePath(source.path);
    if (rootPath === null) continue;
    const identity = `${source.hostId}\0${rootPath}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const reference = {
      kind: "project-source" as const,
      projectId: thread.projectId,
      sourceId: source.id,
    };
    const rootId = rootIdFor({
      hostId: source.hostId,
      projectId: thread.projectId,
      reference,
      rootPath,
    });
    roots.push({
      gitCapability: "unknown",
      hostId: source.hostId,
      isActiveEnvironment: false,
      label: source.isDefault
        ? `${project.name} source`
        : `${project.name} source ${source.id}`,
      navigationRoot: {
        kind: "project-source",
        projectId: thread.projectId,
        sourceId: source.id,
      },
      projectId: thread.projectId,
      reference,
      rootId,
      rootPath,
    });
  }
  return { activeRootId, kind: "ready" as const, roots, threadId };
}
export async function resolveAuthorizedNativeFileRoot(
  sdk: BbPluginApi["sdk"],
  threadId: string,
  rootId: string,
): Promise<NativeFileRoot> {
  const result = await listAuthorizedNativeFileRoots(sdk, threadId);
  if (result.kind === "unavailable")
    throw new Error(`Files unavailable: ${result.reason}`);
  const root = result.roots.find((candidate) => candidate.rootId === rootId);
  if (!root) throw new Error("Files root is stale or no longer authorized");
  return root;
}
