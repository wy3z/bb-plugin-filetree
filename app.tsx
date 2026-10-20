import {
  definePluginApp,
  useBbNavigate,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { NativeFilesPanel } from "./ui/NativeFilesPanel.js";
import { useFilesData } from "./ui/use-files-data.js";
import { liveFileTarget, type LiveFileTarget } from "./ui/live-file-target.js";

/** Open picked files in BB's own viewer, in the thread's main pane. */
type OpenFilePreview = (options: {
  target: LiveFileTarget;
  location: null;
  experimental_placement: "main";
}) => boolean;

function FilesPanel({ threadId }: PluginThreadPanelProps) {
  const data = useFilesData(threadId);
  const navigate = useBbNavigate();
  const openFilePreview =
    navigate.experimental_openFilePreview as unknown as OpenFilePreview;
  return (
    <NativeFilesPanel
      data={data}
      threadId={threadId}
      layout="tree"
      onOpenFile={(selection) => {
        openFilePreview({
          target: liveFileTarget(selection),
          location: null,
          experimental_placement: "main",
        });
      }}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "files",
    title: "Files",
    icon: "Folder",
    layout: "flush",
    component: FilesPanel,
    // Always present in the thread's right panel on BB builds that support it.
    ...({ experimental_pinned: true } as object),
  });
});
