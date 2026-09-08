import { ToolbarButton } from "../toolbar-button";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderGitTwoIcon } from "@hugeicons/core-free-icons";
import type { NativeFilesRoot } from "../native-files-ui-types.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../vendor/components/ui/dropdown-menu";
export function RootSelector(props: {
  roots: readonly NativeFilesRoot[];
  selectedRootId: string;
  onChange(rootId: string): void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          aria-label="Switch workspace"
          label={`Switch workspace: ${props.roots.find((root) => root.rootId === props.selectedRootId)?.label ?? "Workspace"}`}
        >
          <HugeiconsIcon
            strokeWidth={2.25}
            icon={FolderGitTwoIcon}
            aria-hidden="true"
          />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle="Switch workspace">
        {props.roots.map((root) => (
          <DropdownMenuItem
            key={root.rootId}
            role="menuitemradio"
            aria-checked={root.rootId === props.selectedRootId}
            onSelect={() => props.onChange(root.rootId)}
            title={root.rootPath}
          >
            <svg
              className={
                root.rootId === props.selectedRootId ? "" : "opacity-0"
              }
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m3 8 3 3 7-7" />
            </svg>
            {root.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
