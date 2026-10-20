import { describe, expect, it } from "vitest";
import { liveFileTarget } from "./live-file-target";
import type { NativeFilesRoot } from "./native-files-ui-types";

function root(navigationRoot: NativeFilesRoot["navigationRoot"], rootPath: string) {
  return { hostId: "host_1", navigationRoot, rootPath } as NativeFilesRoot;
}

describe("liveFileTarget", () => {
  it("opens workspace files by environment", () => {
    expect(
      liveFileTarget({
        root: root({ kind: "workspace", environmentId: "env_1" }, "/repo"),
        path: "src/app.ts",
      }),
    ).toEqual({ kind: "workspace", environmentId: "env_1", path: "src/app.ts" });
  });

  it("opens project source files by absolute host path", () => {
    expect(
      liveFileTarget({
        root: root(
          { kind: "project-source", projectId: "proj_1", sourceId: "src_1" },
          "/home/me/repo/",
        ),
        path: "README.md",
      }),
    ).toEqual({ kind: "host", hostId: "host_1", path: "/home/me/repo/README.md" });
  });
});
