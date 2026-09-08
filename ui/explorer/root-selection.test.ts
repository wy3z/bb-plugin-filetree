import { describe, expect, it } from "vitest";
import { selectAuthorizedRoot } from "./use-root-data";
const workspace = {
  gitCapability: "known-git" as const,
  hostId: "host-a",
  isActiveEnvironment: true,
  label: "workspace",
  navigationRoot: { environmentId: "env-a", kind: "workspace" as const },
  projectId: "project-a",
  reference: { environmentId: "env-a", kind: "environment" as const },
  rootId: "root-active",
  rootPath: "/workspace",
};
const source = {
  ...workspace,
  isActiveEnvironment: false,
  label: "source",
  navigationRoot: {
    kind: "project-source" as const,
    projectId: "project-a",
    sourceId: "source-a",
  },
  reference: {
    kind: "project-source" as const,
    projectId: "project-a",
    sourceId: "source-a",
  },
  rootId: "root-source",
  rootPath: "/source",
};
describe("selectAuthorizedRoot", () => {
  it("restores a still-authorized persisted root", () => {
    expect(
      selectAuthorizedRoot(
        {
          activeRootId: workspace.rootId,
          kind: "ready",
          roots: [workspace, source],
          threadId: "thread-a",
        },
        source.rootId,
      ).rootId,
    ).toBe(source.rootId);
  });
  it("falls back from a stale persisted root to the active environment", () => {
    expect(
      selectAuthorizedRoot(
        {
          activeRootId: workspace.rootId,
          kind: "ready",
          roots: [workspace, source],
          threadId: "thread-a",
        },
        "missing-root",
      ).rootId,
    ).toBe(workspace.rootId);
  });
});
