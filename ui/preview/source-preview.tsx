import {
  experimental_SourceCode as SourceCode,
  type CodeOverflowMode,
} from "@get-bb/plugin-sdk/app";

export interface SourcePreviewProps {
  content: string;
  path: string;
  overflow: CodeOverflowMode;
}

export function SourcePreview(props: SourcePreviewProps) {
  return (
    <SourceCode
      className="filetree-preview-source-code"
      content={props.content}
      overflow={props.overflow}
      path={props.path}
    />
  );
}
