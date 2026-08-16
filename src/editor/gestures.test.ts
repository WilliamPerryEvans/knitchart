import { describe, expect, it } from 'vitest';
import {
  PEN_LOCKOUT_MS,
  cellUnderPoint,
  clamp,
  distance,
  isEraserButton,
  isGesture,
  isPalmTouch,
  midpoint,
  panForCell,
  pinchScale,
  type Point,
} from './gestures';

const p = (x: number, y: number): Point => ({ x, y });

describe('pinch geometry', () => {
  it('measures the distance and midpoint of two contacts', () => {
    expect(distance(p(0, 0), p(3, 4))).toBe(5);
    expect(midpoint(p(0, 0), p(10, 20))).toEqual({ x: 5, y: 10 });
  });

  it('reports the ratio the fingers have spread', () => {
    expect(pinchScale([p(0, 0), p(10, 0)], [p(0, 0), p(20, 0)])).toBe(2);
    expect(pinchScale([p(0, 0), p(20, 0)], [p(0, 0), p(10, 0)])).toBe(0.5);
  });

  it('is unchanged when the fingers move together without spreading', () => {
    // A two-finger pan: same separation, different place.
    expect(pinchScale([p(0, 0), p(10, 0)], [p(50, 30), p(60, 30)])).toBe(1);
  });

  it('survives two fingers landing on the same pixel', () => {
    expect(pinchScale([p(5, 5), p(5, 5)], [p(0, 0), p(10, 0)])).toBe(1);
  });
});

describe('cell and pan mapping', () => {
  const cell = { w: 14, h: 10 };

  it('finds the fractional cell under a point', () => {
    // Grid corner at (100, 50), zoom 1: 40px right of the corner is cell 2.857.
    expect(cellUnderPoint(p(140, 50), p(100, 50), cell, 1).x).toBeCloseTo(40 / 14);
    expect(cellUnderPoint(p(100, 80), p(100, 50), cell, 1).y).toBeCloseTo(3);
  });

  it('round-trips: the pan that puts a cell back under its own point', () => {
    const pan = p(100, 50);
    const pt = p(233, 91);
    for (const zoom of [0.4, 1, 2.5]) {
      const c = cellUnderPoint(pt, pan, cell, zoom);
      const back = panForCell(c, pt, cell, zoom);
      expect(back.x).toBeCloseTo(pan.x);
      expect(back.y).toBeCloseTo(pan.y);
    }
  });

  it('keeps the pinched point fixed when the zoom changes', () => {
    // This is the property that makes pinch-zoom feel attached to the fingers.
    const pan = p(80, 60);
    const focus = p(300, 200);
    const held = cellUnderPoint(focus, pan, cell, 1);
    const newPan = panForCell(held, focus, cell, 2.5);
    expect(cellUnderPoint(focus, newPan, cell, 2.5).x).toBeCloseTo(held.x);
    expect(cellUnderPoint(focus, newPan, cell, 2.5).y).toBeCloseTo(held.y);
  });
});

describe('clamp', () => {
  it('holds a zoom inside its limits', () => {
    expect(clamp(0.01, 0.05, 10)).toBe(0.05);
    expect(clamp(50, 0.05, 10)).toBe(10);
    expect(clamp(1.5, 0.05, 10)).toBe(1.5);
  });
});

describe('palm rejection', () => {
  it('lets touch draw when no pen has been used', () => {
    expect(isPalmTouch('touch', null, 5000)).toBe(false);
  });

  it('ignores touch while the pen is in play', () => {
    // The hand resting on the glass between strokes.
    expect(isPalmTouch('touch', 10_000, 10_200)).toBe(true);
  });

  it('lets touch back in once the pen has been idle', () => {
    expect(isPalmTouch('touch', 10_000, 10_000 + PEN_LOCKOUT_MS + 1)).toBe(false);
  });

  it('never suppresses the pen itself, however recent the last pen event', () => {
    expect(isPalmTouch('pen', 10_000, 10_001)).toBe(false);
  });

  it('never suppresses a mouse', () => {
    expect(isPalmTouch('mouse', 10_000, 10_001)).toBe(false);
  });
});

describe('pen buttons', () => {
  it('treats the barrel button and the flipped eraser end as erasing', () => {
    expect(isEraserButton('pen', 2)).toBe(true);
    expect(isEraserButton('pen', 5)).toBe(true);
  });

  it('leaves the pen tip painting', () => {
    expect(isEraserButton('pen', 0)).toBe(false);
  });

  it('does not turn a right-click into an eraser', () => {
    // button 2 from a mouse is the context menu, not an eraser.
    expect(isEraserButton('mouse', 2)).toBe(false);
  });
});

describe('isGesture', () => {
  it('treats two or more contacts as moving the chart, not marking it', () => {
    expect(isGesture(1)).toBe(false);
    expect(isGesture(2)).toBe(true);
    expect(isGesture(3)).toBe(true);
  });
});
