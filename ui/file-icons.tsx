import type { ReactElement } from "react";
import "./file-icons.css";
import { symbols } from "../generated/file-icons";

// Symbols icons (vendor/symbols), resolved as Zeron does: exact basename,
// then the longest compound extension, then the generic icon. Folders match
// by name. Colours are as Symbols authored them, with slate greys made neutral.
function basename(path: string): string {
  return (path.split("/").at(-1) ?? path).toLowerCase();
}
function fileIconId(path: string): string {
  const name = basename(path);
  const exact = symbols.fileNames[name];
  if (exact) return exact;
  for (let index = name.indexOf("."); index !== -1; index = name.indexOf(".", index + 1)) {
    const match = symbols.fileExtensions[name.slice(index + 1)];
    if (match) return match;
  }
  return symbols.file;
}
function folderIconId(path: string): string {
  return symbols.folderNames[basename(path)] ?? symbols.folder;
}
const urls = new Map<string, string>();
function svgUrl(svg: string): string {
  let url = urls.get(svg);
  if (url === undefined) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    urls.set(svg, url);
  }
  return url;
}
function SymbolsIcon({ id, kind }: { id: string; kind: "file" | "directory" }): ReactElement {
  const svg = symbols.icons[id] ?? symbols.icons[symbols.file]!;
  return (
    <img
      className="filetree-entry-icon filetree-symbols-icon"
      data-filetree-icon={kind}
      data-filetree-icon-id={id}
      src={svgUrl(svg)}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
export function FileEntryIcon({
  path,
  kind,
  expanded,
}: {
  path: string;
  kind: "file" | "directory";
  expanded?: boolean;
}): ReactElement {
  const expandable = kind === "directory" && expanded !== undefined;
  return (
    <>
      <span className="filetree-entry-chevron-slot" aria-hidden="true">
        {expandable ? (
          <svg
            className={`filetree-entry-chevron${expanded ? " is-expanded" : ""}`}
            data-filetree-icon="chevron"
            viewBox="0 0 12 12"
          >
            <path
              d="m4.25 2.5 3.5 3.5-3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      <SymbolsIcon
        id={kind === "directory" ? folderIconId(path) : fileIconId(path)}
        kind={kind}
      />
    </>
  );
}
type GitIconKind = "conflicted" | "deleted" | "added" | "renamed" | "modified";
function gitIconKind(
  indexStatus: string,
  worktreeStatus: string,
  conflicted: boolean,
): GitIconKind {
  if (conflicted || indexStatus === "U" || worktreeStatus === "U")
    return "conflicted";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  if (
    indexStatus === "A" ||
    worktreeStatus === "A" ||
    indexStatus === "?" ||
    worktreeStatus === "?"
  )
    return "added";
  if (
    indexStatus === "R" ||
    worktreeStatus === "R" ||
    indexStatus === "C" ||
    worktreeStatus === "C"
  )
    return "renamed";
  return "modified";
}
export function GitStatusIcon({
  indexStatus,
  worktreeStatus,
  conflicted,
}: {
  indexStatus: string;
  worktreeStatus: string;
  conflicted: boolean;
}): ReactElement {
  const kind = gitIconKind(indexStatus, worktreeStatus, conflicted);
  return (
    <svg
      className={`filetree-git-status-icon is-${kind}`}
      data-filetree-git-icon={kind}
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      {kind === "conflicted" ? (
        <>
          <path
            d="M7 1.5 12.5 7 7 12.5 1.5 7 7 1.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M7 4.2v3.6M7 9.7v.1"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </>
      ) : kind === "deleted" ? (
        <path
          d="M3 7h8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ) : kind === "added" ? (
        <path
          d="M7 3v8M3 7h8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : kind === "renamed" ? (
        <>
          <path
            d="M2.5 4.5h7.8M8.2 2.4l2.1 2.1-2.1 2.1M11.5 9.5H3.7M5.8 7.4 3.7 9.5l2.1 2.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <path
          d="m3.2 9.7-.35 1.45 1.45-.35 6.35-6.35-1.1-1.1L3.2 9.7Zm5.7-5.7L10 5.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
