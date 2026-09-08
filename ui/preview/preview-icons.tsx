import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  FileEmpty02Icon,
  LinkSquare02Icon,
  Loading03Icon,
  Refresh01Icon,
  TextWrapIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

interface PreviewIconProps {
  className?: string;
}

export function FileIcon(props: PreviewIconProps) {
  return (
    <HugeiconsIcon
      strokeWidth={2.25}
      icon={FileEmpty02Icon}
      className={props.className}
      aria-hidden="true"
    />
  );
}

export function EyeIcon() {
  return (
    <HugeiconsIcon strokeWidth={2.25} icon={ViewIcon} aria-hidden="true" />
  );
}

export function RefreshIcon({ loading = false }: { loading?: boolean }) {
  return (
    <HugeiconsIcon
      strokeWidth={2.25}
      icon={loading ? Loading03Icon : Refresh01Icon}
      className={loading ? "animate-spin" : undefined}
      aria-hidden="true"
    />
  );
}

export function OpenEditorIcon() {
  return (
    <HugeiconsIcon
      strokeWidth={2.25}
      icon={LinkSquare02Icon}
      aria-hidden="true"
    />
  );
}

export function WordWrapIcon() {
  return (
    <HugeiconsIcon strokeWidth={2.25} icon={TextWrapIcon} aria-hidden="true" />
  );
}

export function CopyIcon(props: PreviewIconProps) {
  return (
    <HugeiconsIcon
      strokeWidth={2.25}
      icon={Copy01Icon}
      className={props.className}
      aria-hidden="true"
    />
  );
}
