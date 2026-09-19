const schemePattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;
const homePattern = /^~(?:[^/]*\/|$)/u;
const fenceOpenPattern = /^( {0,3})(`{3,}|~{3,})/u;

function stripRootSlash(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

function posixNormalize(path: string): string | null {
  if (!path.startsWith("/") || path.includes("\0") || path.includes("\\")) {
    return null;
  }
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function containedInRoot(candidate: string, root: string): boolean {
  if (root === "/") return candidate.startsWith("/");
  return candidate === root || candidate.startsWith(`${root}/`);
}

function fileDirectory(markdownPath: string): string {
  const index = markdownPath.lastIndexOf("/");
  return index === -1 ? "" : markdownPath.slice(0, index);
}

function decodeDestination(src: string): string {
  const withoutQuery = src.replace(/[?#].*$/u, "");
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

export function resolveLocalMarkdownImagePath(options: {
  markdownPath: string;
  rootPath: string;
  src: string;
}): string | null {
  const src = options.src;
  if (src.length === 0 || src.trim() !== src) return null;
  if (
    schemePattern.test(src) ||
    homePattern.test(src) ||
    src.startsWith("//") ||
    src.startsWith("#") ||
    src.startsWith("?")
  ) {
    return null;
  }
  const root = stripRootSlash(options.rootPath);
  const decoded = decodeDestination(src);
  if (decoded.length === 0) return null;
  const directory = fileDirectory(options.markdownPath);
  const relative = directory.length === 0 ? decoded : `${directory}/${decoded}`;
  const joined = decoded.startsWith("/")
    ? decoded
    : root === "/"
      ? `/${relative}`
      : `${root}/${relative}`;
  const absolute = posixNormalize(joined);
  if (absolute === null || !containedInRoot(absolute, root)) return null;
  return absolute;
}

function formatDestination(path: string): string {
  return /[\s()]/.test(path) ? `<${path}>` : path;
}

function rewriteImageDestinations(
  text: string,
  markdownPath: string,
  rootPath: string,
): string {
  const pattern =
    /!\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^)\s])+))(\s+(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\((?:\\.|[^)])*\)))?\s*\)/gu;
  return text.replace(
    pattern,
    (
      match,
      angleDest: string | undefined,
      bareDest: string | undefined,
      title: string | undefined,
    ) => {
      const dest = angleDest ?? bareDest;
      if (dest === undefined) return match;
      const resolved = resolveLocalMarkdownImagePath({
        markdownPath,
        rootPath,
        src: dest.replace(/\\([()])/gu, "$1"),
      });
      if (resolved === null) return match;
      const altEnd = match.indexOf("](");
      if (altEnd === -1) return match;
      return `${match.slice(0, altEnd + 2)}${formatDestination(resolved)}${title ?? ""})`;
    },
  );
}

function rewriteInlineCodeAware(
  text: string,
  markdownPath: string,
  rootPath: string,
): string {
  let output = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`") {
      const next = text.indexOf("`", index);
      const slice = next === -1 ? text.slice(index) : text.slice(index, next);
      output += rewriteImageDestinations(slice, markdownPath, rootPath);
      if (next === -1) break;
      index = next;
      continue;
    }
    let ticks = 1;
    while (text[index + ticks] === "`") ticks += 1;
    const closer = "`".repeat(ticks);
    const end = text.indexOf(closer, index + ticks);
    if (end === -1) {
      output += rewriteImageDestinations(text.slice(index), markdownPath, rootPath);
      break;
    }
    output += text.slice(index, end + ticks);
    index = end + ticks;
  }
  return output;
}

function fenceMarker(line: string): string | null {
  const match = fenceOpenPattern.exec(line);
  return match?.[2] ?? null;
}

function fenceCloses(line: string, opener: string): boolean {
  const marker = fenceMarker(line);
  return marker !== null && marker[0] === opener[0] && marker.length >= opener.length;
}

export function rewriteMarkdownImageSrcs(options: {
  content: string;
  markdownPath: string;
  rootPath: string;
}): string {
  const lines = options.content.split(/(?<=\n)/u);
  let fence: string | null = null;
  let buffer = "";
  let output = "";
  const flush = () => {
    if (buffer.length === 0) return;
    output += rewriteInlineCodeAware(
      buffer,
      options.markdownPath,
      options.rootPath,
    );
    buffer = "";
  };
  for (const line of lines) {
    if (fence === null) {
      const opener = fenceMarker(line);
      if (opener === null) {
        buffer += line;
        continue;
      }
      flush();
      fence = opener;
      output += line;
      continue;
    }
    output += line;
    if (fenceCloses(line, fence)) fence = null;
  }
  flush();
  return output;
}
