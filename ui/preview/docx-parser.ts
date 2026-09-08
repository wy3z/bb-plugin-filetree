import mammoth from "mammoth";
export interface DocxConversion {
  html: string;
  warnings: string[];
}
export async function convertDocx(bytes: ArrayBuffer): Promise<DocxConversion> {
  const result = await mammoth.convertToHtml(
    { arrayBuffer: bytes },
    { externalFileAccess: false, idPrefix: "filetree-docx-" },
  );
  return {
    html: result.value,
    warnings: result.messages.map((message) => message.message),
  };
}
