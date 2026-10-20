import {
  definePluginApp,
  useBbNavigate,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileStackIcon } from "@hugeicons/core-free-icons";
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

const TAB_ICON = "filetree/FileStack";

function FileStackGlyph({ className }: { className?: string }) {
  return <HugeiconsIcon icon={FileStackIcon} className={className} />;
}

/** App icons arrived after this plugin's pinned SDK; older hosts fall back to Folder. */
type IconRegistry = {
  register(registration: {
    name: string;
    component: (props: { className?: string }) => React.ReactNode;
  }): void;
};

export default definePluginApp((app) => {
  const icons = (app as unknown as { experimental_icons?: IconRegistry })
    .experimental_icons;
  icons?.register({ name: TAB_ICON, component: FileStackGlyph });
  app.slots.threadPanelAction({
    id: "files",
    title: "Files",
    icon: icons ? TAB_ICON : "Folder",
    layout: "flush",
    component: FilesPanel,
    // Always present in the thread's right panel on BB builds that support it.
    ...({ experimental_pinned: true } as object),
  });
});
