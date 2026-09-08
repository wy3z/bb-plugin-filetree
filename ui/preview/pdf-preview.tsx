import { useObjectUrl } from "./object-url.js";
export function PdfPreview(props: { bytes: ArrayBuffer; path: string }) {
  const url = useObjectUrl(props.bytes, "application/pdf");
  return url === null ? null : (
    <iframe
      className="filetree-preview-frame"
      sandbox=""
      src={url}
      title={`PDF preview of ${props.path}`}
    />
  );
}
