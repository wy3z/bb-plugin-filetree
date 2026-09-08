export interface VirtualTreeLayout {
  offsets: readonly number[];
  heights: readonly number[];
  totalHeight: number;
}
export interface VirtualTreeRange {
  start: number;
  end: number;
}
export function buildVirtualTreeLayout(
  rowCount: number,
  heightAt: (index: number) => number,
): VirtualTreeLayout {
  const offsets: number[] = [];
  const heights: number[] = [];
  let totalHeight = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const height = Math.max(1, heightAt(index));
    offsets.push(totalHeight);
    heights.push(height);
    totalHeight += height;
  }
  return { offsets, heights, totalHeight };
}
export function virtualTreeIndexAtOffset(
  layout: VirtualTreeLayout,
  offset: number,
): number {
  if (layout.offsets.length === 0) return 0;
  const target = Math.max(0, offset);
  let low = 0;
  let high = layout.offsets.length;
  while (low < high) {
    const midpoint = Math.floor((low + high) / 2);
    const bottom = layout.offsets[midpoint]! + layout.heights[midpoint]!;
    if (bottom > target) high = midpoint;
    else low = midpoint + 1;
  }
  return Math.min(low, layout.offsets.length - 1);
}
export function virtualTreeRange(
  layout: VirtualTreeLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): VirtualTreeRange {
  if (layout.offsets.length === 0) return { start: 0, end: 0 };
  const first = virtualTreeIndexAtOffset(layout, scrollTop);
  const last = virtualTreeIndexAtOffset(
    layout,
    scrollTop + Math.max(1, viewportHeight),
  );
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(layout.offsets.length, last + overscan + 1),
  };
}
export function scrollTopForVirtualTreeIndex(options: {
  layout: VirtualTreeLayout;
  index: number;
  scrollTop: number;
  viewportHeight: number;
}): number {
  const top = options.layout.offsets[options.index];
  const height = options.layout.heights[options.index];
  if (top === undefined || height === undefined) return options.scrollTop;
  const viewportHeight = Math.max(1, options.viewportHeight);
  if (top < options.scrollTop) return top;
  const bottom = top + height;
  if (bottom > options.scrollTop + viewportHeight) {
    return Math.max(0, bottom - viewportHeight);
  }
  return options.scrollTop;
}
