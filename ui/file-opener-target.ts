import type { PluginFileOpenerSource } from "@get-bb/plugin-sdk/app";
import type { NativeFileRootsResponse } from "../contracts/api";
import { nativeFilePathSchema } from "../contracts/model";
import type { NativeFilesSelection } from "./native-files-ui-types";

export function resolveFileOpenerTarget(
  path: string,
  source: PluginFileOpenerSource,
  response: NativeFileRootsResponse,
): NativeFilesSelection | null {
  if (
    source.threadId === null ||
    response.threadId !== source.threadId ||
    response.kind !== "ready" ||
    source.kind === "thread-storage"
  )
    return null;
  if (source.kind === "workspace") {
    const parsed = nativeFilePathSchema.safeParse(path);
    if (!parsed.success || source.environmentId === null) return null;
    const root = response.roots.find(
      (candidate) =>
        candidate.navigationRoot.kind === "workspace" &&
        candidate.navigationRoot.environmentId === source.environmentId &&
        (source.projectId === null ||
          candidate.projectId === source.projectId) &&
        (source.experimental_hostId === undefined ||
          candidate.hostId === source.experimental_hostId),
    );
    return root ? { root, path: parsed.data } : null;
  }
  if (!path.startsWith("/")) return null;
  const hostId =
    source.experimental_hostId ??
    response.roots.find(
      (root) =>
        root.isActiveEnvironment &&
        (source.environmentId === null ||
          (root.navigationRoot.kind === "workspace" &&
            root.navigationRoot.environmentId === source.environmentId)),
    )?.hostId;
  if (hostId === undefined) return null;
  const roots = response.roots
    .filter((root) => root.hostId === hostId)
    .sort((left, right) => right.rootPath.length - left.rootPath.length);
  for (const root of roots) {
    const prefix = root.rootPath.endsWith("/")
      ? root.rootPath
      : `${root.rootPath}/`;
    if (!path.startsWith(prefix)) continue;
    const parsed = nativeFilePathSchema.safeParse(path.slice(prefix.length));
    if (parsed.success) return { root, path: parsed.data };
  }
  return null;
}
