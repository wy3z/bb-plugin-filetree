import { describe, expect, it, vi } from "vitest";
import { convertDocxCancellable } from "./office-worker.js";
import { parsePptxCancellable } from "./pptx-worker.js";
import { parseXlsxCancellable } from "./xlsx-worker.js";
function fakeWorker() {
  const listeners = new Map<string, EventListener>();
  const terminate = vi.fn();
  const worker = {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    postMessage: vi.fn(),
    terminate,
  };
  return {
    emit(type: string, data?: unknown) {
      listeners.get(type)?.(
        type === "message" ? ({ data } as MessageEvent) : new Event(type),
      );
    },
    terminate,
    worker: worker as unknown as Worker,
  };
}
describe("Office worker cancellation", () => {
  it("terminates DOCX parsing when the selection is replaced", async () => {
    const fake = fakeWorker();
    const controller = new AbortController();
    const pending = convertDocxCancellable(
      new ArrayBuffer(8),
      controller.signal,
      () => fake.worker,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it("terminates PPTX parsing when the selection is replaced", async () => {
    const fake = fakeWorker();
    const controller = new AbortController();
    const pending = parsePptxCancellable(
      new ArrayBuffer(8),
      controller.signal,
      () => fake.worker,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it("rejects an invalid PPTX worker result and terminates the worker", async () => {
    const fake = fakeWorker();
    const pending = parsePptxCancellable(
      new ArrayBuffer(8),
      new AbortController().signal,
      () => fake.worker,
    );
    fake.emit("message", { metadata: {} });
    await expect(pending).rejects.toThrow(
      "The PPTX worker returned an invalid result.",
    );
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it("accepts a structured-cloneable PPTX presentation from the worker", async () => {
    const fake = fakeWorker();
    const presentation = {
      fonts: new Map(),
      metadata: {},
      slideLayouts: new Map(),
      slideMasters: new Map(),
      slideSize: { height: 720, width: 1280 },
      slides: [{}],
      theme: {},
    };
    const pending = parsePptxCancellable(
      new ArrayBuffer(8),
      new AbortController().signal,
      () => fake.worker,
    );
    fake.emit("message", presentation);
    await expect(pending).resolves.toEqual(presentation);
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it("terminates XLSX parsing when the selection is replaced", async () => {
    const fake = fakeWorker();
    const controller = new AbortController();
    const pending = parseXlsxCancellable(
      new ArrayBuffer(8),
      controller.signal,
      () => fake.worker,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it("terminates and rejects when posting to a worker throws", async () => {
    const fake = fakeWorker();
    fake.worker.postMessage = () => {
      throw new Error("Could not clone input");
    };
    await expect(
      convertDocxCancellable(
        new ArrayBuffer(8),
        new AbortController().signal,
        () => fake.worker,
      ),
    ).rejects.toThrow("Could not clone input");
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
  it("terminates on a message decoding failure", async () => {
    const fake = fakeWorker();
    const pending = parseXlsxCancellable(
      new ArrayBuffer(8),
      new AbortController().signal,
      () => fake.worker,
    );
    fake.emit("messageerror");
    await expect(pending).rejects.toThrow(
      "The isolated XLSX preview worker failed.",
    );
    fake.emit("message", { sheets: [], truncated: false });
    expect(fake.terminate).toHaveBeenCalledOnce();
  });
});
