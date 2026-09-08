import { describe, expect, it } from "vitest";
import type { PluginFileOpenerSource } from "@get-bb/plugin-sdk/app";
import type { NativeFileRootsResponse, NativeFileRoot } from "../contracts/api";
import { resolveFileOpenerTarget } from "./file-opener-target";
import {
  FILE_PREVIEW_EXTENSIONS,
  routePreview,
} from "./preview/preview-router";
const workspace: NativeFileRoot = {
  gitCapability: "unknown",
  hostId: "host-a",
  isActiveEnvironment: true,
  label: "workspace",
  navigationRoot: { kind: "workspace", environmentId: "env-a" },
  projectId: "project-a",
  reference: { kind: "environment", environmentId: "env-a" },
  rootId: "workspace",
  rootPath: "/workspace",
};
const nested: NativeFileRoot = {
  ...workspace,
  isActiveEnvironment: false,
  rootId: "nested",
  rootPath: "/workspace/nested",
  navigationRoot: {
    kind: "project-source",
    projectId: "project-a",
    sourceId: "source-a",
  },
  reference: {
    kind: "project-source",
    projectId: "project-a",
    sourceId: "source-a",
  },
};
const roots: NativeFileRootsResponse = {
  kind: "ready",
  threadId: "thread-a",
  activeRootId: "workspace",
  roots: [workspace, nested, { ...nested, hostId: "host-b", rootId: "remote" }],
};
const source: PluginFileOpenerSource = {
  kind: "workspace",
  threadId: "thread-a",
  environmentId: "env-a",
  projectId: null,
};
describe("file opener target", () => {
  it("resolves workspace paths by environment, regardless of root ordering", () => {
    expect(resolveFileOpenerTarget("src/app.ts", source, roots)).toEqual({
      root: workspace,
      path: "src/app.ts",
    });
    expect(
      resolveFileOpenerTarget(
        "src/app.ts",
        { ...source, environmentId: "another-env" },
        roots,
      ),
    ).toBeNull();
    expect(
      resolveFileOpenerTarget(
        "src/app.ts",
        { ...source, projectId: "another-project" },
        roots,
      ),
    ).toBeNull();
  });
  it("chooses the most specific authorized host root", () => {
    expect(
      resolveFileOpenerTarget(
        "/workspace/nested/app.ts",
        { ...source, kind: "host" },
        roots,
      ),
    ).toEqual({ root: nested, path: "app.ts" });
    expect(
      resolveFileOpenerTarget(
        "/workspace/nested/app.ts",
        { ...source, kind: "host", experimental_hostId: "host-b" },
        roots,
      )?.root.rootId,
    ).toBe("remote");
    expect(
      resolveFileOpenerTarget(
        "/workspace/app.ts",
        { ...source, kind: "host", experimental_hostId: "host-b" },
        roots,
      ),
    ).toBeNull();
  });
  it.each([
    "/workspace-other/app.ts",
    "/workspace/../secret.ts",
    "/workspace/src/../../secret.ts",
    "/workspace/src\\app.ts",
    "/workspace/app.ts\0",
    "/workspace",
  ])("rejects unsafe or unrelated host path %s", (path) => {
    expect(
      resolveFileOpenerTarget(path, { ...source, kind: "host" }, roots),
    ).toBeNull();
  });
  it("delegates storage, missing context, and stale thread roots", () => {
    for (const change of [
      { kind: "thread-storage" as const },
      { threadId: null },
      { threadId: "other-thread" },
      { environmentId: null },
      { experimental_hostId: "host-b" },
    ]) {
      expect(
        resolveFileOpenerTarget("app.ts", { ...source, ...change }, roots),
      ).toBeNull();
    }
  });
  it.each(["../app.ts", "/workspace/app.ts", "src//app.ts", "src/./app.ts"])(
    "rejects invalid workspace path %s",
    (path) => {
      expect(resolveFileOpenerTarget(path, source, roots)).toBeNull();
    },
  );
  it("only registers extensions that have a preview", () => {
    expect(new Set(FILE_PREVIEW_EXTENSIONS).size).toBe(
      FILE_PREVIEW_EXTENSIONS.length,
    );
    for (const extension of FILE_PREVIEW_EXTENSIONS) {
      expect(routePreview(`file.${extension}`, null).kind).not.toBe(
        "unsupported",
      );
    }
  });
});
