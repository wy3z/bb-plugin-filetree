import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  parseXlsxCancellable,
  type XlsxWorkbookPreview,
  type XlsxSheetPreview,
} from "./xlsx-worker.js";
import { preflightOfficeZip } from "./zip-preflight.js";
type XlsxState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      workbook: XlsxWorkbookPreview;
    }
  | {
      status: "error";
      message: string;
    };
export function XlsxPreview(props: { bytes: ArrayBuffer }) {
  const [state, setState] = useState<XlsxState>({ status: "loading" });
  const [sheetIndex, setSheetIndex] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    setSheetIndex(0);
    void Promise.resolve()
      .then(() => preflightOfficeZip(props.bytes))
      .then(() => parseXlsxCancellable(props.bytes.slice(0), controller.signal))
      .then((workbook) => {
        if (active) setState({ status: "ready", workbook });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Spreadsheet preview failed.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [props.bytes]);
  if (state.status === "loading")
    return <p role="status">Rendering spreadsheet…</p>;
  if (state.status === "error") return <p role="alert">{state.message}</p>;
  const sheet = state.workbook.sheets[sheetIndex];
  if (sheet === undefined)
    return <p role="status">This workbook has no visible worksheets.</p>;
  return (
    <section className="filetree-preview-spreadsheet">
      <label>
        Worksheet
        <select
          value={sheetIndex}
          onChange={(event) => setSheetIndex(Number(event.currentTarget.value))}
        >
          {state.workbook.sheets.map((candidate, index) => (
            <option key={`${index}:${candidate.name}`} value={index}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      {state.workbook.truncated ? (
        <p role="status">
          Preview limited to the first safe rows, columns, cells, and
          worksheets.
        </p>
      ) : null}
      <WorksheetTable key={sheetIndex} sheet={sheet} />
    </section>
  );
}
const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 6;
function WorksheetTable({ sheet }: { sheet: XlsxSheetPreview }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const columnCount = useMemo(
    () => Math.max(1, ...sheet.rows.map((row) => row.length)),
    [sheet.rows],
  );
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const measure = () => setViewportHeight(viewport.clientHeight || 320);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const firstVisible = Math.min(
    Math.floor(scrollTop / ROW_HEIGHT),
    Math.max(0, sheet.rows.length - 1),
  );
  const start = Math.max(0, firstVisible - OVERSCAN_ROWS);
  const end = Math.min(
    sheet.rows.length,
    firstVisible + Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  return (
    <div
      ref={viewportRef}
      className="filetree-preview-table-scroll"
      tabIndex={0}
      aria-label={`${sheet.name} worksheet data`}
      onScroll={(event) =>
        setScrollTop(Math.max(0, event.currentTarget.scrollTop))
      }
    >
      <table
        aria-label={sheet.name}
        aria-rowcount={sheet.rows.length}
        aria-colcount={columnCount}
        style={{ width: columnCount * 160 }}
      >
        <colgroup>
          {Array.from({ length: columnCount }, (_, index) => (
            <col key={index} style={{ width: 160 }} />
          ))}
        </colgroup>
        <tbody>
          {start > 0 ? (
            <tr aria-hidden="true">
              <td
                className="filetree-preview-table-spacer"
                colSpan={columnCount}
                style={{ height: start * ROW_HEIGHT }}
              />
            </tr>
          ) : null}
          {sheet.rows.slice(start, end).map((row, offset) => (
            <tr
              key={start + offset}
              aria-rowindex={start + offset + 1}
              style={{ height: ROW_HEIGHT }}
            >
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <td key={columnIndex} aria-colindex={columnIndex + 1}>
                  <div
                    className="filetree-preview-cell"
                    style={{
                      height: ROW_HEIGHT - 1,
                      lineHeight: `${ROW_HEIGHT - 1}px`,
                    }}
                    title={row[columnIndex] ?? ""}
                  >
                    {row[columnIndex] ?? ""}
                  </div>
                </td>
              ))}
            </tr>
          ))}
          {end < sheet.rows.length ? (
            <tr aria-hidden="true">
              <td
                className="filetree-preview-table-spacer"
                colSpan={columnCount}
                style={{ height: (sheet.rows.length - end) * ROW_HEIGHT }}
              />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
