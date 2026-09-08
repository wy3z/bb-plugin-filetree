import type { NativeFilesEntry } from "../native-files-ui-types.js";
export function ancestorPaths(path: string): string[] {
  const parts = path.split("/");
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}
export interface RevealDirectoryResult {
  entries: readonly NativeFilesEntry[];
  truncated: boolean;
}
export async function revealFile(options: {
  path: string;
  signal: AbortSignal;
  loadDirectory(path: string): Promise<RevealDirectoryResult>;
  expand(path: string): void;
}): Promise<"found" | "missing" | "truncated"> {
  let parent = "";
  const ancestors = ancestorPaths(options.path);
  for (const ancestor of ancestors) {
    if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const directory = await options.loadDirectory(parent);
    if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const child = directory.entries.find((entry) => entry.path === ancestor);
    if (child?.kind !== "directory")
      return directory.truncated ? "truncated" : "missing";
    options.expand(ancestor);
    parent = ancestor;
  }
  const directory = await options.loadDirectory(parent);
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (
    directory.entries.some(
      (entry) => entry.path === options.path && entry.kind === "file",
    )
  ) {
    return "found";
  }
  return directory.truncated ? "truncated" : "missing";
}
