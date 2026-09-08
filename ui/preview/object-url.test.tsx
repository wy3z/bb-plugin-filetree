// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImagePreview } from "./image-preview.js";
afterEach(() => vi.unstubAllGlobals());
describe("preview object URL lifecycle", () => {
  it("revokes replaced and unmounted image resources", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    );
    const view = render(
      <ImagePreview
        bytes={new Uint8Array([1]).buffer}
        mimeType="image/png"
        path="one.png"
      />,
    );
    view.rerender(
      <ImagePreview
        bytes={new Uint8Array([2]).buffer}
        mimeType="image/png"
        path="two.png"
      />,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
  });
});
