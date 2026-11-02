import type { DirectorySnapshot } from "./tree-model";
import type { RootDataState } from "./use-root-data";

/**
 * State that outlives the Files tab: BB unmounts a tab when another one is
 * selected, and returning should show the tree as it was while it
 * revalidates, not an empty tree that loses its place.
 */
export const directoryCache = new Map<
  string,
  ReadonlyMap<string, DirectorySnapshot>
>();
export const rootCache = new Map<string, RootDataState>();

/** Drop every cached listing and root list (tests start from a cold tab). */
export function clearExplorerCaches(): void {
  directoryCache.clear();
  rootCache.clear();
}
