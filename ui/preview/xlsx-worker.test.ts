import { beforeEach, describe, expect, it, vi } from "vitest";
const readWorkbook = vi.fn();
vi.mock("read-excel-file/browser", () => ({ default: readWorkbook }));
const { parseXlsx, XLSX_MAX_COLUMNS, XLSX_MAX_ROWS_PER_SHEET } =
  await import("./xlsx-worker.js");
beforeEach(() => readWorkbook.mockReset());
describe("spreadsheet preview model", () => {
  it("keeps formulas as inert display text and normalizes values", async () => {
    readWorkbook.mockResolvedValue([
      {
        sheet: "Data",
        data: [["=2+2", 4, true, new Date("2024-01-02T00:00:00.000Z")]],
      },
    ]);
    const result = await parseXlsx(new ArrayBuffer(0));
    expect(result.sheets[0]?.rows[0]).toEqual([
      "=2+2",
      "4",
      "true",
      "2024-01-02T00:00:00.000Z",
    ]);
  });
  it("bounds rows and columns before rendering", async () => {
    const wideRow = Array.from(
      { length: XLSX_MAX_COLUMNS + 1 },
      (_, index) => index,
    );
    readWorkbook.mockResolvedValue([
      {
        sheet: "Large",
        data: Array.from(
          { length: XLSX_MAX_ROWS_PER_SHEET + 1 },
          () => wideRow,
        ),
      },
    ]);
    const result = await parseXlsx(new ArrayBuffer(0));
    expect(result.truncated).toBe(true);
    expect(result.sheets[0]?.rows.length).toBeLessThanOrEqual(
      XLSX_MAX_ROWS_PER_SHEET,
    );
    expect(result.sheets[0]?.rows[0]?.length).toBe(XLSX_MAX_COLUMNS);
  });
});
