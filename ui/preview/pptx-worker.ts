import {
  runPreviewWorker,
  type PreviewWorkerFactory,
} from "./worker-client.js";
import workerSource from "../../generated/pptx-worker.js";
import { createPreviewWorker } from "./create-worker.js";
import type { Presentation } from "pptx-viewer";
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
function isPresentation(value: unknown): value is Presentation {
  if (!isObject(value)) return false;
  const slideSize = Reflect.get(value, "slideSize");
  const slides = Reflect.get(value, "slides");
  return (
    isObject(Reflect.get(value, "metadata")) &&
    isObject(slideSize) &&
    typeof Reflect.get(slideSize, "width") === "number" &&
    typeof Reflect.get(slideSize, "height") === "number" &&
    Array.isArray(slides) &&
    slides.every(isObject) &&
    isObject(Reflect.get(value, "theme")) &&
    Reflect.get(value, "slideMasters") instanceof Map &&
    Reflect.get(value, "slideLayouts") instanceof Map &&
    Reflect.get(value, "fonts") instanceof Map
  );
}
function readPresentationWorkerResult(value: unknown): Presentation {
  if (!isPresentation(value))
    throw new Error("The PPTX worker returned an invalid result.");
  return value;
}
export function parsePptxCancellable(
  bytes: ArrayBuffer,
  signal: AbortSignal,
  workerFactory: PreviewWorkerFactory = () => createPreviewWorker(workerSource),
): Promise<Presentation> {
  return runPreviewWorker({
    bytes,
    signal,
    workerFactory,
    format: "PPTX",
    decode: readPresentationWorkerResult,
  });
}
