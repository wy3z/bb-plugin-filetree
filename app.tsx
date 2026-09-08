import {
  definePluginApp,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { NativeFilesPanel } from "./ui/NativeFilesPanel.js";
import { FilesOpener } from "./ui/FilesOpener.js";
import { useFilesData } from "./ui/use-files-data.js";
import { FILE_PREVIEW_EXTENSIONS } from "./ui/preview/preview-router.js";
function FilesPanel({ threadId }: PluginThreadPanelProps) {
  const data = useFilesData(threadId);
  return <NativeFilesPanel data={data} threadId={threadId} />;
}
export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "files",
    title: "Files",
    icon: "FolderOpen",
    layout: "flush",
    component: FilesPanel,
  });
  app.slots.fileOpener({
    id: "files",
    title: "Files",
    extensions: FILE_PREVIEW_EXTENSIONS,
    component: FilesOpener,
  });
});
