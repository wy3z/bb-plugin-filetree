import readWorkbook from "read-excel-file/browser";
export const XLSX_MAX_SHEETS = 64;
export const XLSX_MAX_ROWS_PER_SHEET = 2000;
export const XLSX_MAX_COLUMNS = 200;
export const XLSX_MAX_CELLS = 100000;
export interface XlsxSheetPreview {
  name: string;
  rows: string[][];
  truncated: boolean;
}
export interface XlsxWorkbookPreview {
  sheets: XlsxSheetPreview[];
  truncated: boolean;
}
function displayCell(value: unknown): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
export async function parseXlsx(
  bytes: ArrayBuffer,
): Promise<XlsxWorkbookPreview> {
  const workbook = await readWorkbook(bytes);
  let remainingCells = XLSX_MAX_CELLS;
  let truncated = workbook.length > XLSX_MAX_SHEETS;
  const sheets: XlsxSheetPreview[] = [];
  for (const sheet of workbook.slice(0, XLSX_MAX_SHEETS)) {
    const rows: string[][] = [];
    let sheetTruncated = sheet.data.length > XLSX_MAX_ROWS_PER_SHEET;
    for (const row of sheet.data.slice(0, XLSX_MAX_ROWS_PER_SHEET)) {
      if (remainingCells <= 0) {
        sheetTruncated = true;
        truncated = true;
        break;
      }
      const width = Math.min(row.length, XLSX_MAX_COLUMNS, remainingCells);
      if (width < row.length) sheetTruncated = true;
      rows.push(row.slice(0, width).map(displayCell));
      remainingCells -= width;
    }
    sheets.push({ name: sheet.sheet, rows, truncated: sheetTruncated });
    truncated ||= sheetTruncated;
    if (remainingCells <= 0) break;
  }
  return { sheets, truncated };
}
