import { useMemo } from "react";
import { isolatedHtmlDocument } from "./html-safety.js";
export function HtmlPreview(props: { content: string; path: string }) {
  const document = useMemo(
    () => isolatedHtmlDocument(props.content),
    [props.content],
  );
  return (
    <iframe
      className="filetree-preview-frame"
      sandbox=""
      srcDoc={document}
      title={`Rendered preview of ${props.path}`}
    />
  );
}
