import {
  runPreviewWorker,
  type PreviewWorkerFactory,
} from "./worker-client.js";
import workerSource from "../../generated/xlsx-worker.js";
import { createPreviewWorker } from "./create-worker.js";
import {
  type XlsxSheetPreview,
  type XlsxWorkbookPreview,
} from "./xlsx-parser.js";
export {
  XLSX_MAX_CELLS,
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS_PER_SHEET,
  XLSX_MAX_SHEETS,
  parseXlsx,
  type XlsxSheetPreview,
  type XlsxWorkbookPreview,
} from "./xlsx-parser.js";
function readWorkbookWorkerResult(value: unknown): XlsxWorkbookPreview {
  if (typeof value !== "object" || value === null)
    throw new Error("The XLSX worker returned an invalid result.");
  const sheets = Reflect.get(value, "sheets");
  const truncated = Reflect.get(value, "truncated");
  if (!Array.isArray(sheets) || typeof truncated !== "boolean") {
    throw new Error("The XLSX worker returned an invalid result.");
  }
  const parsedSheets: XlsxSheetPreview[] = [];
  for (const sheet of sheets) {
    if (
      typeof sheet !== "object" ||
      sheet === null ||
      typeof Reflect.get(sheet, "name") !== "string" ||
      typeof Reflect.get(sheet, "truncated") !== "boolean" ||
      !Array.isArray(Reflect.get(sheet, "rows"))
    ) {
      throw new Error("The XLSX worker returned an invalid result.");
    }
    const rowsValue: unknown = Reflect.get(sheet, "rows");
    if (!Array.isArray(rowsValue))
      throw new Error("The XLSX worker returned an invalid result.");
    const rows: string[][] = [];
    for (const row of rowsValue) {
      if (
        !Array.isArray(row) ||
        !row.every((cell: unknown) => typeof cell === "string")
      ) {
        throw new Error("The XLSX worker returned an invalid result.");
      }
      rows.push(row.map((cell: string) => cell));
    }
    parsedSheets.push({
      name: Reflect.get(sheet, "name"),
      rows,
      truncated: Reflect.get(sheet, "truncated"),
    });
  }
  return { sheets: parsedSheets, truncated };
}
export function parseXlsxCancellable(
  bytes: ArrayBuffer,
  signal: AbortSignal,
  workerFactory: PreviewWorkerFactory = () => createPreviewWorker(workerSource),
): Promise<XlsxWorkbookPreview> {
  return runPreviewWorker({
    bytes,
    signal,
    workerFactory,
    format: "XLSX",
    decode: readWorkbookWorkerResult,
  });
}
