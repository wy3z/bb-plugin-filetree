import { describe, expect, it, vi } from "vitest";
import { createFilesData } from "./native-files-data-adapter";

describe("Files invalidation", () => {
  it("preserves root identity, isolates threads, and unsubscribes cleanly", () => {
    const adapter = createFilesData({
      call: async () => {
        throw new Error("No RPC expected");
      },
    });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = adapter.data.subscribe("thread-a", first);
    adapter.data.subscribe("thread-b", second);
    adapter.changed("thread-a", ["root-a"]);
    expect(first).toHaveBeenCalledExactlyOnceWith({ rootIds: ["root-a"] });
    expect(second).not.toHaveBeenCalled();
    adapter.changed("thread-a", null);
    expect(first).toHaveBeenLastCalledWith({ rootIds: null });
    unsubscribe();
    adapter.changed("thread-a", ["root-a"]);
    expect(first).toHaveBeenCalledTimes(2);
  });
});
