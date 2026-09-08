import { useObjectUrl } from "./object-url.js";
export function ImagePreview(props: {
  bytes: ArrayBuffer;
  mimeType: string;
  path: string;
}) {
  const url = useObjectUrl(props.bytes, props.mimeType);
  return (
    <div className="filetree-preview-media">
      {url === null ? null : <img src={url} alt={`Preview of ${props.path}`} />}
    </div>
  );
}
