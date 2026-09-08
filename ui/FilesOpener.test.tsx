// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeFileRootsResponse } from "../contracts/api";
import type { NativeFilesSelection } from "./native-files-ui-types";
import type { NativeFilesData } from "./native-files-data";
import { FilesOpener } from "./FilesOpener";
const data = vi.hoisted(() => ({
  listRoots: vi.fn<NativeFilesData["listRoots"]>(),
}));
vi.mock("./use-files-data", () => ({ useFilesData: () => data }));
vi.mock("./NativeFilesPanel", () => ({
  NativeFilesPanel: ({
    initialSelection,
  }: {
    initialSelection: NativeFilesSelection;
  }) => <div>{initialSelection.path}</div>,
}));
const source = {
  kind: "workspace" as const,
  threadId: "thread-a",
  environmentId: "env-a",
  projectId: null,
};
const Original = () => <div>Original viewer</div>;
const roots: NativeFileRootsResponse = {
  kind: "ready",
  activeRootId: "root-a",
  threadId: "thread-a",
  roots: [
    {
      rootId: "root-a",
      rootPath: "/workspace",
      hostId: "host-a",
      projectId: "project-a",
      isActiveEnvironment: true,
      label: "workspace",
      gitCapability: "unknown",
      navigationRoot: { kind: "workspace", environmentId: "env-a" },
      reference: { kind: "environment", environmentId: "env-a" },
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("ignores a late root lookup after a different file is opened", async () => {
  let finishFirst: ((value: NativeFileRootsResponse) => void) | undefined;
  data.listRoots.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
  );
  data.listRoots.mockResolvedValue(roots);
  const view = render(
    <FilesOpener path="first.ts" source={source} Original={Original} />,
  );
  const signal = data.listRoots.mock.calls[0]![0].signal;
  view.rerender(
    <FilesOpener path="second.ts" source={source} Original={Original} />,
  );
  await screen.findByText("second.ts");
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finishFirst?.(roots);
  });
  expect(screen.queryByText("first.ts")).toBeNull();
  expect(screen.getByText("second.ts")).toBeTruthy();
});
it("delegates a failed root lookup to the bound original viewer", async () => {
  data.listRoots.mockRejectedValue(new Error("Host unavailable"));
  render(<FilesOpener path="first.ts" source={source} Original={Original} />);
  await screen.findByText("Original viewer");
});
it("delegates thread storage without starting workspace I/O", () => {
  render(
    <FilesOpener
      path="first.ts"
      source={{ ...source, kind: "thread-storage" }}
      Original={Original}
    />,
  );
  expect(screen.getByText("Original viewer")).toBeTruthy();
  expect(data.listRoots).not.toHaveBeenCalled();
});
