import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeFileRootsResponse } from "../../contracts/api";
import type { NativeFilesData } from "../native-files-data";
import type { NativeFilesRoot } from "../native-files-ui-types";
import {
  clearPersistedRootChoice,
  readPersistedRootChoice,
  writePersistedRootChoice,
} from "./persistence";
export type RootDataState =
  | {
      status: "loading";
    }
  | {
      status: "unavailable";
      message: string;
    }
  | {
      status: "ready";
      roots: readonly NativeFilesRoot[];
      selected: NativeFilesRoot;
      activeRootId: string;
    }
  | {
      status: "error";
      message: string;
    };
function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Workspace roots could not be loaded.";
}
export function selectAuthorizedRoot(
  response: Extract<
    NativeFileRootsResponse,
    {
      kind: "ready";
    }
  >,
  savedRootId: string | null,
): NativeFilesRoot {
  return (
    response.roots.find((root) => root.rootId === savedRootId) ??
    response.roots.find((root) => root.rootId === response.activeRootId) ??
    response.roots[0]!
  );
}
export function useRootData(options: {
  data: NativeFilesData;
  threadId: string;
  storage: Storage;
  initialRootId?: string;
}) {
  const selectedRootRef = useRef(options.initialRootId ?? null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<RootDataState>({ status: "loading" });
  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    try {
      const response = await options.data.listRoots({
        signal: controller.signal,
        threadId: options.threadId,
      });
      if (
        requestRef.current !== request ||
        response.threadId !== options.threadId
      )
        return;
      if (response.kind === "unavailable") {
        clearPersistedRootChoice(options.storage, options.threadId);
        setState({ status: "unavailable", message: response.reason });
        return;
      }
      const savedRootId = readPersistedRootChoice(
        options.storage,
        options.threadId,
      );
      const selected = selectAuthorizedRoot(
        response,
        selectedRootRef.current ?? savedRootId,
      );
      selectedRootRef.current = selected.rootId;
      if (savedRootId !== null && savedRootId !== selected.rootId) {
        clearPersistedRootChoice(options.storage, options.threadId);
      }
      writePersistedRootChoice(
        options.storage,
        options.threadId,
        selected.rootId,
      );
      setState({
        status: "ready",
        roots: response.roots,
        selected,
        activeRootId: response.activeRootId,
      });
    } catch (error: unknown) {
      if (requestRef.current === request && !controller.signal.aborted) {
        setState({ status: "error", message: message(error) });
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [options.data, options.storage, options.threadId]);
  useEffect(() => {
    void reload();
    return () => {
      requestRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [reload]);
  const selectRoot = useCallback(
    (rootId: string) => {
      setState((current) => {
        if (current.status !== "ready") return current;
        const selected = current.roots.find((root) => root.rootId === rootId);
        if (selected === undefined) return current;
        selectedRootRef.current = selected.rootId;
        writePersistedRootChoice(options.storage, options.threadId, rootId);
        return { ...current, selected };
      });
    },
    [options.storage, options.threadId],
  );
  return { state, reload, selectRoot };
}
