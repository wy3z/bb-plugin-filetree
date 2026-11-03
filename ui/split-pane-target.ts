/**
 * BB adds a new right-panel tab to the focused split pane, and clicking the
 * tree focuses the pane Files is in, so an opened file would cover the tree.
 * Focusing a sibling pane first makes the file open there instead.
 *
 * This leans on BB's split markup (`data-split-pane-id` panes inside a
 * `data-sidebar-split-container`), which the SDK does not cover. Without a
 * split, or if that markup changes, it does nothing and the file opens where
 * BB would put it anyway.
 *
 * Returns a function that puts keyboard focus back where it was, or null
 * when no sibling pane was focused.
 */
export function focusSiblingPane(from: Element | null): (() => void) | null {
  const pane = from?.closest("[data-split-pane-id]");
  const container = pane?.closest("[data-sidebar-split-container]");
  if (!pane || !container) return null;
  const sibling = [
    ...container.querySelectorAll<HTMLElement>("[data-split-pane-id]"),
  ].find(
    (candidate) =>
      candidate !== pane &&
      candidate.closest("[data-sidebar-split-container]") === container,
  );
  const handle =
    sibling?.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
    sibling?.querySelector<HTMLElement>("button, [tabindex]");
  if (!handle) return null;
  const previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  handle.focus({ preventScroll: true });
  return () => previous?.focus({ preventScroll: true });
}
