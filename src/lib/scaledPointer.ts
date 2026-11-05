/**
 * Mouse coordinates for content drawn inside a CSS `transform: scale()` (the Spatial Canvas
 * zooms its nodes that way). xterm.js turns a mouse event into a cell with
 * `(clientX - rect.left) / cellWidth`, where the rect is scaled but the cell width is not,
 * so at zoom 0.8 a click on row 10 lands on row 8. This maps the client point back into the
 * element's unscaled layout space, around the element's top-left corner, so that same
 * arithmetic gives the right cell. At scale 1 the point comes back unchanged.
 *
 * `rect` is `el.getBoundingClientRect()` (scaled), `width`/`height` are `el.offsetWidth` /
 * `el.offsetHeight` (layout size, unscaled).
 */
export function unscaleClientPoint(
  point: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): { clientX: number; clientY: number } {
  const sx = width > 0 && rect.width > 0 ? rect.width / width : 1;
  const sy = height > 0 && rect.height > 0 ? rect.height / height : 1;
  return {
    clientX: rect.left + (point.clientX - rect.left) / sx,
    clientY: rect.top + (point.clientY - rect.top) / sy,
  };
}

/** Same as `unscaleClientPoint`, measuring `el`. */
export function unscaleForElement(point: { clientX: number; clientY: number }, el: HTMLElement) {
  return unscaleClientPoint(point, el.getBoundingClientRect(), el.offsetWidth, el.offsetHeight);
}
