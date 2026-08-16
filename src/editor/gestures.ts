/**
 * Touch and pen arithmetic: pinch geometry, the mapping between screen points
 * and chart cells, and the rules that decide whether a contact is a deliberate
 * mark or a palm resting on the glass.
 *
 * Pure — no DOM, no store. `CanvasEditor` passes numbers in and applies what
 * comes back, so all of this is unit tested rather than only pokeable by hand
 * on a phone.
 */

export interface Point {
  x: number;
  y: number;
}

export interface CellSize {
  w: number;
  h: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * How much a two-finger pinch has scaled. Two fingers landing on the same pixel
 * would divide by zero, so that degenerate start reports no change.
 */
export function pinchScale(from: [Point, Point], to: [Point, Point]): number {
  const before = distance(from[0], from[1]);
  if (before <= 0) return 1;
  return distance(to[0], to[1]) / before;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Which (fractional) cell sits under a point on the canvas, given where the
 * grid's top-left corner currently is. Fractional on purpose: zooming has to
 * keep a sub-cell position fixed or the chart drifts under the fingers.
 */
export function cellUnderPoint(pt: Point, pan: Point, cell: CellSize, zoom: number): Point {
  return {
    x: (pt.x - pan.x) / (cell.w * zoom),
    y: (pt.y - pan.y) / (cell.h * zoom),
  };
}

/** Where the grid's corner must sit to put `cell` under `pt` at this zoom. */
export function panForCell(cell: Point, pt: Point, size: CellSize, zoom: number): Point {
  return {
    x: pt.x - cell.x * size.w * zoom,
    y: pt.y - cell.y * size.h * zoom,
  };
}

/**
 * How long after a pen event touches are still treated as palm.
 *
 * Long enough to cover the pauses between strokes while the hand stays put,
 * short enough that putting the pen down and using a finger is not a wait.
 */
export const PEN_LOCKOUT_MS = 1500;

/**
 * Should this contact be ignored for drawing?
 *
 * The rule that makes a pen usable: once the pen has been seen, touches stop
 * marking the chart. Without it, the hand resting on the screen paints stitches
 * under the heel of the palm and the app is unusable for its main purpose.
 * Deliberate two-finger pans and pinches are handled separately and stay live —
 * only *drawing* is suppressed.
 */
export function isPalmTouch(
  pointerType: string,
  lastPenAt: number | null,
  now: number,
  lockoutMs = PEN_LOCKOUT_MS
): boolean {
  if (pointerType !== 'touch') return false;
  if (lastPenAt === null) return false;
  return now - lastPenAt < lockoutMs;
}

/**
 * Is the pen asking to erase? Styluses report the barrel button as button 2 and
 * the flipped-over eraser end as button 5, and knitters expect both to rub
 * stitches back to the background rather than paint with them.
 */
export function isEraserButton(pointerType: string, button: number): boolean {
  return pointerType === 'pen' && (button === 2 || button === 5);
}

/** Two or more contacts means the user wants to move the chart, not mark it. */
export function isGesture(activePointers: number): boolean {
  return activePointers >= 2;
}
