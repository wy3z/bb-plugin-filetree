import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  definePluginApp,
  experimental_FileLink as FileLink,
  experimental_SourceCode as SourceCode,
  useBbNavigate,
  useRpc,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import {
  filetreeRpcContract,
  type FilePreview,
  type FileTreeEntry,
  type WorkspaceContext,
} from "./contract.js";
import "./app.css";

const TREE_WIDTH_KEY = "bb-filetree:tree-width";
const SELECTED_PATH_KEY_PREFIX = "bb-filetree:selected:";
const DEFAULT_TREE_WIDTH = 286;
const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 520;
const MIN_VIEWER_WIDTH = 220;
const SEARCH_LIMIT = 120;
const WATCH_RETRY_MS = 1_500;

let nextSearchSequence = 1;

type DirectoryState =
  | { status: "loading" }
  | {
      status: "ready";
      entries: readonly FileTreeEntry[];
      truncated: boolean;
    }
  | { status: "error"; message: string };

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: FilePreview }
  | { status: "error"; message: string };

type ReadyWorkspace = Extract<WorkspaceContext, { kind: "ready" }>;
type LineOverflowMode = "scroll" | "wrap";

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileTreeEntry;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readNumber(key: string, fallback: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function selectedPathKey(threadId: string): string {
  return `${SELECTED_PATH_KEY_PREFIX}${threadId}`;
}

function basename(relativePath: string): string {
  return relativePath.split("/").at(-1) ?? relativePath;
}

function dirname(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index < 0 ? "" : relativePath.slice(0, index);
}

function absolutePath(rootPath: string, relativePath: string): string {
  const trimmedRoot = rootPath.replace(/[\\/]+$/u, "");
  if (rootPath.includes("\\")) {
    return `${trimmedRoot}\\${relativePath.replace(/\//gu, "\\")}`;
  }
  return `${trimmedRoot}/${relativePath}`;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function clampWidth(width: number, containerWidth: number): number {
  const responsiveMax = Math.max(
    MIN_TREE_WIDTH,
    Math.min(MAX_TREE_WIDTH, containerWidth - MIN_VIEWER_WIDTH),
  );
  return Math.max(MIN_TREE_WIDTH, Math.min(width, responsiveMax));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function FileTreePanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof filetreeRpcContract>();
  const navigate = useBbNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const directoryRequestVersions = useRef(new Map<string, number>());
  const expandedRef = useRef<ReadonlySet<string>>(new Set());
  const selectedPathRef = useRef<string | null>(null);
  const queryRef = useRef("");

  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [directories, setDirectories] = useState<
    Readonly<Record<string, DirectoryState>>
  >({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    readString(selectedPathKey(threadId)),
  );
  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "idle",
  });
  const [previewNonce, setPreviewNonce] = useState(0);
  const [lineOverflowMode, setLineOverflowMode] =
    useState<LineOverflowMode>("scroll");
  const [query, setQuery] = useState("");
  const [searchRefreshNonce, setSearchRefreshNonce] = useState(0);
  const [searchState, setSearchState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    matches: readonly FileTreeEntry[];
    truncated: boolean;
    message?: string;
  }>({ status: "idle", matches: [], truncated: false });
  const [treeWidth, setTreeWidth] = useState(() =>
    readNumber(TREE_WIDTH_KEY, DEFAULT_TREE_WIDTH),
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  expandedRef.current = expanded;
  selectedPathRef.current = selectedPath;
  queryRef.current = query;

  const loadWorkspace = useCallback(async () => {
    setWorkspaceError(null);
    try {
      setWorkspace(await rpc.call("workspace", { threadId }));
    } catch (error) {
      setWorkspace(null);
      setWorkspaceError(errorMessage(error));
    }
  }, [rpc, threadId]);

  useEffect(() => {
    setSelectedPath(readString(selectedPathKey(threadId)));
    void loadWorkspace();
  }, [loadWorkspace, threadId]);

  const loadDirectory = useCallback(
    async (relativePath: string) => {
      const requestVersion =
        (directoryRequestVersions.current.get(relativePath) ?? 0) + 1;
      directoryRequestVersions.current.set(relativePath, requestVersion);
      setDirectories((current) => ({
        ...current,
        [relativePath]: { status: "loading" },
      }));
      try {
        const result = await rpc.call("listDirectory", {
          threadId,
          path: relativePath,
        });
        if (
          directoryRequestVersions.current.get(relativePath) !== requestVersion
        ) {
          return;
        }
        setDirectories((current) => ({
          ...current,
          [relativePath]: {
            status: "ready",
            entries: result.entries,
            truncated: result.truncated,
          },
        }));
      } catch (error) {
        if (
          directoryRequestVersions.current.get(relativePath) !== requestVersion
        ) {
          return;
        }
        setDirectories((current) => ({
          ...current,
          [relativePath]: { status: "error", message: errorMessage(error) },
        }));
      }
    },
    [rpc, threadId],
  );

  const workspaceEnvironmentId =
    workspace?.kind === "ready" ? workspace.environmentId : null;
  useEffect(() => {
    if (workspaceEnvironmentId === null) return;
    directoryRequestVersions.current.clear();
    setDirectories({});
    setExpanded(new Set());
    void loadDirectory("");
  }, [loadDirectory, workspaceEnvironmentId]);

  const rootDirectory = directories[""];
  useEffect(() => {
    if (
      selectedPath !== null ||
      rootDirectory?.status !== "ready" ||
      rootDirectory.entries.length === 0
    ) {
      return;
    }
    const preferredNames = ["README.md", "package.json", "AGENTS.md"];
    const selected =
      preferredNames
        .map((name) => rootDirectory.entries.find((entry) => entry.name === name))
        .find((entry): entry is FileTreeEntry => entry?.kind === "file") ??
      rootDirectory.entries.find((entry) => entry.kind === "file");
    if (selected !== undefined) setSelectedPath(selected.path);
  }, [rootDirectory, selectedPath]);

  useEffect(() => {
    if (selectedPath === null) {
      setPreviewState({ status: "idle" });
      return;
    }
    writeStorage(selectedPathKey(threadId), selectedPath);
    let cancelled = false;
    setPreviewState({ status: "loading" });
    void rpc
      .call("readFile", { threadId, path: selectedPath })
      .then((preview) => {
        if (!cancelled) setPreviewState({ status: "ready", preview });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewNonce, rpc, selectedPath, threadId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setSearchState({ status: "idle", matches: [], truncated: false });
      return;
    }

    let cancelled = false;
    let searchId: string | null = null;
    setSearchState((current) => ({ ...current, status: "loading" }));
    const timer = window.setTimeout(() => {
      searchId = `${threadId}:${Date.now().toString(36)}:${nextSearchSequence++}`;
      void rpc
        .call("search", {
          threadId,
          searchId,
          query: trimmed,
          limit: SEARCH_LIMIT,
        })
        .then((result) => {
          if (!cancelled) {
            setSearchState({
              status: "ready",
              matches: result.matches,
              truncated: result.truncated,
            });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSearchState({
              status: "error",
              matches: [],
              truncated: false,
              message: errorMessage(error),
            });
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (searchId !== null) {
        void rpc.call("cancelSearch", { threadId, searchId }).catch(() => {});
      }
    };
  }, [query, rpc, searchRefreshNonce, threadId]);

  useEffect(() => {
    if (workspaceEnvironmentId === null) return;
    let stopped = false;

    const refreshVisibleWorkspace = () => {
      const paths = new Set<string>(["", ...expandedRef.current]);
      for (const relativePath of paths) void loadDirectory(relativePath);
      if (selectedPathRef.current !== null) {
        setPreviewNonce((current) => current + 1);
      }
      if (queryRef.current.trim().length > 0) {
        setSearchRefreshNonce((current) => current + 1);
      }
    };

    const run = async () => {
      while (!stopped) {
        try {
          const event = await rpc.call("watchWorkspace", { threadId });
          if (stopped) break;
          if (event.kind === "changed" || event.kind === "rescan-required") {
            refreshVisibleWorkspace();
          } else if (event.kind === "watch-error") {
            await sleep(WATCH_RETRY_MS);
          }
        } catch {
          if (!stopped) await sleep(WATCH_RETRY_MS);
        }
      }
    };

    void run();
    return () => {
      stopped = true;
    };
  }, [loadDirectory, rpc, threadId, workspaceEnvironmentId]);

  const toggleDirectory = useCallback(
    (entry: FileTreeEntry) => {
      if (entry.kind !== "directory") return;
      const opening = !expanded.has(entry.path);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      if (opening && directories[entry.path]?.status !== "ready") {
        void loadDirectory(entry.path);
      }
    },
    [directories, expanded, loadDirectory],
  );

  const selectFile = useCallback((entry: FileTreeEntry) => {
    if (entry.kind === "file") setSelectedPath(entry.path);
  }, []);

  const openDirectoryContextMenu = useCallback(
    (event: ReactMouseEvent, entry: FileTreeEntry) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, entry });
    },
    [],
  );

  useEffect(() => {
    if (contextMenu === null) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const fit = () => {
      setTreeWidth((current) => clampWidth(current, root.clientWidth));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = treeWidth;
      const onMove = (moveEvent: PointerEvent) => {
        const containerWidth = rootRef.current?.clientWidth ?? window.innerWidth;
        setTreeWidth(
          clampWidth(startWidth - (moveEvent.clientX - startX), containerWidth),
        );
      };
      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        setTreeWidth((current) => {
          writeStorage(TREE_WIDTH_KEY, String(current));
          return current;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish, { once: true });
    },
    [treeWidth],
  );

  const resizeWithKeyboard = useCallback((delta: number) => {
    const containerWidth = rootRef.current?.clientWidth ?? window.innerWidth;
    setTreeWidth((current) => {
      const next = clampWidth(current + delta, containerWidth);
      writeStorage(TREE_WIDTH_KEY, String(next));
      return next;
    });
  }, []);

  const copyText = useCallback((text: string, message: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setNotice(message);
        window.setTimeout(() => setNotice(null), 1400);
      })
      .catch(() => {
        setNotice("Copy failed");
        window.setTimeout(() => setNotice(null), 1400);
      });
  }, []);

  const readyWorkspace = workspace?.kind === "ready" ? workspace : null;
  const activePreview =
    previewState.status === "ready" ? previewState.preview : null;
  const viewerTitle = selectedPath === null ? "Files" : basename(selectedPath);
  const selectedFileIntent =
    readyWorkspace !== null && selectedPath !== null
      ? {
          target: {
            kind: "workspace" as const,
            environmentId: readyWorkspace.environmentId,
            path: selectedPath,
          },
          location: null,
        }
      : null;

  const openSelectedInEditor = () => {
    if (selectedFileIntent === null) return;
    if (!navigate.experimental_openFileExternally(selectedFileIntent)) {
      setNotice("No external editor is available");
      window.setTimeout(() => setNotice(null), 1600);
    }
  };

  return (
    <div ref={rootRef} className="bb-ft-root">
      <section className="bb-ft-viewer" aria-label="File preview">
        <div className="bb-ft-viewer-header">
          <div className="bb-ft-viewer-title-group">
            <strong className="bb-ft-viewer-title">{viewerTitle}</strong>
            {selectedPath !== null ? (
              <span className="bb-ft-viewer-path">{selectedPath}</span>
            ) : null}
          </div>
          <div className="bb-ft-viewer-actions">
            {activePreview !== null ? (
              <span className="bb-ft-file-size">
                {formatBytes(activePreview.sizeBytes)}
              </span>
            ) : null}
            {selectedPath !== null ? (
              <>
                <button
                  className="bb-ft-icon-button"
                  type="button"
                  title="Refresh file"
                  aria-label="Refresh file"
                  onClick={() => setPreviewNonce((current) => current + 1)}
                >
                  <RefreshIcon />
                </button>
                {activePreview?.kind === "text" ? (
                  <button
                    className="bb-ft-icon-button"
                    type="button"
                    title="Copy file contents"
                    aria-label="Copy file contents"
                    onClick={() =>
                      copyText(activePreview.content, "File contents copied")
                    }
                  >
                    <CopyIcon />
                  </button>
                ) : null}
                {selectedFileIntent !== null ? (
                  <button
                    className="bb-ft-icon-button"
                    type="button"
                    title="Open in editor"
                    aria-label="Open in editor"
                    onClick={openSelectedInEditor}
                  >
                    <ExternalLinkIcon />
                  </button>
                ) : null}
                {activePreview?.kind === "text" ? (
                  <button
                    className="bb-ft-icon-button"
                    type="button"
                    title={
                      lineOverflowMode === "wrap"
                        ? "Disable line wrap"
                        : "Wrap lines"
                    }
                    aria-label={
                      lineOverflowMode === "wrap"
                        ? "Disable line wrap"
                        : "Wrap lines"
                    }
                    aria-pressed={lineOverflowMode === "wrap"}
                    onClick={() =>
                      setLineOverflowMode((current) =>
                        current === "wrap" ? "scroll" : "wrap",
                      )
                    }
                  >
                    <WrapIcon />
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="bb-ft-viewer-body">
          {selectedPath === null ? (
            <EmptyState>Select a file from the tree.</EmptyState>
          ) : previewState.status === "loading" ? (
            <EmptyState>Loading {basename(selectedPath)}…</EmptyState>
          ) : previewState.status === "error" ? (
            <EmptyState tone="error">{previewState.message}</EmptyState>
          ) : previewState.status === "ready" &&
            previewState.preview.kind === "text" ? (
            <SourceCode
              content={previewState.preview.content}
              path={selectedPath}
              overflow={lineOverflowMode}
              className="bb-ft-source-code"
            />
          ) : previewState.status === "ready" &&
            previewState.preview.kind === "unsupported" ? (
            <EmptyState>{previewState.preview.reason}</EmptyState>
          ) : (
            <EmptyState>Select a file from the tree.</EmptyState>
          )}
        </div>
        {notice !== null ? <div className="bb-ft-notice">{notice}</div> : null}
      </section>

      <div
        className="bb-ft-divider"
        role="separator"
        aria-label="Resize file tree"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            resizeWithKeyboard(24);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            resizeWithKeyboard(-24);
          }
        }}
      />

      <aside className="bb-ft-tree-panel" style={{ width: treeWidth }}>
        <div className="bb-ft-search-wrap">
          <SearchIcon />
          <input
            className="bb-ft-search"
            type="search"
            placeholder="Filter files…"
            aria-label="Filter files"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query !== "") {
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </div>

        <div className="bb-ft-tree-scroll">
          {workspaceError !== null ? (
            <TreeMessage tone="error">
              {workspaceError}
              <button type="button" onClick={() => void loadWorkspace()}>
                Retry
              </button>
            </TreeMessage>
          ) : workspace === null ? (
            <TreeMessage>Loading workspace…</TreeMessage>
          ) : workspace.kind === "unavailable" ? (
            <TreeMessage>{workspace.reason}</TreeMessage>
          ) : query.trim() !== "" ? (
            <SearchResults
              state={searchState}
              workspace={workspace}
              selectedPath={selectedPath}
              onSelect={selectFile}
            />
          ) : rootDirectory?.status === "loading" ||
            rootDirectory === undefined ? (
            <TreeMessage>Loading files…</TreeMessage>
          ) : rootDirectory.status === "error" ? (
            <TreeMessage tone="error">
              {rootDirectory.message}
              <button type="button" onClick={() => void loadDirectory("")}>
                Retry
              </button>
            </TreeMessage>
          ) : (
            <>
              <DirectoryRows
                entries={rootDirectory.entries}
                level={0}
                workspace={workspace}
                directories={directories}
                expanded={expanded}
                selectedPath={selectedPath}
                onSelect={selectFile}
                onToggle={toggleDirectory}
                onRetry={loadDirectory}
                onDirectoryContextMenu={openDirectoryContextMenu}
              />
              {rootDirectory.truncated ? <DirectoryLimitMessage level={0} /> : null}
            </>
          )}
        </div>

        {readyWorkspace !== null ? (
          <div className="bb-ft-tree-footer" title={readyWorkspace.rootPath}>
            <FolderIcon />
            <span>{readyWorkspace.rootName}</span>
          </div>
        ) : null}
      </aside>

      {contextMenu !== null ? (
        <DirectoryContextMenu
          state={contextMenu}
          rootPath={readyWorkspace?.rootPath ?? null}
          onCopy={copyText}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

function FileRow({
  entry,
  level,
  workspace,
  selectedPath,
  onSelect,
}: {
  entry: FileTreeEntry;
  level: number;
  workspace: ReadyWorkspace;
  selectedPath: string | null;
  onSelect: (entry: FileTreeEntry) => void;
}) {
  return (
    <FileLink
      className={`bb-ft-row ${selectedPath === entry.path ? "is-selected" : ""}`}
      style={{ paddingLeft: 8 + level * 14 }}
      title={entry.path}
      aria-current={selectedPath === entry.path ? "true" : undefined}
      target={{
        kind: "workspace",
        environmentId: workspace.environmentId,
        path: entry.path,
      }}
      onClick={(event) => {
        event.preventDefault();
        onSelect(entry);
      }}
    >
      <span className="bb-ft-chevron-slot" />
      <FileIcon path={entry.path} />
      <span className="bb-ft-row-name">{entry.name}</span>
    </FileLink>
  );
}

function DirectoryRows({
  entries,
  level,
  workspace,
  directories,
  expanded,
  selectedPath,
  onSelect,
  onToggle,
  onRetry,
  onDirectoryContextMenu,
}: {
  entries: readonly FileTreeEntry[];
  level: number;
  workspace: ReadyWorkspace;
  directories: Readonly<Record<string, DirectoryState>>;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  onSelect: (entry: FileTreeEntry) => void;
  onToggle: (entry: FileTreeEntry) => void;
  onRetry: (path: string) => Promise<void>;
  onDirectoryContextMenu: (event: ReactMouseEvent, entry: FileTreeEntry) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === "file") {
          return (
            <FileRow
              key={entry.path}
              entry={entry}
              level={level}
              workspace={workspace}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          );
        }

        const isOpen = expanded.has(entry.path);
        const childState = directories[entry.path];
        return (
          <div key={entry.path}>
            <button
              type="button"
              className="bb-ft-row"
              style={{ paddingLeft: 8 + level * 14 }}
              title={entry.path}
              aria-expanded={isOpen}
              onClick={() => onToggle(entry)}
              onContextMenu={(event) => onDirectoryContextMenu(event, entry)}
            >
              <span className="bb-ft-chevron-slot">
                <ChevronIcon open={isOpen} />
              </span>
              <FolderIcon open={isOpen} />
              <span className="bb-ft-row-name">{entry.name}</span>
            </button>
            {isOpen ? (
              childState?.status === "ready" ? (
                <>
                  <DirectoryRows
                    entries={childState.entries}
                    level={level + 1}
                    workspace={workspace}
                    directories={directories}
                    expanded={expanded}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    onRetry={onRetry}
                    onDirectoryContextMenu={onDirectoryContextMenu}
                  />
                  {childState.truncated ? (
                    <DirectoryLimitMessage level={level + 1} />
                  ) : null}
                </>
              ) : childState?.status === "error" ? (
                <div
                  className="bb-ft-child-message is-error"
                  style={{ paddingLeft: 31 + level * 14 }}
                >
                  <span>{childState.message}</span>
                  <button type="button" onClick={() => void onRetry(entry.path)}>
                    Retry
                  </button>
                </div>
              ) : (
                <div
                  className="bb-ft-child-message"
                  style={{ paddingLeft: 31 + level * 14 }}
                >
                  Loading…
                </div>
              )
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function DirectoryLimitMessage({ level }: { level: number }) {
  return (
    <div
      className="bb-ft-child-message"
      style={{ paddingLeft: 31 + level * 14 }}
    >
      Directory is large; showing the first 1,000 entries. Use search for the
      rest.
    </div>
  );
}

function SearchResults({
  state,
  workspace,
  selectedPath,
  onSelect,
}: {
  state: {
    status: "idle" | "loading" | "ready" | "error";
    matches: readonly FileTreeEntry[];
    truncated: boolean;
    message?: string;
  };
  workspace: ReadyWorkspace;
  selectedPath: string | null;
  onSelect: (entry: FileTreeEntry) => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return <TreeMessage>Searching…</TreeMessage>;
  }
  if (state.status === "error") {
    return (
      <TreeMessage tone="error">{state.message ?? "Search failed"}</TreeMessage>
    );
  }
  if (state.matches.length === 0) {
    return <TreeMessage>No matching files.</TreeMessage>;
  }
  return (
    <div className="bb-ft-search-results">
      {state.matches.map((entry) => (
        <FileLink
          key={entry.path}
          className={`bb-ft-search-result ${selectedPath === entry.path ? "is-selected" : ""}`}
          title={entry.path}
          target={{
            kind: "workspace",
            environmentId: workspace.environmentId,
            path: entry.path,
          }}
          onClick={(event) => {
            event.preventDefault();
            onSelect(entry);
          }}
        >
          <FileIcon path={entry.path} />
          <span className="bb-ft-search-result-copy">
            <span className="bb-ft-search-result-name">{entry.name}</span>
            <span className="bb-ft-search-result-path">
              {dirname(entry.path) || "."}
            </span>
          </span>
        </FileLink>
      ))}
      {state.truncated ? (
        <div className="bb-ft-search-truncated">More matches may exist.</div>
      ) : null}
    </div>
  );
}

function DirectoryContextMenu({
  state,
  rootPath,
  onCopy,
  onClose,
}: {
  state: ContextMenuState;
  rootPath: string | null;
  onCopy: (text: string, message: string) => void;
  onClose: () => void;
}) {
  const copy = (value: string, message: string) => {
    onClose();
    onCopy(value, message);
  };
  return (
    <div
      className="bb-ft-context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => copy(state.entry.path, "Path copied")}
      >
        Copy relative path
      </button>
      {rootPath !== null ? (
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            copy(
              absolutePath(rootPath, state.entry.path),
              "Absolute path copied",
            )
          }
        >
          Copy absolute path
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => copy(state.entry.name, "Filename copied")}
      >
        Copy filename
      </button>
    </div>
  );
}

function EmptyState({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div className={`bb-ft-empty ${tone === "error" ? "is-error" : ""}`}>
      {children}
    </div>
  );
}

function TreeMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={`bb-ft-tree-message ${tone === "error" ? "is-error" : ""}`}
    >
      {children}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`bb-ft-chevron ${open ? "is-open" : ""}`}
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path
        d="M5.5 3.5 10 8l-4.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      className="bb-ft-entry-icon bb-ft-folder-icon"
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path
        d={
          open
            ? "M1.75 5.75h12.5l-1.45 6.5H3.2l-1.45-6.5Zm.75-2h4l1 1.25h6v.75H2.5v-2Z"
            : "M2 3.25h4.2l1.2 1.5H14v7.75H2V3.25Z"
        }
        fill="currentColor"
      />
    </svg>
  );
}

function FileIcon({ path: filePath }: { path: string }) {
  const extension =
    basename(filePath).split(".").at(-1)?.toLocaleLowerCase() ?? "";
  const accent = ["ts", "tsx", "js", "jsx"].includes(extension)
    ? "code"
    : ["json", "yaml", "yml", "toml"].includes(extension)
      ? "config"
      : ["md", "mdx", "txt"].includes(extension)
        ? "docs"
        : "default";
  return (
    <svg
      className={`bb-ft-entry-icon bb-ft-file-icon is-${accent}`}
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path
        d="M3 1.75h6l4 4v8.5H3V1.75Zm6 .75v3.75h3.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="bb-ft-search-icon" viewBox="0 0 16 16" aria-hidden>
      <circle
        cx="7"
        cy="7"
        r="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="m10.1 10.1 3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M12.5 5.25A5 5 0 1 0 13 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M9.75 2.75h3v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect
        x="5"
        y="5"
        width="7.5"
        height="8"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M9 2.5h4.5V7M13.25 2.75 7.5 8.5M12.5 9v3.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WrapIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2 4h10M2 7h8.5a2.5 2.5 0 0 1 0 5H8.5M2 10h4M8.5 10v4l-2-2 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "files",
    title: "Files",
    icon: "FolderOpen",
    component: FileTreePanel,
    layout: "flush",
  });
});
