// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildVirtualTreeLayout,
  scrollTopForVirtualTreeIndex,
  virtualTreeIndexAtOffset,
  virtualTreeRange,
} from "./virtual-tree.js";
describe("virtual tree geometry", () => {
  it("bounds a large visible range while keeping the final row reachable", () => {
    const layout = buildVirtualTreeLayout(10000, () => 28);
    expect(virtualTreeRange(layout, 0, 280, 6)).toEqual({ start: 0, end: 17 });
    const bottomRange = virtualTreeRange(
      layout,
      layout.totalHeight - 280,
      280,
      6,
    );
    expect(bottomRange.start).toBeGreaterThan(9970);
    expect(bottomRange.end).toBe(10000);
    expect(virtualTreeIndexAtOffset(layout, layout.totalHeight - 1)).toBe(9999);
  });
  it("keeps the rendered DOM bounded and reaches the final row", () => {
    const layout = buildVirtualTreeLayout(10000, () => 28);
    const renderRange = (scrollTop: number) => {
      const range = virtualTreeRange(layout, scrollTop, 280, 8);
      const tree = document.createElement("div");
      for (let index = range.start; index < range.end; index += 1) {
        const row = document.createElement("button");
        row.dataset.index = String(index);
        tree.append(row);
      }
      return tree;
    };
    const first = renderRange(0);
    expect(first.children.length).toBeLessThan(30);
    expect(first.querySelector('[data-index="9999"]')).toBeNull();
    const last = renderRange(layout.totalHeight - 280);
    expect(last.children.length).toBeLessThan(30);
    expect(last.querySelector('[data-index="9999"]')).not.toBeNull();
  });
  it("accounts for persistent status rows when focusing outside the viewport", () => {
    const layout = buildVirtualTreeLayout(500, (index) =>
      index === 120 ? 84 : 28,
    );
    const next = scrollTopForVirtualTreeIndex({
      layout,
      index: 400,
      scrollTop: 0,
      viewportHeight: 280,
    });
    expect(virtualTreeIndexAtOffset(layout, next + 279)).toBe(400);
    expect(
      scrollTopForVirtualTreeIndex({
        layout,
        index: 400,
        scrollTop: next,
        viewportHeight: 280,
      }),
    ).toBe(next);
  });
});
