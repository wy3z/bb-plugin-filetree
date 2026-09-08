// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourcePreview } from "./source-preview";
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_SourceCode: (props: {
    content: string;
    overflow?: string;
    path: string;
  }) => (
    <pre data-overflow={props.overflow} data-path={props.path}>
      {props.content}
    </pre>
  ),
}));
afterEach(() => {
  cleanup();
});
describe("SourcePreview", () => {
  it("renders source with the requested overflow mode", () => {
    const { container } = render(
      <SourcePreview
        content="const x = 1;"
        path="src/app.ts"
        overflow="wrap"
      />,
    );
    const preview = container.querySelector("pre");
    expect(preview?.getAttribute("data-overflow")).toBe("wrap");
    expect(preview?.textContent).toBe("const x = 1;");
  });
});
