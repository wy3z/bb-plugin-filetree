import { useId } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../vendor/components/ui/resizable";
import { ToolbarButton } from "./toolbar-button";
import { useEffect, useRef, useState } from "react";
import { ResponsiveDrawerShell } from "../vendor/components/ui/responsive-overlay";
import type { NativeFilesData } from "./native-files-data";
import type {
  NativeFilesRoot,
  NativeFilesSelection,
} from "./native-files-ui-types";
import { ExplorerPane } from "./explorer/ExplorerPane";
import { PreviewPane } from "./preview/PreviewPane";
import "./layout.css";
import "./explorer.css";
import "./preview.css";
const TREE_WIDTH_KEY = "bb-plugin-files:tree-width:v1";
const DEFAULT_TREE_WIDTH = 286;
const MIN_TREE_WIDTH = 200;
const MAX_TREE_WIDTH = 560;
const MAX_TREE_RATIO = 0.6;
const MIN_PREVIEW_WIDTH = 220;
const RESIZE_STEP = 24;
const COMPACT_WIDTH = 420;
function storedTreeWidth(): number {
  try {
    const width = Number(window.localStorage.getItem(TREE_WIDTH_KEY));
    return Number.isFinite(width) && width > 0
      ? Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, width))
      : DEFAULT_TREE_WIDTH;
  } catch {
    return DEFAULT_TREE_WIDTH;
  }
}
function saveTreeWidth(width: number): void {
  try {
    window.localStorage.setItem(TREE_WIDTH_KEY, String(width));
  } catch {}
}
function splitMaximum(containerWidth: number): number {
  return Math.max(
    MIN_TREE_WIDTH,
    Math.min(
      MAX_TREE_WIDTH,
      containerWidth * MAX_TREE_RATIO,
      containerWidth - MIN_PREVIEW_WIDTH,
    ),
  );
}
function clampTreeWidth(width: number, containerWidth: number): number {
  return Math.max(
    MIN_TREE_WIDTH,
    Math.min(splitMaximum(containerWidth), width),
  );
}
export function NativeFilesPanel(props: {
  data: NativeFilesData;
  threadId: string;
  initialSelection?: NativeFilesSelection;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const treePanelRef = useRef<ImperativePanelHandle | null>(null);
  const dividerId = useId();
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const layoutWidth = Math.max(1, (containerWidth ?? 800) - 1);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [rootSelectorTarget, setRootSelectorTarget] =
    useState<HTMLDivElement | null>(null);
  const treeWidthRef = useRef(storedTreeWidth());
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [selection, setSelection] = useState<NativeFilesSelection | null>(
    props.initialSelection ?? null,
  );
  const [compactPreviewOpen, setCompactPreviewOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const fit = () => {
      const width = root.getBoundingClientRect().width;
      setCompact(width < COMPACT_WIDTH);
      if (width >= COMPACT_WIDTH) setContainerWidth(width);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setSelection(props.initialSelection ?? null);
    setCompactPreviewOpen(props.initialSelection !== undefined);
  }, [props.threadId, props.initialSelection]);
  useEffect(
    () =>
      props.data.subscribe(props.threadId, (event) => {
        if (
          selection &&
          (event.rootIds === null ||
            event.rootIds.includes(selection.root.rootId))
        )
          setRefreshVersion((value) => value + 1);
      }),
    [props.data, props.threadId, selection?.root.rootId],
  );
  const minimumPercent = (MIN_TREE_WIDTH / layoutWidth) * 100;
  const maximumPercent = (splitMaximum(layoutWidth) / layoutWidth) * 100;
  const restoreTree = () => {
    treePanelRef.current?.resize(
      (clampTreeWidth(treeWidthRef.current, layoutWidth) / layoutWidth) * 100,
    );
    document.getElementById(dividerId)?.focus();
  };
  const select = (next: NativeFilesSelection | null) => {
    setSelection(next);
    if (next !== null) setCompactPreviewOpen(true);
  };
  const explorer = (
    <ExplorerPane
      data={props.data}
      onSelectionChange={select}
      threadId={props.threadId}
      rootSelectorTarget={rootSelectorTarget}
      initialSelection={props.initialSelection}
    />
  );
  const preview = (
    <PreviewPane
      data={props.data}
      onSelectionUnavailable={(unavailable) => {
        setSelection((current) =>
          current?.root.rootId === unavailable.root.rootId &&
          current.path === unavailable.path
            ? null
            : current,
        );
        setCompactPreviewOpen(false);
      }}
      refreshVersion={refreshVersion}
      selection={selection}
      threadId={props.threadId}
      toolbarTarget={compact ? null : toolbarTarget}
    />
  );
  return (
    <div
      ref={rootRef}
      className={`filetree-app${selection ? " has-selection" : ""}${treeCollapsed ? " is-tree-collapsed" : ""}${compact ? " is-compact" : ""}`}
    >
      <div className="filetree-app-toolbar">
        <div className="filetree-app-toolbar-content" ref={setToolbarTarget} />
        <div
          className="filetree-root-selector-target"
          ref={setRootSelectorTarget}
        />
        {!compact ? (
          <ToolbarButton
            className="filetree-tree-toggle"
            label={treeCollapsed ? "Show file tree" : "Hide file tree"}
            aria-expanded={!treeCollapsed}
            onClick={() => {
              if (treeCollapsed) restoreTree();
              else treePanelRef.current?.collapse();
            }}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M2 3h2v2H2zM6 3h8v2H6zM2 7h2v2H2zM6 7h8v2H6zM2 11h2v2H2zM6 11h8v2H6z" />
            </svg>
          </ToolbarButton>
        ) : null}
      </div>
      <div className="filetree-app-body">
        {compact ? (
          <div className="filetree-app-explorer is-compact">{explorer}</div>
        ) : containerWidth === null ? null : (
          <ResizablePanelGroup
            direction="horizontal"
            keyboardResizeBy={(RESIZE_STEP / layoutWidth) * 100}
          >
            <ResizablePanel
              id={`${dividerId}-preview`}
              order={1}
              minSize={100 - maximumPercent}
              className="filetree-app-preview"
            >
              {preview}
            </ResizablePanel>
            <ResizableHandle
              id={dividerId}
              aria-label="Resize file tree"
              onKeyDown={(event) => {
                if (event.key === "Home") {
                  event.preventDefault();
                  treePanelRef.current?.collapse();
                }
              }}
            />
            <ResizablePanel
              ref={treePanelRef}
              id={`${dividerId}-tree`}
              order={2}
              tagName="aside"
              aria-label="File tree pane"
              className="filetree-app-explorer"
              defaultSize={
                treeCollapsed
                  ? 0
                  : (clampTreeWidth(treeWidthRef.current, layoutWidth) /
                      layoutWidth) *
                    100
              }
              minSize={minimumPercent}
              maxSize={maximumPercent}
              collapsible
              collapsedSize={0}
              onCollapse={() => setTreeCollapsed(true)}
              onExpand={() => setTreeCollapsed(false)}
              onResize={(percent) => {
                if (percent > 0) {
                  const width = (percent / 100) * layoutWidth;
                  treeWidthRef.current = width;
                  saveTreeWidth(width);
                }
              }}
            >
              <div hidden={treeCollapsed} className="h-full">
                {explorer}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
      {compact ? (
        <ResponsiveDrawerShell
          open={compactPreviewOpen && selection !== null}
          onOpenChange={setCompactPreviewOpen}
          srLabel="File preview"
          contentClassName="filetree-drawer-panel"
        >
          <div className="filetree-app-preview is-drawer">
            <button
              type="button"
              className="filetree-compact-back"
              aria-label="Back to files"
              title="Back to files"
              onClick={() => setCompactPreviewOpen(false)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="m9.5 3-5 5 5 5" />
              </svg>
            </button>
            {preview}
          </div>
        </ResponsiveDrawerShell>
      ) : null}
    </div>
  );
}
