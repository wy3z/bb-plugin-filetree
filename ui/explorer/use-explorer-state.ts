import { ancestorPaths } from "./reveal";
import { NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH } from "../../contracts/model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeFilesPersistedRootState } from "../native-files-ui-types.js";
import {
  readPersistedRootState,
  writePersistedRootState,
} from "./persistence.js";
export interface ExplorerViewState {
  expanded: ReadonlySet<string>;
  query: string;
  selectedPath: string | null;
  scrollTop: number;
}
const EMPTY_STATE: ExplorerViewState = {
  expanded: new Set(),
  query: "",
  selectedPath: null,
  scrollTop: 0,
};
function fromPersisted(
  value: NativeFilesPersistedRootState | null,
  initialPath?: string,
): ExplorerViewState {
  if (initialPath !== undefined)
    return {
      expanded: new Set([
        ...(value?.expandedPaths ?? []),
        ...ancestorPaths(initialPath),
      ]),
      query: "",
      selectedPath: initialPath,
      scrollTop: 0,
    };
  if (value === null) return EMPTY_STATE;
  return {
    expanded: new Set(value.expandedPaths),
    query: value.searchQuery,
    selectedPath: value.selectedPath,
    scrollTop: value.scrollTop,
  };
}
export function useExplorerState(options: {
  storage: Storage;
  threadId: string;
  rootId: string;
  initialPath?: string;
}) {
  const scope = `${options.threadId}\0${options.rootId}`;
  const scopeRef = useRef(scope);
  const latestRef = useRef({
    scope,
    storage: options.storage,
    threadId: options.threadId,
    rootId: options.rootId,
    state: EMPTY_STATE,
  });
  const [state, setState] = useState<ExplorerViewState>(() =>
    fromPersisted(
      readPersistedRootState(options.storage, options.threadId, options.rootId),
      options.initialPath,
    ),
  );
  useEffect(() => {
    const restored = fromPersisted(
      readPersistedRootState(options.storage, options.threadId, options.rootId),
      options.initialPath,
    );
    scopeRef.current = scope;
    latestRef.current = {
      scope,
      storage: options.storage,
      threadId: options.threadId,
      rootId: options.rootId,
      state: restored,
    };
    setState(restored);
    return () => {
      const latest = latestRef.current;
      if (latest.scope === scope) {
        writePersistedRootState(latest.storage, {
          threadId: latest.threadId,
          rootId: latest.rootId,
          expandedPaths: [...latest.state.expanded],
          searchQuery: latest.state.query,
          selectedPath: latest.state.selectedPath,
          scrollTop: latest.state.scrollTop,
        });
      }
    };
  }, [
    options.rootId,
    options.storage,
    options.threadId,
    options.initialPath,
    scope,
  ]);
  useEffect(() => {
    if (scopeRef.current !== scope) return;
    latestRef.current = {
      scope,
      storage: options.storage,
      threadId: options.threadId,
      rootId: options.rootId,
      state,
    };
    const timeout = window.setTimeout(() => {
      if (scopeRef.current !== scope) return;
      writePersistedRootState(options.storage, {
        threadId: options.threadId,
        rootId: options.rootId,
        expandedPaths: [...state.expanded],
        searchQuery: state.query,
        selectedPath: state.selectedPath,
        scrollTop: state.scrollTop,
      });
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [options.rootId, options.storage, options.threadId, scope, state]);
  const update = useCallback((patch: Partial<ExplorerViewState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);
  const setExpanded = useCallback(
    (next: ReadonlySet<string>) => update({ expanded: next }),
    [update],
  );
  const setQuery = useCallback(
    (query: string) =>
      update({ query: query.slice(0, NATIVE_FILE_SEARCH_QUERY_MAX_LENGTH) }),
    [update],
  );
  const setSelectedPath = useCallback(
    (selectedPath: string | null) => update({ selectedPath }),
    [update],
  );
  const setScrollTop = useCallback(
    (scrollTop: number) => update({ scrollTop }),
    [update],
  );
  return {
    state,
    setExpanded,
    setQuery,
    setSelectedPath,
    setScrollTop,
  };
}
