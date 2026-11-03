import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { NativeFilesPanel } from "./ui/NativeFilesPanel.js";
import { useFilesData } from "./ui/use-files-data.js";
import { liveFileTarget } from "./ui/live-file-target.js";
import { focusSiblingPane } from "./ui/split-pane-target.js";
import { useRef } from "react";

/** Props BB passes a thread-context tab. */
type ThreadTabProps = { threadId: string; environment: { id: string } | null };

/** `experimental_tab` arrived after this plugin's pinned SDK typings. */
type TabSlot = (registration: {
  context: { kind: "thread" };
  availability: "fixed";
  id: string;
  title: string;
  icon: string;
  layout: "flush";
  component: (props: ThreadTabProps) => React.ReactNode;
}) => void;

function FilesPanel({ threadId }: ThreadTabProps) {
  const data = useFilesData(threadId);
  const navigate = useBbNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    // display: contents keeps the flush layout; the div is only a DOM anchor.
    <div ref={rootRef} style={{ display: "contents" }}>
      <NativeFilesPanel
        data={data}
        threadId={threadId}
        layout="tree"
        onOpenFile={(selection) => {
          // In a split, open beside the tree rather than over it.
          const restoreFocus = focusSiblingPane(rootRef.current);
          // BB's own viewer, opened as a tab in the right panel.
          navigate.experimental_openFilePreview({
            target: liveFileTarget(selection),
            location: null,
          });
          // Hand focus back to the tree once BB has placed the tab.
          if (restoreFocus)
            requestAnimationFrame(() => requestAnimationFrame(restoreFocus));
        }}
      />
    </div>
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
  // A fixed tab is always present in every thread's right panel.
  const tab = (app.slots as unknown as { experimental_tab: TabSlot })
    .experimental_tab;
  tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "files",
    title: "Files",
    icon: icons ? TAB_ICON : "Folder",
    layout: "flush",
    component: FilesPanel,
  });
});
