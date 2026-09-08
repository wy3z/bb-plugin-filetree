import { copyText } from "../copy-text";
import { Input } from "../../vendor/components/ui/input";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH } from "../../contracts/model";
import { ResponsiveDrawerShell } from "../../vendor/components/ui/responsive-overlay";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "../../vendor/components/ui/context-menu";
import type { NativeFilesData } from "../native-files-data";
import type {
  NativeFilesEntry,
  NativeFilesGitChange,
  NativeFilesRoot,
  NativeFilesSelection,
} from "../native-files-ui-types";
import { FileEntryIcon, GitStatusIcon } from "../file-icons";
import { buildCompactTree } from "./compact-chains";
import {
  changeByPath,
  descendantChangeCount,
  gitStatusLabel,
} from "./git-tree";
import { RootSelector } from "./root-selector";
import { StickyAncestors, stickyAncestorsForIndex } from "./sticky-ancestors";
import {
  firstChildPath,
  flattenCompactTree,
  flattenDirectoryTree,
  parentRowPath,
  type DirectorySnapshot,
  type ExplorerTreeRow,
} from "./tree-model";
import { adjacentPath, treeKeyboardCommand } from "./tree-keyboard";
import { useExplorerState } from "./use-explorer-state";
import { useRootData } from "./use-root-data";
import {
  buildVirtualTreeLayout,
  scrollTopForVirtualTreeIndex,
  virtualTreeIndexAtOffset,
  virtualTreeRange,
} from "./virtual-tree";
const ROW_HEIGHT = 28;
const STATUS_ROW_HEIGHT = 30;
const VIRTUAL_OVERSCAN = 8;
const MENU_COMPACT_WIDTH = 240;
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed.";
}
function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
function rowHeight(row: ExplorerTreeRow): number {
  if (row.entry.kind !== "directory" || !row.expanded) return ROW_HEIGHT;
  if (
    row.childState?.status === "loading" ||
    row.childState?.status === "error" ||
    (row.childState?.status === "ready" && row.childState.truncated)
  ) {
    return ROW_HEIGHT + STATUS_ROW_HEIGHT;
  }
  return ROW_HEIGHT;
}
function useCompactElement(ref: React.RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () =>
      setCompact(element.getBoundingClientRect().width < MENU_COMPACT_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return compact;
}
interface RootExplorerProps {
  initialPath?: string;
  data: NativeFilesData;
  onSelectionChange(selection: NativeFilesSelection | null): void;
  root: NativeFilesRoot;
  threadId: string;
}
function RootExplorer(props: RootExplorerProps) {
  const view = useExplorerState({
    storage: window.localStorage,
    threadId: props.threadId,
    rootId: props.root.rootId,
    initialPath: props.initialPath,
  });
  const explorerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const menuRestoreFocusRef = useRef(true);
  const requestsRef = useRef(new Map<string, AbortController>());
  const [directories, setDirectories] = useState<
    ReadonlyMap<string, DirectorySnapshot>
  >(new Map());
  const directoriesRef = useRef(directories);
  const [gitChanges, setGitChanges] = useState<readonly NativeFilesGitChange[]>(
    [],
  );
  const [gitNotice, setGitNotice] = useState<string | null>(null);
  const [search, setSearch] = useState<{
    entries: readonly NativeFilesEntry[];
    message: string | null;
    status: "idle" | "loading" | "ready" | "error";
    truncated: boolean;
  }>({ entries: [], message: null, status: "idle", truncated: false });
  const [collapsedCompact, setCollapsedCompact] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [focusPath, setFocusPath] = useState<string | null>(
    view.state.selectedPath,
  );
  const [scrollTop, setScrollTop] = useState(view.state.scrollTop);
  const [viewportHeight, setViewportHeight] = useState(560);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    kind: "file" | "directory";
    path: string;
  } | null>(null);
  const compactMenu = useCompactElement(explorerRef);
  directoriesRef.current = directories;
  const loadDirectory = useCallback(
    async (path: string, force = false) => {
      const existing = directoriesRef.current.get(path);
      if (!force && existing?.status === "ready") return existing;
      requestsRef.current.get(path)?.abort();
      const controller = new AbortController();
      requestsRef.current.set(path, controller);
      setDirectories((current) => {
        const next = new Map(current);
        if (existing?.status !== "ready") next.set(path, { status: "loading" });
        return next;
      });
      try {
        const result = await props.data.listDirectory({
          path,
          rootId: props.root.rootId,
          signal: controller.signal,
          threadId: props.threadId,
        });
        if (
          controller.signal.aborted ||
          result.rootId !== props.root.rootId ||
          result.path !== path
        ) {
          throw new DOMException("Stale directory response", "AbortError");
        }
        const snapshot: DirectorySnapshot = {
          entries: result.entries,
          status: "ready",
          truncated: result.truncated,
        };
        setDirectories((current) => new Map(current).set(path, snapshot));
        return snapshot;
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setDirectories((current) =>
            new Map(current).set(path, {
              status: "error",
              message: errorMessage(error),
            }),
          );
        }
        throw error;
      } finally {
        if (requestsRef.current.get(path) === controller)
          requestsRef.current.delete(path);
      }
    },
    [props.data, props.root.rootId, props.threadId],
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      await loadDirectory("");
      const expanded = [...view.state.expanded].sort(
        (left, right) => left.split("/").length - right.split("/").length,
      );
      for (const path of expanded) {
        if (!active) return;
        await loadDirectory(path).catch(() => undefined);
      }
      const selectedPath = view.state.selectedPath;
      if (!active || selectedPath === null) return;
      const parent = parentPath(selectedPath);
      const listing = await loadDirectory(parent).catch(() => null);
      if (
        active &&
        listing?.status === "ready" &&
        listing.entries.some(
          (entry) => entry.kind === "file" && entry.path === selectedPath,
        )
      ) {
        props.onSelectionChange({ root: props.root, path: selectedPath });
      } else if (active) {
        view.setSelectedPath(null);
      }
    })().catch(() => undefined);
    return () => {
      active = false;
      for (const controller of requestsRef.current.values()) controller.abort();
      requestsRef.current.clear();
    };
  }, [loadDirectory]);
  useEffect(() => {
    const controller = new AbortController();
    setGitNotice(null);
    void props.data
      .gitStatus({
        rootId: props.root.rootId,
        signal: controller.signal,
        threadId: props.threadId,
      })
      .then((result) => {
        if (controller.signal.aborted || result.rootId !== props.root.rootId)
          return;
        if (result.kind === "ready") setGitChanges(result.changes);
        else {
          setGitChanges([]);
          if (result.kind === "unavailable") setGitNotice(result.reason);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setGitNotice(errorMessage(error));
      });
    return () => controller.abort();
  }, [props.data, props.root.rootId, props.threadId, refreshVersion]);
  useEffect(
    () =>
      props.data.subscribe(props.threadId, (invalidation) => {
        if (
          invalidation.rootIds === null ||
          invalidation.rootIds.includes(props.root.rootId)
        ) {
          setRefreshVersion((value) => value + 1);
          for (const path of new Set(["", ...directoriesRef.current.keys()])) {
            void loadDirectory(path, true).catch(() => undefined);
          }
        }
      }),
    [loadDirectory, props.data, props.root.rootId, props.threadId],
  );
  useEffect(() => {
    const query = view.state.query.trim();
    if (query === "") {
      setSearch({
        entries: [],
        message: null,
        status: "idle",
        truncated: false,
      });
      return;
    }
    const controller = new AbortController();
    setSearch({
      entries: [],
      message: null,
      status: "loading",
      truncated: false,
    });
    const timer = window.setTimeout(() => {
      void props.data
        .search({
          limit: 200,
          query,
          rootId: props.root.rootId,
          signal: controller.signal,
          threadId: props.threadId,
        })
        .then((result) => {
          if (
            !controller.signal.aborted &&
            result.rootId === props.root.rootId
          ) {
            setCollapsedCompact(new Set());
            setSearch({
              entries: result.matches,
              message: null,
              status: "ready",
              truncated: result.truncated,
            });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setSearch({
              entries: [],
              message: errorMessage(error),
              status: "error",
              truncated: false,
            });
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [props.data, props.root.rootId, props.threadId, view.state.query]);
  const changesByPath = useMemo(() => changeByPath(gitChanges), [gitChanges]);
  const allRows = useMemo(
    () =>
      flattenDirectoryTree({
        directories,
        expanded: view.state.expanded,
        changes: changesByPath,
      }),
    [changesByPath, directories, view.state.expanded],
  );
  const searchRows = useMemo(
    () =>
      flattenCompactTree(
        buildCompactTree(search.entries.map((entry) => ({ entry }))),
        collapsedCompact,
      ),
    [collapsedCompact, search.entries],
  );
  const showSearch = view.state.query.trim() !== "";
  const rows = showSearch ? searchRows : allRows;
  const layout = useMemo(
    () =>
      buildVirtualTreeLayout(rows.length, (index) => rowHeight(rows[index]!)),
    [rows],
  );
  const range = useMemo(
    () => virtualTreeRange(layout, scrollTop, viewportHeight, VIRTUAL_OVERSCAN),
    [layout, scrollTop, viewportHeight],
  );
  const stickyRows = useMemo(
    () =>
      stickyAncestorsForIndex(
        rows,
        virtualTreeIndexAtOffset(layout, scrollTop),
      ),
    [layout, rows, scrollTop],
  );
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTop = view.state.scrollTop;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 560);
  }, []);
  useEffect(() => {
    if (
      rows.length > 0 &&
      (focusPath === null || !rows.some((row) => row.entry.path === focusPath))
    ) {
      setFocusPath(rows[0]!.entry.path);
    }
  }, [focusPath, rows]);
  const focusRow = (path: string) => {
    setFocusPath(path);
    const existing = rowRefs.current.get(path);
    if (existing !== undefined) {
      existing.focus();
      existing.scrollIntoView({ block: "nearest" });
      return;
    }
    const index = rows.findIndex((row) => row.entry.path === path);
    const element = scrollRef.current;
    if (index < 0 || element === null) return;
    const next = scrollTopForVirtualTreeIndex({
      index,
      layout,
      scrollTop: element.scrollTop,
      viewportHeight: element.clientHeight || viewportHeight,
    });
    element.scrollTop = next;
    setScrollTop(next);
    requestAnimationFrame(() => rowRefs.current.get(path)?.focus());
  };
  const toggleDirectory = (row: ExplorerTreeRow) => {
    if (row.entry.kind !== "directory") return;
    if (showSearch && row.compactLabel !== null) {
      const next = new Set(collapsedCompact);
      if (row.expanded) next.add(row.entry.path);
      else next.delete(row.entry.path);
      setCollapsedCompact(next);
      return;
    }
    const next = new Set(view.state.expanded);
    if (row.expanded) next.delete(row.entry.path);
    else {
      next.add(row.entry.path);
      void loadDirectory(row.entry.path).catch(() => undefined);
    }
    view.setExpanded(next);
  };
  const revealSearchResult = async (path: string) => {
    view.setQuery("");
    const segments = path.split("/");
    const expanded = new Set(view.state.expanded);
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join("/");
      expanded.add(directory);
      await loadDirectory(parentPath(directory)).catch(() => undefined);
      await loadDirectory(directory).catch(() => undefined);
    }
    view.setExpanded(expanded);
    view.setSelectedPath(path);
    props.onSelectionChange({ root: props.root, path });
    window.setTimeout(() => focusRow(path), 0);
  };
  const selectFile = (path: string) => {
    view.setSelectedPath(path);
    props.onSelectionChange({ root: props.root, path });
  };
  const handleKey = (
    event: ReactKeyboardEvent<HTMLElement>,
    row: ExplorerTreeRow,
    index: number,
  ) => {
    const command = treeKeyboardCommand(event.key, event.shiftKey);
    if (command === null) return;
    event.preventDefault();
    const paths = rows.map((candidate) => candidate.entry.path);
    if (command === "next") focusRow(adjacentPath(paths, row.entry.path, 1));
    else if (command === "previous")
      focusRow(adjacentPath(paths, row.entry.path, -1));
    else if (command === "first") focusRow(paths[0] ?? row.entry.path);
    else if (command === "last") focusRow(paths.at(-1) ?? row.entry.path);
    else if (command === "activate") {
      if (row.entry.kind === "directory") toggleDirectory(row);
      else if (showSearch) void revealSearchResult(row.entry.path);
      else selectFile(row.entry.path);
    } else if (command === "collapse-or-parent") {
      if (row.entry.kind === "directory" && row.expanded) toggleDirectory(row);
      else {
        const parent = parentRowPath(rows, index);
        if (parent !== null) focusRow(parent);
      }
    } else if (command === "expand-or-child") {
      if (row.entry.kind === "directory" && !row.expanded) toggleDirectory(row);
      else {
        const child = firstChildPath(rows, index);
        if (child !== null) focusRow(child);
      }
    } else if (command === "context-menu") {
      const bounds = event.currentTarget.getBoundingClientRect();
      event.currentTarget.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: bounds.left,
          clientY: bounds.bottom,
        }),
      );
    } else if (command === "escape") {
      setContextMenu(null);
      if (view.state.query !== "") view.setQuery("");
    }
  };
  const openContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    path: string,
    kind: "file" | "directory",
  ) => {
    if (compactMenu) event.preventDefault();
    menuRestoreFocusRef.current = true;
    menuTriggerRef.current = event.currentTarget;
    setContextMenu({ kind, path });
  };
  const closeContextMenu = (restoreFocus: boolean) => {
    setContextMenu(null);
    if (restoreFocus) menuTriggerRef.current?.focus();
  };
  const saveCopy = async (path: string) => {
    const controller = new AbortController();
    try {
      const transfer = await props.data.createTransfer({
        path,
        rootId: props.root.rootId,
        signal: controller.signal,
        threadId: props.threadId,
      });
      const anchor = document.createElement("a");
      anchor.href = transfer.contentUrl;
      anchor.download = transfer.filename;
      anchor.rel = "noopener";
      anchor.click();
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    }
  };
  const menuKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeContextMenu(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const menu = event.currentTarget.closest<HTMLElement>("[role=menu]");
    const items = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]") ?? [],
    );
    const index = items.indexOf(event.currentTarget);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    items[(index + direction + items.length) % items.length]?.focus();
  };
  const menuContent =
    contextMenu === null ? null : (
      <div className="filetree-context-menu-items" role="menu">
        <button
          autoFocus
          type="button"
          role="menuitem"
          onKeyDown={menuKeyDown}
          onClick={() => {
            const path = contextMenu.path;
            closeContextMenu(true);
            void navigator.clipboard
              .writeText(path)
              .catch((error: unknown) => setNotice(errorMessage(error)));
          }}
        >
          {contextMenu.kind === "directory"
            ? "Copy relative path"
            : "Copy path"}
        </button>
        {contextMenu.kind === "file" ? (
          <>
            <button
              type="button"
              role="menuitem"
              onKeyDown={menuKeyDown}
              onClick={() => {
                const path = contextMenu.path;
                closeContextMenu(true);
                void saveCopy(path);
              }}
            >
              Save a copy
            </button>
          </>
        ) : null}
      </div>
    );
  const renderRow = (row: ExplorerTreeRow, index: number) => {
    const selected = view.state.selectedPath === row.entry.path;
    const label = row.compactLabel ?? row.entry.name;
    const change = row.change ?? changesByPath.get(row.entry.path);
    const directoryChanges =
      row.entry.kind === "directory"
        ? descendantChangeCount(row.entry.path, gitChanges)
        : 0;
    const common = {
      ref: (element: HTMLButtonElement | null) => {
        if (element === null) rowRefs.current.delete(row.entry.path);
        else rowRefs.current.set(row.entry.path, element);
      },
      role: "treeitem" as const,
      tabIndex: focusPath === row.entry.path ? 0 : -1,
      "aria-level": row.level,
      "aria-label": [
        label,
        row.entry.kind,
        change ? gitStatusLabel(change) : null,
        directoryChanges > 0 ? `${directoryChanges} changed files` : null,
      ]
        .filter(Boolean)
        .join(", "),
      "aria-selected": row.entry.kind === "file" ? selected : undefined,
      "aria-expanded":
        row.entry.kind === "directory" ? row.expanded : undefined,
      "data-filetree-path": row.entry.path,
      className: `filetree-tree-row${selected ? " is-selected" : ""}`,
      style: { paddingInlineStart: `${8 + (row.level - 1) * 14}px` },
      onFocus: () => setFocusPath(row.entry.path),
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) =>
        handleKey(event, row, index),
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) =>
        openContextMenu(event, row.entry.path, row.entry.kind),
    };
    return (
      <div className="filetree-tree-row-wrap" key={row.entry.path}>
        <button
          type="button"
          {...common}
          onClick={() => {
            if (row.entry.kind === "directory") toggleDirectory(row);
            else if (showSearch) void revealSearchResult(row.entry.path);
            else selectFile(row.entry.path);
          }}
        >
          <FileEntryIcon
            path={row.entry.path}
            kind={row.entry.kind}
            expanded={row.entry.kind === "directory" ? row.expanded : undefined}
          />
          <span className="filetree-row-label">{label}</span>
          {change ? (
            <span
              className="filetree-git-status"
              title={gitStatusLabel(change)}
            >
              <GitStatusIcon
                indexStatus={change.indexStatus}
                worktreeStatus={change.worktreeStatus}
                conflicted={change.conflicted}
              />
            </span>
          ) : directoryChanges > 0 ? (
            <span
              className="filetree-directory-change-count"
              title={`${directoryChanges} changed files`}
            >
              {directoryChanges}
            </span>
          ) : null}
        </button>
        {row.entry.kind === "directory" &&
        row.expanded &&
        row.childState?.status === "loading" ? (
          <div className="filetree-tree-message">Loading…</div>
        ) : null}
        {row.entry.kind === "directory" &&
        row.expanded &&
        row.childState?.status === "error" ? (
          <button
            type="button"
            className="filetree-tree-message is-error"
            onClick={() =>
              void loadDirectory(row.entry.path, true).catch(() => undefined)
            }
          >
            {row.childState.message} Retry
          </button>
        ) : null}
        {row.entry.kind === "directory" &&
        row.expanded &&
        row.childState?.status === "ready" &&
        row.childState.truncated ? (
          <div className="filetree-tree-message">
            Directory limited to 1,000 entries. Search can find more.
          </div>
        ) : null}
      </div>
    );
  };
  const rootDirectory = directories.get("");
  const busy = showSearch
    ? search.status === "loading"
    : rootDirectory?.status === "loading";
  const emptyMessage = showSearch
    ? search.status === "error"
      ? search.message
      : search.status === "ready" && rows.length === 0
        ? "No matching files or folders."
        : null
    : rootDirectory?.status === "error"
      ? rootDirectory.message
      : rootDirectory?.status === "ready" && rows.length === 0
        ? "This root is empty."
        : null;
  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) setContextMenu(null);
      }}
    >
      <section
        ref={explorerRef}
        className="filetree-explorer-pane"
        aria-label="File explorer"
      >
        <div className="filetree-explorer-controls">
          <Input
            className="h-7 min-w-0 text-xs"
            type="search"
            maxLength={NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH}
            value={view.state.query}
            aria-label="Search file names and paths"
            placeholder="Search files"
            onChange={(event) => view.setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && view.state.query !== "") {
                event.preventDefault();
                view.setQuery("");
              }
            }}
          />
        </div>
        <ContextMenuTrigger
          asChild
          disabled={compactMenu}
          onContextMenu={(event) => {
            if (
              !(event.target instanceof Element) ||
              !event.target.closest("[data-filetree-path]")
            ) {
              event.preventDefault();
            }
          }}
        >
          <div className="filetree-tree-shell">
            <StickyAncestors rows={stickyRows} />
            <div
              ref={scrollRef}
              className="filetree-tree-scroll"
              role="tree"
              aria-label={showSearch ? "Search results" : "Workspace files"}
              aria-busy={busy}
              onScroll={(event) => {
                const next = event.currentTarget.scrollTop;
                setScrollTop(next);
                setViewportHeight(event.currentTarget.clientHeight || 560);
                view.setScrollTop(next);
              }}
            >
              {busy && rows.length === 0 ? <p role="status">Loading…</p> : null}
              {emptyMessage !== null ? (
                <p role="status" className="filetree-tree-empty">
                  {emptyMessage}
                </p>
              ) : null}
              {rows.length > 0 ? (
                <div
                  className="filetree-virtual-spacer"
                  style={{ height: `${layout.totalHeight}px` }}
                >
                  <div
                    className="filetree-virtual-window"
                    style={{
                      transform: `translateY(${layout.offsets[range.start] ?? 0}px)`,
                    }}
                  >
                    {rows
                      .slice(range.start, range.end)
                      .map((row, visibleIndex) =>
                        renderRow(row, range.start + visibleIndex),
                      )}
                  </div>
                </div>
              ) : null}
              {showSearch && search.truncated ? (
                <p className="filetree-tree-limit">
                  Search limited to the first 200 results.
                </p>
              ) : null}
            </div>
          </div>
        </ContextMenuTrigger>
        {gitNotice === null ? null : (
          <div className="filetree-notice" role="status">
            <span>{gitNotice}</span>
            <button
              type="button"
              aria-label="Dismiss Git notice"
              onClick={() => setGitNotice(null)}
            >
              ×
            </button>
          </div>
        )}
        {notice === null ? null : (
          <div className="filetree-notice" role="status">
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}
        {contextMenu !== null && compactMenu ? (
          <ResponsiveDrawerShell
            open
            onOpenChange={(open) => {
              if (!open) closeContextMenu(false);
            }}
            onAfterCloseAutoFocus={() => menuTriggerRef.current?.focus()}
            srLabel={`${contextMenu.kind === "file" ? "File" : "Folder"} actions`}
            contentClassName="filetree-context-drawer"
          >
            {menuContent}
          </ResponsiveDrawerShell>
        ) : null}
        {contextMenu !== null && !compactMenu ? (
          <ContextMenuContent
            onInteractOutside={() => {
              menuRestoreFocusRef.current = false;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (menuRestoreFocusRef.current) menuTriggerRef.current?.focus();
            }}
          >
            <ContextMenuItem
              onSelect={() => {
                void copyText(contextMenu.path, "path");
              }}
            >
              {contextMenu.kind === "directory"
                ? "Copy relative path"
                : "Copy path"}
            </ContextMenuItem>
            {contextMenu.kind === "file" ? (
              <ContextMenuItem onSelect={() => void saveCopy(contextMenu.path)}>
                Save a copy
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        ) : null}
      </section>
    </ContextMenu>
  );
}
export function ExplorerPane(
  props: Omit<RootExplorerProps, "root" | "initialPath"> & {
    rootSelectorTarget: HTMLDivElement | null;
    initialSelection?: NativeFilesSelection;
  },
) {
  const rootData = useRootData({
    initialRootId: props.initialSelection?.root.rootId,
    data: props.data,
    storage: window.localStorage,
    threadId: props.threadId,
  });
  useEffect(
    () =>
      props.data.subscribe(props.threadId, (event) => {
        if (event.rootIds === null) void rootData.reload();
      }),
    [props.data, props.threadId, rootData.reload],
  );
  if (rootData.state.status === "loading")
    return (
      <div className="filetree-explorer-empty" role="status">
        Loading workspace roots…
      </div>
    );
  if (
    rootData.state.status === "unavailable" ||
    rootData.state.status === "error"
  ) {
    return (
      <div className="filetree-explorer-empty" role="alert">
        <p>{rootData.state.message}</p>
        <button type="button" onClick={() => void rootData.reload()}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <>
      {rootData.state.roots.length > 1 && props.rootSelectorTarget
        ? createPortal(
            <RootSelector
              roots={rootData.state.roots}
              selectedRootId={rootData.state.selected.rootId}
              onChange={(rootId) => {
                if (
                  rootData.state.status !== "ready" ||
                  rootId === rootData.state.selected.rootId
                )
                  return;
                props.onSelectionChange(null);
                rootData.selectRoot(rootId);
              }}
            />,
            props.rootSelectorTarget,
          )
        : null}
      <RootExplorer
        {...props}
        key={`${props.threadId}:${rootData.state.selected.rootId}`}
        root={rootData.state.selected}
        initialPath={
          props.initialSelection?.root.rootId === rootData.state.selected.rootId
            ? props.initialSelection.path
            : undefined
        }
      />
    </>
  );
}
