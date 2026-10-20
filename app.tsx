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

const TAB_ICON = "filetree/Files";

/** Two pages, the front one with a folded corner. */
function FilesGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.75 3.5h5.25l4.25 4.25v6.5a2.5 2.5 0 0 1-2.5 2.5h-7a2.5 2.5 0 0 1-2.5-2.5v-8.25a2.5 2.5 0 0 1 2.5-2.5Z" />
      <path d="M15.75 3.5v3a1.25 1.25 0 0 0 1.25 1.25h3.25" />
      <path d="M4.25 8.75v8.5a3 3 0 0 0 3 3h7.5" />
    </svg>
  );
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
  icons?.register({ name: TAB_ICON, component: FilesGlyph });
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
