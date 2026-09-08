import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { rpcContract } from "../contracts/rpc.js";
import { createFilesData } from "./native-files-data-adapter.js";
const changedSchema = z.object({ threadId: z.string(), rootId: z.string() });
export function useFilesData(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const watchedRoots = useRef<string | null>(null);
  const adapter = useMemo(() => createFilesData(rpc), [rpc]);
  useRealtime(
    "files-changed",
    useCallback(
      (value: unknown) => {
        const event = changedSchema.safeParse(value);
        if (event.success)
          adapter.changed(event.data.threadId, [event.data.rootId]);
      },
      [adapter],
    ),
  );
  useEffect(() => {
    let active = true;
    const refresh = async (reconcile: boolean) => {
      const result = await rpc.call("watch", { threadId }).catch(() => null);
      if (!active) return;
      const roots = JSON.stringify(result?.rootIds ?? []);
      if (reconcile || !result?.watching || watchedRoots.current !== roots)
        adapter.changed(threadId, null);
      watchedRoots.current = roots;
    };
    void refresh(true);
    const timer = setInterval(() => {
      void refresh(false);
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [rpc, adapter, threadId, connection]);
  return adapter.data;
}
