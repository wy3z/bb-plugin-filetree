export type PreviewKind =
  | "source"
  | "markdown"
  | "html"
  | "image"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "unsupported";
export interface PreviewRoute {
  kind: PreviewKind;
  mimeType: string;
}
const sourceExtensions = new Set([
  "c",
  "cc",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "go",
  "graphql",
  "h",
  "hpp",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "log",
  "lua",
  "m",
  "mm",
  "php",
  "properties",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const imageExtensions = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
export const FILE_PREVIEW_EXTENSIONS = [
  ...sourceExtensions,
  ...imageExtensions,
  "md",
  "markdown",
  "html",
  "htm",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
];
const imageMimeByExtension = new Map([
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["gif", "image/gif"],
  ["ico", "image/x-icon"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["webp", "image/webp"],
]);
export function normalizedMimeType(value: string | null): string {
  if (value === null) return "application/octet-stream";
  const candidate = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(candidate)
    ? candidate
    : "application/octet-stream";
}
export function extensionOf(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}
export function routePreview(
  path: string,
  contentType: string | null,
): PreviewRoute {
  const extension = extensionOf(path);
  const mimeType = normalizedMimeType(contentType);
  if (extension === "docx") return { kind: "docx", mimeType };
  if (extension === "xlsx") return { kind: "xlsx", mimeType };
  if (extension === "pptx") return { kind: "pptx", mimeType };
  if (
    extension === "md" ||
    extension === "markdown" ||
    mimeType === "text/markdown"
  ) {
    return { kind: "markdown", mimeType };
  }
  if (extension === "html" || extension === "htm" || mimeType === "text/html") {
    return { kind: "html", mimeType };
  }
  if (extension === "pdf" || mimeType === "application/pdf") {
    return { kind: "pdf", mimeType };
  }
  if (imageExtensions.has(extension) || mimeType.startsWith("image/")) {
    return {
      kind: "image",
      mimeType: mimeType.startsWith("image/")
        ? mimeType
        : (imageMimeByExtension.get(extension) ?? "application/octet-stream"),
    };
  }
  if (
    sourceExtensions.has(extension) ||
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml")
  ) {
    return { kind: "source", mimeType };
  }
  return { kind: "unsupported", mimeType };
}
