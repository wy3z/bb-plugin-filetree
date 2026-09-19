// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./simple-previews.js";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  Markdown: (props: { content: string }) => (
    <div data-testid="markdown">{props.content}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("MarkdownPreview", () => {
  it("feeds the renderer absolute host paths for local images", () => {
    const { getByTestId } = render(
      <MarkdownPreview
        content="![FileTree pane](docs/screenshots/files.png)"
        path="README.md"
        rootPath="/workspace"
      />,
    );
    expect(getByTestId("markdown").textContent).toBe(
      "![FileTree pane](/workspace/docs/screenshots/files.png)",
    );
  });
});
