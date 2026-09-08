// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeFilesData } from "./native-files-data";
import {
  writePersistedRootChoice,
  writePersistedRootState,
} from "./explorer/persistence";
import { NativeFilesPanel } from "./NativeFilesPanel";
const openFileExternally = vi.hoisted(() => vi.fn(() => true));
const copyToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: copyToast }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  Markdown: (props: { content: string }) => <div>{props.content}</div>,
  useBbNavigate: () => ({
    experimental_openFileExternally: openFileExternally,
  }),
  experimental_SourceCode: (props: { content: string; overflow?: string }) => (
    <pre data-overflow={props.overflow}>{props.content}</pre>
  ),
}));
const rootRecord = {
  gitCapability: "known-git" as const,
  hostId: "host-a",
  isActiveEnvironment: true,
  label: "workspace",
  navigationRoot: { environmentId: "env-a", kind: "workspace" as const },
  projectId: "project-a",
  reference: { environmentId: "env-a", kind: "environment" as const },
  rootId: "root-a",
  rootPath: "/workspace",
};
function data(): NativeFilesData {
  return {
    listRoots: vi.fn(async ({ threadId }) => ({
      activeRootId: rootRecord.rootId,
      kind: "ready" as const,
      roots: [rootRecord],
      threadId,
    })),
    listDirectory: vi.fn(async ({ path, rootId }) => ({
      entries:
        path === ""
          ? [
              { kind: "directory" as const, name: "src", path: "src" },
              { kind: "file" as const, name: "README.md", path: "README.md" },
              {
                kind: "file" as const,
                name: "slides.pptx",
                path: "slides.pptx",
              },
            ]
          : path === "src"
            ? [{ kind: "file" as const, name: "app.ts", path: "src/app.ts" }]
            : [],
      path,
      rootId,
      truncated: false,
    })),
    search: vi.fn(),
    createTransfer: vi.fn(async ({ path, rootId }) => ({
      contentUrl: `/api/v1/native-file-transfers/${path.replaceAll("/", "-")}`,
      expiresAtMs: Date.now() + 60000,
      filename: path.split("/").at(-1) ?? path,
      mimeType: path.endsWith(".md") ? "text/markdown" : "text/typescript",
      modifiedAtMs: 1,
      path,
      rootId,
      sha256: "a".repeat(64),
      sizeBytes: 17,
    })),
    gitStatus: vi.fn(async ({ rootId }) => ({
      branch: "main",
      changes: [],
      headSha: null,
      kind: "ready" as const,
      rootId,
      truncated: false,
    })),
    subscribe: vi.fn(() => () => undefined),
  };
}
beforeEach(() => {
  copyToast.success.mockReset();
  copyToast.error.mockReset();
  openFileExternally.mockReset().mockReturnValue(true);
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    bottom: 600,
    height: 600,
    left: 0,
    right: 800,
    top: 0,
    width: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      const body = url.includes("README")
        ? "# Native files QA fixture"
        : "export const greeting = 'hello';";
      return new Response(body, {
        headers: {
          "content-length": String(body.length),
          "content-type": url.includes("README")
            ? "text/markdown"
            : "text/typescript",
        },
        status: 200,
      });
    }),
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function renderPanel(panelData: NativeFilesData = data()) {
  return render(<NativeFilesPanel data={panelData} threadId="thread-a" />);
}
function forbiddenControls() {
  return [
    screen.queryByRole("button", { name: "All Files" }),
    screen.queryByRole("button", { name: "Changes" }),
    screen.queryByRole("button", { name: "Open in BB" }),
  ];
}
async function openSrcAppTs() {
  fireEvent.click(
    await screen.findByRole("treeitem", { name: /src, directory/u }),
  );
  fireEvent.click(
    await screen.findByRole("treeitem", { name: /app\.ts, file/u }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Copy file contents" }),
    ).toBeTruthy(),
  );
}
describe("NativeFilesPanel", () => {
  it("copies the full path and reports clipboard success or failure", async () => {
    renderPanel();
    await openSrcAppTs();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const button = screen.getByRole("button", { name: "Copy file path" });
    expect(button.textContent).toBe("\u200esrc/app.ts");
    expect(button.querySelector("span")?.getAttribute("dir")).toBe("rtl");
    fireEvent.click(button);
    await waitFor(() =>
      expect(copyToast.success).toHaveBeenCalledWith("File path copied"),
    );
    expect(writeText).toHaveBeenCalledWith("/workspace/src/app.ts");
    writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    fireEvent.click(button);
    await waitFor(() =>
      expect(copyToast.error).toHaveBeenCalledWith("Failed to copy file path"),
    );
  });
  it("toggles wrapping and refreshes file content without resetting the choice", async () => {
    const panelData = data();
    const { container } = renderPanel(panelData);
    await openSrcAppTs();
    const wrap = screen.getByRole("button", { name: "Word wrap" });
    expect(wrap.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(wrap);
    expect(container.querySelector("pre")?.getAttribute("data-overflow")).toBe(
      "scroll",
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("export const refreshed = true;"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh file" }));
    await screen.findByText("export const refreshed = true;");
    expect(container.querySelector("pre")?.getAttribute("data-overflow")).toBe(
      "scroll",
    );
    expect(screen.getByRole("button", { name: "Copy file path" })).toBeTruthy();
  });
  it("opens the live workspace file in BB's preferred editor", async () => {
    renderPanel();
    await openSrcAppTs();
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(openFileExternally).toHaveBeenCalledWith({
      target: { kind: "workspace", environmentId: "env-a", path: "src/app.ts" },
      location: null,
    });
    openFileExternally.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be opened",
    );
  });
  it("opens a project-source file on its own host", async () => {
    const panelData = data();
    vi.mocked(panelData.listRoots).mockImplementation(async ({ threadId }) => ({
      kind: "ready",
      threadId,
      activeRootId: rootRecord.rootId,
      roots: [
        {
          ...rootRecord,
          rootPath: "/source/",
          hostId: "source-host",
          navigationRoot: {
            kind: "project-source",
            projectId: "project-a",
            sourceId: "source-a",
          },
        },
      ],
    }));
    renderPanel(panelData);
    await openSrcAppTs();
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(openFileExternally).toHaveBeenCalledWith({
      target: {
        kind: "host",
        hostId: "source-host",
        path: "/source/src/app.ts",
      },
      location: null,
    });
  });
  it("switches workspace from the toolbar menu and clears the previous preview", async () => {
    const panelData = data();
    vi.mocked(panelData.listRoots).mockImplementation(async ({ threadId }) => ({
      activeRootId: rootRecord.rootId,
      kind: "ready",
      threadId,
      roots: [
        rootRecord,
        {
          ...rootRecord,
          rootId: "root-b",
          label: "Project source",
          rootPath: "/project",
          isActiveEnvironment: false,
        },
      ],
    }));
    renderPanel(panelData);
    await openSrcAppTs();
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger.closest(".filetree-app-toolbar")).not.toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Workspace root" }),
    ).toBeNull();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(
      await screen.findByRole("menuitemradio", {
        name: "workspace",
        checked: true,
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Project source" }),
    );
    await waitFor(() =>
      expect(panelData.listDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ rootId: "root-b", path: "" }),
      ),
    );
    expect(screen.getByText("Select a file to preview it.")).toBeTruthy();
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    fireEvent.focus(screen.getByRole("button", { name: "Switch workspace" }));
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "Project source",
    );
  });
  it("dismisses the file menu when clicking outside without choosing an action", async () => {
    const panelData = data();
    renderPanel(panelData);
    const row = await screen.findByRole("treeitem", {
      name: /README\.md, file/u,
    });
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(await screen.findByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(panelData.createTransfer).not.toHaveBeenCalled();
  });
  it("dismisses with Escape and restores focus to the file row", async () => {
    renderPanel();
    const row = await screen.findByRole("treeitem", {
      name: /README\.md, file/u,
    });
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    const menu = await screen.findByRole("menu");
    expect(menu.className).toContain("bg-popover");
    expect(document.body.style.pointerEvents).not.toBe("none");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
  it("closes after selecting a file menu action", async () => {
    const panelData = data();
    renderPanel(panelData);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const row = await screen.findByRole("treeitem", {
      name: /README\.md, file/u,
    });
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Save a copy" }),
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(panelData.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ path: "README.md" }),
    );
  });
  it("refreshes expanded folders without dropping their visible children", async () => {
    const panelData = data();
    renderPanel(panelData);
    await openSrcAppTs();
    const listDirectory = vi.mocked(panelData.listDirectory);
    listDirectory.mockClear();
    await act(async () => {
      for (const [, listener] of vi.mocked(panelData.subscribe).mock.calls) {
        listener({ rootIds: [rootRecord.rootId] });
      }
    });
    await waitFor(() =>
      expect(listDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ path: "src", rootId: rootRecord.rootId }),
      ),
    );
    expect(
      screen.getByRole("treeitem", { name: /app\.ts, file/u }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("treeitem", { name: /src, directory/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
  it("selects src/app.ts, renders its contents, and keeps both after collapse", async () => {
    const { container } = renderPanel();
    await openSrcAppTs();
    expect(
      screen.getByRole("button", { name: "Copy file path" }).textContent,
    ).toContain("app.ts");
    expect(
      container.querySelector(".filetree-app-preview")?.textContent,
    ).toContain("export const greeting = 'hello';");
    const body = container.querySelector(".filetree-app-body");
    const preview = container.querySelector(".filetree-app-preview");
    const explorer = container.querySelector(".filetree-app-explorer");
    expect(body?.querySelector("[data-panel-group]")?.firstElementChild).toBe(
      preview,
    );
    expect(
      preview && explorer
        ? Boolean(
            preview.compareDocumentPosition(explorer) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
    expect(container.querySelectorAll(".filetree-app-toolbar")).toHaveLength(1);
    expect(forbiddenControls()).toEqual([null, null, null]);
    fireEvent.click(screen.getByRole("button", { name: "Hide file tree" }));
    expect(
      screen.getByRole("button", { name: "Copy file path" }).textContent,
    ).toContain("app.ts");
    expect(
      container.querySelector(".filetree-app-preview")?.textContent,
    ).toContain("export const greeting = 'hello';");
    expect(
      container.querySelector('[data-filetree-path="src/app.ts"]'),
    ).not.toBe(null);
    expect(
      container
        .querySelector('[data-filetree-path="src"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.queryByRole("tree", { name: "Workspace files" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show file tree" }));
    expect(screen.getByRole("tree", { name: "Workspace files" })).toBeTruthy();
    expect(
      screen
        .getByRole("treeitem", { name: /src, directory/u })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByRole("treeitem", { name: /app\.ts, file/u }),
    ).toBeTruthy();
    expect(
      container.querySelector(".filetree-app-preview")?.textContent,
    ).toContain("export const greeting = 'hello';");
  });
  it("omits attachment and download toolbar actions", async () => {
    render(<NativeFilesPanel data={data()} threadId="thread-a" />);
    await openSrcAppTs();
    expect(
      screen.queryByRole("button", { name: "Open externally" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save a copy" })).toBeNull();
  });
  it("restores a persisted nested file selection into the preview", async () => {
    window.localStorage.setItem(
      "bb-plugin-files:root-state:v1:thread-a:root-a",
      JSON.stringify({
        expandedPaths: ["src"],
        rootId: "root-a",
        savedAtMs: Date.now(),
        searchQuery: "",
        selectedPath: "src/app.ts",
        scrollTop: 0,
        threadId: "thread-a",
        version: 1,
      }),
    );
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copy file contents" }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: "Copy file path" }).textContent,
    ).toContain("app.ts");
  });
  it("refreshes the selected root without reloading it for unrelated root changes", async () => {
    const panelData = data();
    const listeners = new Set<Parameters<NativeFilesData["subscribe"]>[1]>();
    vi.mocked(panelData.subscribe).mockImplementation((_, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
    renderPanel(panelData);
    await openSrcAppTs();
    vi.mocked(panelData.createTransfer).mockClear();
    vi.mocked(panelData.listRoots).mockClear();
    await act(async () => {
      for (const listener of listeners) listener({ rootIds: ["another-root"] });
    });
    expect(panelData.createTransfer).not.toHaveBeenCalled();
    expect(panelData.listRoots).not.toHaveBeenCalled();
    await act(async () => {
      for (const listener of listeners) listener({ rootIds: ["root-a"] });
    });
    await waitFor(() =>
      expect(panelData.createTransfer).toHaveBeenCalledOnce(),
    );
    expect(panelData.listRoots).not.toHaveBeenCalled();
  });
});

it("opens the requested root and nested file over saved selection and search", async () => {
  const panelData = data();
  const otherRoot = { ...rootRecord, rootId: "root-other", rootPath: "/other" };
  vi.mocked(panelData.listRoots).mockImplementation(async ({ threadId }) => ({
    kind: "ready",
    activeRootId: "root-a",
    roots: [rootRecord, otherRoot],
    threadId,
  }));
  writePersistedRootChoice(window.localStorage, "thread-a", "root-other");
  writePersistedRootState(window.localStorage, {
    threadId: "thread-a",
    rootId: "root-a",
    expandedPaths: [],
    searchQuery: "unrelated",
    selectedPath: "README.md",
    scrollTop: 120,
  });
  render(
    <NativeFilesPanel
      data={panelData}
      threadId="thread-a"
      initialSelection={{ root: rootRecord, path: "src/app.ts" }}
    />,
  );
  await screen.findByText("export const greeting = 'hello';");
  await waitFor(() =>
    expect(panelData.listDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ rootId: "root-a", path: "src" }),
    ),
  );
  expect(panelData.search).not.toHaveBeenCalled();
  expect(panelData.createTransfer).not.toHaveBeenCalledWith(
    expect.objectContaining({ path: "README.md" }),
  );
  expect(
    screen.getByRole("button", { name: "Copy file path" }).textContent,
  ).toContain("src/app.ts");
});
