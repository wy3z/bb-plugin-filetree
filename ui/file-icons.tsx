import type { ReactElement } from "react";
import "./file-icons.css";
type FileCategory =
  | "source"
  | "config"
  | "docs"
  | "image"
  | "office"
  | "archive"
  | "media"
  | "default";
const sourceExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "lua",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "ts",
  "tsx",
  "vue",
]);
const configExtensions = new Set([
  "conf",
  "config",
  "env",
  "ini",
  "json",
  "lock",
  "properties",
  "toml",
  "xml",
  "yaml",
  "yml",
]);
const docsExtensions = new Set([
  "adoc",
  "csv",
  "log",
  "md",
  "mdx",
  "pdf",
  "rst",
  "rtf",
  "txt",
]);
const imageExtensions = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);
const officeExtensions = new Set([
  "doc",
  "docm",
  "docx",
  "odp",
  "ods",
  "odt",
  "ppt",
  "pptm",
  "pptx",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
]);
const archiveExtensions = new Set([
  "7z",
  "bz",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);
const mediaExtensions = new Set([
  "aac",
  "avi",
  "flac",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "mpeg",
  "mpg",
  "ogg",
  "opus",
  "wav",
  "webm",
]);
function filename(path: string): string {
  return path.split(/[\\/]/u).at(-1)?.toLocaleLowerCase() ?? "";
}
function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1);
}
function specialName(name: string): string | null {
  if (/^readme(?:\.|$)/u.test(name)) return "readme";
  if (/^(?:agents|claude)\.md$/u.test(name)) return "agent";
  if (/^(?:dockerfile|compose\.ya?ml|docker-compose\.ya?ml)$/u.test(name)) {
    return "container";
  }
  if (/^(?:makefile|justfile|taskfile\.ya?ml)$/u.test(name)) return "task";
  if (
    /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/u.test(
      name,
    )
  ) {
    return "package";
  }
  if (/^(?:tsconfig|jsconfig)(?:\.[^.]+)?\.json$/u.test(name))
    return "typescript";
  if (/^\.git(?:ignore|attributes|modules)$/u.test(name)) return "git";
  if (/^(?:license|licence|copying)(?:\.|$)/u.test(name)) return "license";
  return null;
}
function categoryFor(name: string, special: string | null): FileCategory {
  if (special === "readme" || special === "agent" || special === "license") {
    return "docs";
  }
  if (special === "container" || special === "task" || special === "package") {
    return "config";
  }
  if (special === "typescript") return "source";
  if (special === "git") return "config";
  const suffix = extension(name);
  if (sourceExtensions.has(suffix)) return "source";
  if (configExtensions.has(suffix)) return "config";
  if (docsExtensions.has(suffix)) return "docs";
  if (imageExtensions.has(suffix)) return "image";
  if (officeExtensions.has(suffix)) return "office";
  if (archiveExtensions.has(suffix)) return "archive";
  if (mediaExtensions.has(suffix)) return "media";
  return "default";
}
function FileMark({
  category,
  special,
}: {
  category: FileCategory;
  special: string | null;
}) {
  if (special === "agent") {
    return (
      <path
        d="m8 4 .72 1.82L10.6 6.5l-1.88.68L8 9l-.72-1.82L5.4 6.5l1.88-.68L8 4Z"
        fill="currentColor"
      />
    );
  }
  if (special === "container") {
    return (
      <path
        d="M5.1 7.1h5.8v2H9.8c-.45 1-1.35 1.5-2.7 1.5-1.15 0-1.95-.47-2.4-1.4h.9l-.5-2.1Zm1-.9h1v.9h-1v-.9Zm1.5 0h1v.9h-1v-.9Zm1.5 0h1v.9h-1v-.9Z"
        fill="currentColor"
      />
    );
  }
  if (special === "git") {
    return (
      <path
        d="M6 5.1a.8.8 0 1 1 1 1.14v2.02a.8.8 0 1 1-.65 0V6.24A.8.8 0 0 1 6 5.1Zm3.15.55a.8.8 0 1 1 .65.04v.8c0 .7-.57 1.28-1.28 1.28h-.45v-.7h.45c.32 0 .58-.26.58-.58v-.8a.8.8 0 0 1 .05-.04Z"
        fill="currentColor"
      />
    );
  }
  if (special === "package") {
    return (
      <path
        d="m5.1 6.2 2.9-1.5 2.9 1.5v3.4L8 11.2 5.1 9.6V6.2Zm.85.3L8 7.55l2.05-1.05L8 5.45 5.95 6.5ZM7.6 8.2 5.8 7.28v1.9l1.8 1V8.2Zm.8 1.98 1.8-1v-1.9l-1.8.92v1.98Z"
        fill="currentColor"
      />
    );
  }
  if (special === "task") {
    return (
      <path
        d="m5.15 6.35.65.65 1.15-1.3.55.5-1.68 1.9-1.2-1.2.53-.55Zm3.1-.25h2.4v.75h-2.4V6.1Zm-3.1 3.05.65.65 1.15-1.3.55.5-1.68 1.9-1.2-1.2.53-.55Zm3.1-.25h2.4v.75h-2.4V8.9Z"
        fill="currentColor"
      />
    );
  }
  if (special === "typescript") {
    return (
      <path
        d="M4.8 6h6.4v1H8.5v4h-1V7H4.8V6Zm4.1 2.1c.35-.35.8-.52 1.35-.52.52 0 .95.14 1.3.42l-.45.68a1.48 1.48 0 0 0-.83-.28c-.27 0-.42.08-.42.23 0 .14.17.25.52.34.86.2 1.28.58 1.28 1.14 0 .64-.53 1.04-1.43 1.04-.62 0-1.12-.18-1.5-.54l.5-.68c.3.27.64.4 1.02.4.3 0 .46-.08.46-.25 0-.15-.2-.28-.6-.38-.78-.2-1.18-.56-1.18-1.08 0-.2.06-.37.18-.52Z"
        fill="currentColor"
      />
    );
  }
  if (special === "license") {
    return (
      <path
        d="M8 5.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 .8a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 8 6Zm-1.2 3.1.55.35-.42 1.65L8 10.5l1.07.6-.42-1.65.55-.35.72 3L8 11.05 6.08 12.1l.72-3Z"
        fill="currentColor"
      />
    );
  }
  if (category === "source") {
    return (
      <path
        d="m6.8 6-2 2 2 2 .65-.65L6.1 8l1.35-1.35L6.8 6Zm2.4 0-.65.65L9.9 8 8.55 9.35l.65.65 2-2-2-2Z"
        fill="currentColor"
      />
    );
  }
  if (category === "config") {
    return (
      <path
        d="M5 6h1.5v1H5V6Zm2.3 0H11v1H7.3V6ZM5 8h3.2v1H5V8Zm4 0h2v1H9V8Zm-4 2h1.8v1H5v-1Zm2.6 0H11v1H7.6v-1Z"
        fill="currentColor"
      />
    );
  }
  if (category === "docs") {
    return (
      <path
        d="M5 6h6v.85H5V6Zm0 1.75h6v.85H5v-.85Zm0 1.75h4.2v.85H5V9.5Z"
        fill="currentColor"
      />
    );
  }
  if (category === "image") {
    return (
      <path
        d="M5 5.8h6v5H5v-5Zm.75.75v2.7l1.3-1.3.85.8 1.05-1.05 1.3 1.35v-2.5h-4.5Zm3.35.2a.55.55 0 1 0 0 1.1.55.55 0 0 0 0-1.1Z"
        fill="currentColor"
      />
    );
  }
  if (category === "office") {
    return (
      <path
        d="M5.2 5.7h5.6v5.1H5.2V5.7Zm.8.8V10h.9V6.5H6Zm1.45 0V10h.9V6.5h-.9Zm1.45 0V10h1V6.5h-1Z"
        fill="currentColor"
      />
    );
  }
  if (category === "archive") {
    return (
      <path
        d="M6.2 5.2h3.6v1H8.4v.7h1.4v1H8.4v.7h1.4v2.2H6.2V8.6h1.4v-.7H6.2v-1h1.4v-.7H6.2v-1Zm.8 4.2v.7h2v-.7H7Z"
        fill="currentColor"
      />
    );
  }
  if (category === "media") {
    return (
      <path
        d="M9.9 5.2v4.05a1.35 1.35 0 1 1-.8-1.23V6.1l-2.4.55v3.1a1.35 1.35 0 1 1-.8-1.23V6l4-.8Z"
        fill="currentColor"
      />
    );
  }
  return (
    <path
      d="M5.2 6.2h5.6V7H5.2v-.8Zm0 1.7h5.6v.8H5.2v-.8Zm0 1.7h3.5v.8H5.2v-.8Z"
      fill="currentColor"
    />
  );
}
function FileSvg({ path }: { path: string }): ReactElement {
  const name = filename(path);
  const special = specialName(name);
  const category = categoryFor(name, special);
  return (
    <svg
      className={`filetree-entry-icon filetree-file-icon is-${category}`}
      data-filetree-icon="file"
      data-filetree-icon-category={category}
      data-filetree-icon-special={special ?? undefined}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M3.25 1.75h5.9l3.6 3.6v8.9h-9.5V1.75Zm5.6.9v3h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <FileMark category={category} special={special} />
    </svg>
  );
}
function FolderSvg({ expanded }: { expanded: boolean }): ReactElement {
  return (
    <svg
      className={`filetree-entry-icon filetree-folder-icon${expanded ? " is-open" : ""}`}
      data-filetree-icon="directory"
      data-expanded={expanded ? "true" : "false"}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {expanded ? (
        <path
          d="M1.4 5.6h13.2l-1.55 7H2.95l-1.55-7Zm1-2.4h4l1.25 1.45h5.95v.95H2.4V3.2Z"
          fill="currentColor"
        />
      ) : (
        <path
          d="M1.8 3.05h4.7l1.25 1.5h6.45v8.1H1.8v-9.6Zm1.05 1.05v7.5h10.3v-6H7.25L6 4.1H2.85Z"
          fill="currentColor"
        />
      )}
    </svg>
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
      {kind === "directory" ? (
        <FolderSvg expanded={expanded === true} />
      ) : (
        <FileSvg path={path} />
      )}
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
