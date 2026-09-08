export type TreeKeyboardCommand =
  | "next"
  | "previous"
  | "first"
  | "last"
  | "collapse-or-parent"
  | "expand-or-child"
  | "activate"
  | "context-menu"
  | "escape";
export function treeKeyboardCommand(
  key: string,
  shiftKey: boolean,
): TreeKeyboardCommand | null {
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "ArrowLeft") return "collapse-or-parent";
  if (key === "ArrowRight") return "expand-or-child";
  if (key === "Enter" || key === " ") return "activate";
  if (key === "ContextMenu" || (shiftKey && key === "F10"))
    return "context-menu";
  if (key === "Escape") return "escape";
  return null;
}
export function adjacentPath(
  paths: readonly string[],
  current: string,
  delta: -1 | 1,
): string {
  const index = Math.max(0, paths.indexOf(current));
  return (
    paths[Math.max(0, Math.min(paths.length - 1, index + delta))] ?? current
  );
}
