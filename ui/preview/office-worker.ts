import {
  runPreviewWorker,
  type PreviewWorkerFactory,
} from "./worker-client.js";
import workerSource from "../../generated/office-worker.js";
import { createPreviewWorker } from "./create-worker.js";
import { convertDocx, type DocxConversion } from "./docx-parser.js";
export { convertDocx, type DocxConversion };
function readDocxWorkerResult(value: unknown): DocxConversion {
  if (typeof value !== "object" || value === null)
    throw new Error("The DOCX worker returned an invalid result.");
  const html = Reflect.get(value, "html");
  const warnings = Reflect.get(value, "warnings");
  if (
    typeof html !== "string" ||
    !Array.isArray(warnings) ||
    !warnings.every((warning) => typeof warning === "string")
  ) {
    throw new Error("The DOCX worker returned an invalid result.");
  }
  return { html, warnings };
}
export function convertDocxCancellable(
  bytes: ArrayBuffer,
  signal: AbortSignal,
  workerFactory: PreviewWorkerFactory = () => createPreviewWorker(workerSource),
): Promise<DocxConversion> {
  return runPreviewWorker({
    bytes,
    signal,
    workerFactory,
    format: "DOCX",
    decode: readDocxWorkerResult,
  });
}
