export type LayoutMode = "justified" | "masonry" | "grid";
export type LayoutItem = {
  id: string;
  width: number;
  height: number;
  kind?: "image" | "header";
  headerHeight?: number;
};
export type Rectangle = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "image" | "header";
};
export type Layout = {
  rectangles: Rectangle[];
  height: number;
  maxHeight: number;
};
export function layout(
  items: LayoutItem[],
  containerWidth: number,
  mode: LayoutMode,
  gap = 16,
  targetHeight = 220,
): Layout {
  const width = Math.max(1, containerWidth);
  const columns = Math.max(1, Math.floor((width + gap) / (targetHeight + gap)));
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const rectangles: Rectangle[] = [];
  const heights = Array.from({ length: columns }, () => 0);
  let top = 0;
  let row: { item: LayoutItem; ratio: number }[] = [];
  let ratios = 0;
  let imageIndex = 0;
  const aspect = (item: LayoutItem) =>
    Math.max(1, item.width) / Math.max(1, item.height);
  function finishRow(last: boolean) {
    if (!row.length) return;
    const height = last
      ? Math.min(targetHeight, (width - gap * (row.length - 1)) / ratios)
      : (width - gap * (row.length - 1)) / ratios;
    let left = 0;
    for (const {item, ratio} of row) {
      const itemWidth = height * ratio;
      rectangles.push({
        id: item.id,
        x: left,
        y: top,
        width: itemWidth,
        height,
        kind: "image",
      });
      left += itemWidth + gap;
    }
    top += height + gap;
    row = [];
    ratios = 0;
  }
  for (const item of items) {
    if (item.kind === "header") {
      finishRow(true);
      top = Math.max(top, ...heights);
      const height = item.headerHeight ?? 40;
      rectangles.push({
        id: item.id,
        x: 0,
        y: top,
        width,
        height,
        kind: "header",
      });
      top += height + gap;
      heights.fill(top);
      imageIndex = 0;
      continue;
    }
    if (mode === "justified") {
      const ratio = aspect(item);
      row.push({item, ratio});
      ratios += ratio;
      if (ratios * targetHeight + gap * (row.length - 1) >= width)
        finishRow(false);
      continue;
    }
    let column = imageIndex % columns;
    if (mode === "masonry") {
      column = 0;
      for (let candidate = 1; candidate < columns; candidate++) {
        if (heights[candidate] < heights[column]) column = candidate;
      }
    }
    let y = heights[column];
    if (mode === "grid") {
      for (let candidate = 0; candidate < column; candidate++) {
        y = Math.max(y, heights[candidate]);
      }
    }
    // Grid rows share a baseline, including after an optional group header.
    const rowTop =
      mode === "grid" && column > 0 ? heights[column - 1] - cellWidth - gap : y;
    const height = mode === "grid" ? cellWidth : cellWidth / aspect(item);
    rectangles.push({
      id: item.id,
      x: column * (cellWidth + gap),
      y: rowTop,
      width: cellWidth,
      height,
      kind: "image",
    });
    heights[column] = rowTop + height + gap;
    imageIndex++;
  }
  finishRow(true);
  let bottom = 0,
    maxHeight = 0;
  for (const rectangle of rectangles) {
    bottom = Math.max(bottom, rectangle.y + rectangle.height);
    maxHeight = Math.max(maxHeight, rectangle.height);
  }
  return { rectangles, height: bottom, maxHeight };
}
export function visibleRectangles(
  result: Layout,
  top: number,
  bottom: number,
  overscan = 400,
) {
  const rectangles = result.rectangles;
  let low = 0,
    high = rectangles.length;
  const startY = top - overscan - result.maxHeight;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rectangles[middle].y < startY) low = middle + 1;
    else high = middle;
  }
  const visible: Rectangle[] = [];
  for (
    let index = low;
    index < rectangles.length && rectangles[index].y <= bottom + overscan;
    index++
  ) {
    if (rectangles[index].y + rectangles[index].height >= top - overscan)
      visible.push(rectangles[index]);
  }
  return visible;
}
