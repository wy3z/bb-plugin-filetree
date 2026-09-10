import { useEffect, useState } from "react";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { NativeFilesPanel } from "./NativeFilesPanel";
import { useFilesData } from "./use-files-data";
import { resolveFileOpenerTarget } from "./file-opener-target";
import type { NativeFilesSelection } from "./native-files-ui-types";

function OriginalFilePreview({ Original }: Pick<PluginFileOpenerProps, "Original">) {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <Original />
    </div>
  );
}

function ThreadFileOpener(props: PluginFileOpenerProps & { threadId: string }) {
  const data = useFilesData(props.threadId);
  const [target, setTarget] = useState<NativeFilesSelection | null | "loading">(
    "loading",
  );
  const { path, source, threadId, Original } = props;
  useEffect(() => {
    const controller = new AbortController();
    void data
      .listRoots({ threadId, signal: controller.signal })
      .then((roots) => {
        if (!controller.signal.aborted)
          setTarget(resolveFileOpenerTarget(path, source, roots));
      })
      .catch(() => {
        if (!controller.signal.aborted) setTarget(null);
      });
    return () => controller.abort();
  }, [
    data,
    path,
    source.kind,
    source.threadId,
    source.environmentId,
    source.projectId,
    source.experimental_hostId,
    threadId,
  ]);
  if (target === "loading") return <div role="status">Loading file…</div>;
  if (target === null) return <OriginalFilePreview Original={Original} />;
  return (
    <NativeFilesPanel
      data={data}
      threadId={threadId}
      initialSelection={target}
    />
  );
}

export function FilesOpener(props: PluginFileOpenerProps) {
  if (props.source.threadId === null || props.source.kind === "thread-storage")
    return <OriginalFilePreview Original={props.Original} />;
  const key = JSON.stringify([
    props.path,
    props.source.kind,
    props.source.threadId,
    props.source.environmentId,
    props.source.projectId,
    props.source.experimental_hostId,
  ]);
  return (
    <ThreadFileOpener key={key} {...props} threadId={props.source.threadId} />
  );
}
