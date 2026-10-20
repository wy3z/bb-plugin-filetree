import type { NativeFilesSelection } from "./native-files-ui-types";

export type LiveFileTarget =
  | { kind: "workspace"; environmentId: string; path: string }
  | { kind: "host"; hostId: string; path: string };

export function liveFileTarget(selection: NativeFilesSelection): LiveFileTarget {
  const { root, path } = selection;
  if (root.navigationRoot.kind === "workspace") {
    return {
      kind: "workspace",
      environmentId: root.navigationRoot.environmentId,
      path,
    };
  }
  const prefix = root.rootPath.endsWith("/") ? root.rootPath : `${root.rootPath}/`;
  return { kind: "host", hostId: root.hostId, path: `${prefix}${path}` };
}
