import { useEffect, useState } from "react";
export function useObjectUrl(
  bytes: ArrayBuffer,
  mimeType: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [bytes, mimeType]);
  return url;
}
