export function createPreviewWorker(source: string): Worker {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    const worker = new Worker(url);
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      URL.revokeObjectURL(url);
      terminate();
    };
    worker.addEventListener("message", () => URL.revokeObjectURL(url), {
      once: true,
    });
    worker.addEventListener("error", () => URL.revokeObjectURL(url), {
      once: true,
    });
    return worker;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
