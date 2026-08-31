import { describe, expect, it, vi } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "./host.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("workspace watcher lifecycle", () => {
  it("disposes a subscription that finishes setup after its request is cancelled", async () => {
    const pendingSubscription = deferred<{ dispose(): Promise<void> }>();
    const dispose = vi.fn(async () => undefined);
    const watchStarted = deferred<void>();
    const harness = experimental_createHostEntryHarness(hostEntry, {
      experimental_watch: async () => {
        watchStarted.resolve();
        return pendingSubscription.promise;
      },
    });
    const requestController = new AbortController();

    const start = harness.experimental_call(
      "startWatch",
      { rootPath: "/workspace", watchId: "watch-race" },
      { signal: requestController.signal },
    );

    await watchStarted.promise;
    requestController.abort(new Error("panel unmounted"));
    pendingSubscription.resolve({ dispose });

    await Promise.allSettled([start]);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());

    await expect(
      harness.experimental_call("stopWatch", { watchId: "watch-race" }),
    ).resolves.toEqual({ stopped: false });
    expect(dispose).toHaveBeenCalledOnce();

    await harness.experimental_dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
