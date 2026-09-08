import type { NativeFilesEntry } from "../native-files-ui-types.js";
export interface VisibleTreeRow {
  entry: NativeFilesEntry;
  level: number;
}
export function firstVisibleTreeRowIndex(
  rows: readonly VisibleTreeRow[],
  elements: ReadonlyMap<string, HTMLElement>,
  viewport: HTMLElement,
): number {
  if (rows.length === 0) return 0;
  const styles = viewport.ownerDocument.defaultView?.getComputedStyle(viewport);
  const paddingTop = Number.parseFloat(styles?.paddingTop ?? "0");
  const contentTop =
    viewport.getBoundingClientRect().top +
    viewport.clientTop +
    (Number.isFinite(paddingTop) ? paddingTop : 0);
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const midpoint = Math.floor((low + high) / 2);
    const element = elements.get(rows[midpoint]!.entry.path);
    if (
      element === undefined ||
      element.getBoundingClientRect().bottom > contentTop
    ) {
      high = midpoint;
    } else {
      low = midpoint + 1;
    }
  }
  return Math.min(low, rows.length - 1);
}
export function stickyAncestorsForIndex(
  rows: readonly VisibleTreeRow[],
  firstVisibleIndex: number,
): readonly VisibleTreeRow[] {
  const current = rows[firstVisibleIndex];
  if (current === undefined) return [];
  const result: VisibleTreeRow[] = [];
  let parent = current.entry.path.includes("/")
    ? current.entry.path.slice(0, current.entry.path.lastIndexOf("/"))
    : "";
  while (parent !== "") {
    const row = rows.find(
      (candidate) =>
        candidate.entry.path === parent && candidate.entry.kind === "directory",
    );
    if (row !== undefined) result.unshift(row);
    parent = parent.includes("/")
      ? parent.slice(0, parent.lastIndexOf("/"))
      : "";
  }
  return result;
}
export function StickyAncestors(props: { rows: readonly VisibleTreeRow[] }) {
  if (props.rows.length === 0) return null;
  return (
    <div className="filetree-sticky-ancestors" aria-hidden="true">
      {props.rows.map((row) => (
        <div className="filetree-sticky-row" key={row.entry.path}>
          <span
            style={{
              paddingInlineStart: `${Math.max(0, row.level - 1) * 14}px`,
            }}
          >
            {row.entry.name}
          </span>
        </div>
      ))}
    </div>
  );
}
