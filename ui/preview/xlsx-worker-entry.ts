import { parseXlsx } from "./xlsx-parser.js";
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const bytes =
    typeof event.data === "object" && event.data !== null
      ? Reflect.get(event.data, "bytes")
      : null;
  if (!(bytes instanceof ArrayBuffer)) {
    self.postMessage({ error: "The XLSX worker received invalid input." });
    return;
  }
  void parseXlsx(bytes).then(
    (result) => self.postMessage(result),
    (error: unknown) =>
      self.postMessage({
        error:
          error instanceof Error ? error.message : "XLSX conversion failed.",
      }),
  );
});
