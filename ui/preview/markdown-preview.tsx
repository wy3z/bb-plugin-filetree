import { Markdown } from "@get-bb/plugin-sdk/app";

export function MarkdownPreview(props: { content: string }) {
  return (
    <div className="filetree-preview-markdown">
      <Markdown content={props.content} />
    </div>
  );
}
