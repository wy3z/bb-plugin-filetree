import { Markdown } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { isolatedHtmlDocument } from "./html-safety.js";
import { useObjectUrl } from "./object-url.js";

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="filetree-preview-markdown">
      <Markdown content={content} />
    </div>
  );
}

export function HtmlPreview({ content, path }: { content: string; path: string }) {
  const document = useMemo(() => isolatedHtmlDocument(content), [content]);
  return (
    <iframe
      className="filetree-preview-frame"
      sandbox=""
      srcDoc={document}
      title={`Rendered preview of ${path}`}
    />
  );
}

export function ImagePreview({
  bytes,
  mimeType,
  path,
}: {
  bytes: ArrayBuffer;
  mimeType: string;
  path: string;
}) {
  const url = useObjectUrl(bytes, mimeType);
  return (
    <div className="filetree-preview-media">
      {url === null ? null : <img src={url} alt={`Preview of ${path}`} />}
    </div>
  );
}

export function PdfPreview({ bytes, path }: { bytes: ArrayBuffer; path: string }) {
  const url = useObjectUrl(bytes, "application/pdf");
  return url === null ? null : (
    <iframe
      className="filetree-preview-frame"
      sandbox=""
      src={url}
      title={`PDF preview of ${path}`}
    />
  );
}
