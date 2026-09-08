export type PreviewWorkerFactory = () => Worker;

export function runPreviewWorker<T>(options: {
  bytes: ArrayBuffer;
  signal: AbortSignal;
  workerFactory: PreviewWorkerFactory;
  format: string;
  decode(value: unknown): T;
}): Promise<T> {
  const { bytes, signal, workerFactory, format, decode } = options;
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  let worker: Worker;
  try {
    worker = workerFactory();
  } catch {
    return Promise.reject(
      new Error(
        `This browser could not start the isolated ${format} preview worker.`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", failure);
      worker.removeEventListener("messageerror", failure);
      worker.terminate();
      complete();
    };
    const abort = () =>
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    const failure = () =>
      finish(() =>
        reject(new Error(`The isolated ${format} preview worker failed.`)),
      );
    const message = (event: MessageEvent<unknown>) =>
      finish(() => {
        try {
          const error =
            typeof event.data === "object" && event.data !== null
              ? Reflect.get(event.data, "error")
              : null;
          if (typeof error === "string") throw new Error(error);
          resolve(decode(event.data));
        } catch (error) {
          reject(error);
        }
      });
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener("message", message);
    worker.addEventListener("error", failure);
    worker.addEventListener("messageerror", failure);
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage({ bytes }, [bytes]);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
