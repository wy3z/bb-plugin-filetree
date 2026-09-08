import { useEffect, useMemo, useState } from "react";
import { isolatedHtmlDocument } from "./html-safety.js";
import {
  convertDocxCancellable,
  type DocxConversion,
} from "./office-worker.js";
import { preflightOfficeZip } from "./zip-preflight.js";
type DocxState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      conversion: DocxConversion;
    }
  | {
      status: "error";
      message: string;
    };
export function DocxPreview(props: { bytes: ArrayBuffer; path: string }) {
  const [state, setState] = useState<DocxState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    void Promise.resolve()
      .then(() => preflightOfficeZip(props.bytes))
      .then(() =>
        convertDocxCancellable(props.bytes.slice(0), controller.signal),
      )
      .then((conversion) => {
        if (active) setState({ status: "ready", conversion });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "DOCX preview failed.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [props.bytes]);
  const document = useMemo(
    () =>
      state.status === "ready"
        ? isolatedHtmlDocument(state.conversion.html)
        : "",
    [state],
  );
  if (state.status === "loading")
    return <p role="status">Rendering Word document…</p>;
  if (state.status === "error") return <p role="alert">{state.message}</p>;
  return (
    <section className="filetree-preview-document">
      {state.conversion.warnings.length > 0 ? (
        <details className="filetree-preview-warnings">
          <summary>
            {state.conversion.warnings.length} conversion warning
            {state.conversion.warnings.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {state.conversion.warnings.map((warning, index) => (
              <li key={`${index}:${warning}`}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <iframe
        className="filetree-preview-frame"
        sandbox=""
        srcDoc={document}
        title={`Word preview of ${props.path}`}
      />
    </section>
  );
}
