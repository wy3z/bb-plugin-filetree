// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import {
  filetreeRpcContract,
  type WorkspaceContext,
} from "./contract.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const app = await loadPluginApp(() => import("./app"));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Files panel thread scoping", () => {
  it("cannot apply a slow workspace response from the previous thread", async () => {
    const threadAWorkspace = deferred<WorkspaceContext>();
    const threadBWorkspace = deferred<WorkspaceContext>();
    const workspaceCalls: string[] = [];
    const directoryCalls: Array<{ threadId: string; path: string }> = [];
    const pendingWatch = new Promise<never>(() => {});

    const registration = app.threadPanelActions.find(
      (action) => action.id === "files",
    );
    expect(registration).toBeDefined();
    const Panel = registration!.component;

    const slot = renderSlot<
      PluginThreadPanelProps,
      typeof filetreeRpcContract
    >(
      registration!,
      { threadId: "thread-a", params: null },
      {
        rpc: {
          workspace({ threadId }) {
            workspaceCalls.push(threadId);
            return threadId === "thread-a"
              ? threadAWorkspace.promise
              : threadBWorkspace.promise;
          },
          listDirectory(input) {
            directoryCalls.push(input);
            return {
              entries: [
                { name: "current.ts", path: "current.ts", kind: "file" },
              ],
              truncated: false,
            };
          },
          search() {
            return { matches: [], truncated: false };
          },
          cancelSearch() {
            return { cancelled: false };
          },
          watchWorkspace() {
            return pendingWatch;
          },
          readFile({ threadId, path }) {
            return {
              kind: "text",
              content: `${threadId}:${path}`,
              modifiedAtMs: 1,
              sizeBytes: 1,
            };
          },
        },
        openFileExternally: () => true,
      },
    );

    await waitFor(() => {
      expect(workspaceCalls).toEqual(["thread-a"]);
    });

    slot.rerender(<Panel threadId="thread-b" params={null} />);

    await waitFor(() => {
      expect(workspaceCalls).toEqual(["thread-a", "thread-b"]);
    });

    await act(async () => {
      threadBWorkspace.resolve({
        kind: "ready",
        environmentId: "environment-b",
        rootName: "repo-b",
        rootPath: "/work/repo-b",
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(slot.getByText("repo-b")).toBeTruthy();
      expect(slot.getByTestId("bb-source-code").textContent).toBe(
        "thread-b:current.ts",
      );
    });

    await act(async () => {
      threadAWorkspace.resolve({
        kind: "ready",
        environmentId: "environment-a",
        rootName: "repo-a",
        rootPath: "/work/repo-a",
      });
      await Promise.resolve();
    });

    expect(slot.queryByText("repo-a")).toBeNull();
    expect(slot.getByText("repo-b")).toBeTruthy();
    expect(directoryCalls).toEqual([{ threadId: "thread-b", path: "" }]);

    fireEvent.click(slot.getByRole("button", { name: "Open in editor" }));
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "experimental_openFileExternally",
      options: {
        target: {
          kind: "workspace",
          environmentId: "environment-b",
          path: "current.ts",
        },
        location: null,
      },
    });

    slot.unmount();
  });
});
