import { createPortal } from "react-dom";
import { copyText } from "../copy-text";
import { ToolbarButton } from "../toolbar-button";
import { useEffect, useRef, useState } from "react";
import { useBbNavigate, type CodeOverflowMode } from "@get-bb/plugin-sdk/app";
import { NATIVE_FILE_TEXT_PREVIEW_MAX_BYTES } from "../../contracts/model";
import type { NativeFilesData } from "../native-files-data";
import type {
  NativeFilesRoot,
  NativeFilesSelection,
} from "../native-files-ui-types";
import { DocxPreview } from "./docx-preview";
import {
  CopyIcon,
  RefreshIcon,
  OpenEditorIcon,
  WordWrapIcon,
  EyeIcon,
  FileIcon,
} from "./preview-icons";
import { PptxPreview } from "./pptx-preview";
import { routePreview, type PreviewRoute } from "./preview-router";
import {
  HtmlPreview,
  ImagePreview,
  MarkdownPreview,
  PdfPreview,
} from "./simple-previews";
import { SourcePreview } from "./source-preview";
import {
  decodeUtf8,
  fetchTransferPayload,
  NATIVE_FILES_IMAGE_PREVIEW_MAX_BYTES,
  NativeFileTransferError,
  type TransferPayload,
} from "./transfer";
import { XlsxPreview } from "./xlsx-preview";
type PreviewState =
  | {
      status: "idle";
    }
  | {
      status: "loading";
    }
  | {
      status: "ready";
      payload: TransferPayload;
      route: PreviewRoute;
      text: string | null;
    }
  | {
      status: "error";
      message: string;
    };
function key(selection: NativeFilesSelection): string {
  return `${selection.root.rootId}\0${selection.path}`;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The file preview failed.";
}
function selectionUnavailable(error: unknown): boolean {
  if (error instanceof NativeFileTransferError) {
    return error.code === "not-found" || error.code === "stale-root";
  }
  const code =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "code")
      : null;
  return code === "native_file_not_found" || code === "native_file_root_stale";
}
function PreviewBody(props: {
  path: string;
  payload: TransferPayload;
  route: PreviewRoute;
  sourceMode: boolean;
  text: string | null;
  overflow: CodeOverflowMode;
}) {
  if (
    (props.route.kind === "source" || props.sourceMode) &&
    props.text !== null
  ) {
    return (
      <SourcePreview
        content={props.text}
        path={props.path}
        overflow={props.overflow}
      />
    );
  }
  if (props.route.kind === "markdown" && props.text !== null)
    return <MarkdownPreview content={props.text} />;
  if (props.route.kind === "html" && props.text !== null)
    return <HtmlPreview content={props.text} path={props.path} />;
  if (props.route.kind === "image")
    return (
      <ImagePreview
        bytes={props.payload.bytes}
        mimeType={props.route.mimeType}
        path={props.path}
      />
    );
  if (props.route.kind === "pdf")
    return <PdfPreview bytes={props.payload.bytes} path={props.path} />;
  if (props.route.kind === "docx")
    return <DocxPreview bytes={props.payload.bytes} path={props.path} />;
  if (props.route.kind === "xlsx")
    return <XlsxPreview bytes={props.payload.bytes} />;
  if (props.route.kind === "pptx")
    return <PptxPreview bytes={props.payload.bytes} path={props.path} />;
  return (
    <div className="filetree-preview-empty" role="status">
      <p>This file type has no safe inline preview.</p>
      <p>Use Open in editor or save a copy from the file tree menu.</p>
    </div>
  );
}
export function PreviewPane(props: {
  data: NativeFilesData;
  onSelectionUnavailable(selection: NativeFilesSelection): void;
  refreshVersion: number;
  selection: NativeFilesSelection | null;
  threadId: string;
  toolbarTarget: HTMLDivElement | null;
}) {
  const navigation = useBbNavigate();
  const currentKeyRef = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [overflow, setOverflow] = useState<CodeOverflowMode>("wrap");
  useEffect(
    () => setSourceMode(false),
    [props.selection?.path, props.selection?.root.rootId],
  );
  currentKeyRef.current =
    props.selection === null ? null : key(props.selection);
  useEffect(() => {
    setActionError(null);
    if (props.selection === null) {
      setState({ status: "idle" });
      return;
    }
    const selection = props.selection;
    const controller = new AbortController();
    const initialRoute = routePreview(selection.path, null);
    const maxBytes =
      initialRoute.kind === "image"
        ? NATIVE_FILES_IMAGE_PREVIEW_MAX_BYTES
        : initialRoute.kind === "source" ||
            initialRoute.kind === "markdown" ||
            initialRoute.kind === "html"
          ? NATIVE_FILE_TEXT_PREVIEW_MAX_BYTES
          : undefined;
    setState({ status: "loading" });
    void fetchTransferPayload({
      data: props.data,
      maxBytes,
      path: selection.path,
      rootId: selection.root.rootId,
      signal: controller.signal,
      threadId: props.threadId,
    })
      .then((payload) => {
        if (
          controller.signal.aborted ||
          currentKeyRef.current !== key(selection)
        )
          return;
        const route = routePreview(selection.path, payload.mimeType);
        const text =
          route.kind === "source" ||
          route.kind === "markdown" ||
          route.kind === "html"
            ? decodeUtf8(payload.bytes)
            : null;
        setState({ status: "ready", payload, route, text });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          currentKeyRef.current !== key(selection)
        )
          return;
        setState({ status: "error", message: errorMessage(error) });
        if (selectionUnavailable(error))
          props.onSelectionUnavailable(selection);
      });
    return () => controller.abort();
  }, [
    props.data,
    props.selection?.path,
    props.selection?.root.rootId,
    props.threadId,
    props.refreshVersion,
    retry,
  ]);
  if (props.selection === null)
    return (
      <div className="filetree-preview-empty">Select a file to preview it.</div>
    );
  const selection = props.selection;
  const absolutePath = `${selection.root.rootPath.replace(/\/+$/u, "")}/${selection.path}`;
  const text = state.status === "ready" ? state.text : null;
  const canViewSource =
    state.status === "ready" &&
    (state.route.kind === "markdown" || state.route.kind === "html");
  const canWrap =
    state.status === "ready" && (state.route.kind === "source" || sourceMode);
  const openInEditor = () => {
    const root = selection.root;
    const accepted = navigation.experimental_openFileExternally({
      target:
        root.navigationRoot.kind === "workspace"
          ? {
              kind: "workspace",
              environmentId: root.navigationRoot.environmentId,
              path: selection.path,
            }
          : {
              kind: "host",
              hostId: root.hostId,
              path: absolutePath,
            },
      location: null,
    });
    if (!accepted)
      setActionError("The file could not be opened in your preferred editor.");
  };
  const toolbar = (
    <header className="filetree-preview-header">
      <FileIcon className="filetree-preview-file-icon" />
      <button
        type="button"
        className="filetree-preview-path font-mono font-medium leading-5 text-file-accent text-xs rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="Copy file path"
        title="Copy file path"
        onClick={() => void copyText(absolutePath, "path")}
      >
        <span dir="rtl" className="block w-min max-w-full truncate">{`\u200e${selection.path}`}</span>
      </button>
      <div
        className="filetree-preview-actions"
        role="toolbar"
        aria-label="Preview actions"
      >
        <ToolbarButton
          label={
            state.status === "loading" ? "Refreshing file" : "Refresh file"
          }
          disabled={state.status === "loading"}
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshIcon loading={state.status === "loading"} />
        </ToolbarButton>
        {text === null ? null : (
          <ToolbarButton
            label="Copy file contents"
            onClick={() => void copyText(text, "contents")}
          >
            <CopyIcon />
          </ToolbarButton>
        )}
        <ToolbarButton label="Open in editor" onClick={openInEditor}>
          <OpenEditorIcon />
        </ToolbarButton>
        {canViewSource ? (
          <ToolbarButton
            label={sourceMode ? "View rendered" : "View source"}
            aria-pressed={!sourceMode}
            onClick={() => setSourceMode((value) => !value)}
          >
            <EyeIcon />
          </ToolbarButton>
        ) : null}
        {canWrap ? (
          <ToolbarButton
            aria-label="Word wrap"
            label={
              overflow === "wrap" ? "Disable word wrap" : "Enable word wrap"
            }
            aria-pressed={overflow === "wrap"}
            onClick={() =>
              setOverflow((value) => (value === "wrap" ? "scroll" : "wrap"))
            }
          >
            <WordWrapIcon />
          </ToolbarButton>
        ) : null}
      </div>
    </header>
  );
  return (
    <section className="filetree-preview-pane" aria-label="File preview">
      {props.toolbarTarget ? createPortal(toolbar, props.toolbarTarget) : toolbar}
      {actionError === null ? null : (
        <p className="filetree-preview-error" role="alert">
          {actionError}
        </p>
      )}
      <div className="filetree-preview-content">
        {state.status === "loading" ? (
          <p role="status">Loading preview…</p>
        ) : null}
        {state.status === "error" ? (
          <div className="filetree-preview-empty" role="alert">
            <p>{state.message}</p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry preview
            </button>
          </div>
        ) : null}
        {state.status === "ready" ? (
          <PreviewBody
            route={state.route}
            payload={state.payload}
            path={selection.path}
            text={state.text}
            sourceMode={sourceMode}
            overflow={overflow}
          />
        ) : null}
      </div>
    </section>
  );
}
