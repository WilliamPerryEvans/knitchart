import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { cellAspect } from '../model/gauge';
import { warningSegments } from '../domain/floats';
import {
  rowArrow,
  rowLabelStep,
  rowLabelsFit,
  rowNumber,
  rowNumberOnRight,
  rowSide,
  showRowLabel,
  showStitchLabel,
  stitchLabelStep,
  stitchNumber,
} from '../domain/labels';
import { floodFill, lineCells, rectCells, type Cell } from './tools';
import {
  cellUnderPoint,
  clamp,
  isEraserButton,
  isGesture,
  isPalmTouch,
  midpoint,
  panForCell,
  pinchScale,
  type Point,
} from './gestures';
import {
  mirrorCellIndices,
  regionContains,
  regionFromCorners,
  rotatedPlacement,
  type QuarterTurns,
  type Region,
} from '../domain/region';

const BASE_CELL_W = 14; // css px at zoom 1
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 10;
const SIDE_LABEL_W = 24; // RS/WS column width, css px

interface View {
  zoom: number;
}

/**
 * Space around the grid inside the scrollable content, leaving room for the
 * gutter labels so they never sit outside the scrollable area.
 */
const MARGIN_L = 84; // RS/WS column + row numbers
const MARGIN_R = 56; // row numbers on the RS side
const MARGIN_T = 16;
const MARGIN_B = 30; // stitch numbers

/** Below this the desktop gutters cost more than the labels are worth. */
const COMPACT_WIDTH = 560;

/**
 * Gutter widths for the available viewport.
 *
 * The desktop layout spends 140px on labels — an RS/WS column, and row numbers
 * that alternate sides. On a 412px phone that is a third of the screen, and the
 * chart was being fitted into what little was left. Narrow screens drop the
 * RS/WS column and put every row number on the right, where stitch 1 and the
 * right-hand rows already are.
 */
function guttersFor(viewportW: number) {
  const compact = viewportW > 0 && viewportW < COMPACT_WIDTH;
  return compact
    ? { left: 8, right: 42, top: 8, bottom: 22, compact }
    : { left: MARGIN_L, right: MARGIN_R, top: MARGIN_T, bottom: MARGIN_B, compact };
}

interface DragState {
  mode: 'paint' | 'shape' | 'pan' | 'marquee' | 'moveSelection' | 'rotateSelection' | 'pinch';
  start: Cell;
  last: Cell;
  panStart: { x: number; y: number; scrollLeft: number; scrollTop: number } | null;
  /** Where the selection sat when a move-drag began. */
  origin?: { row: number; col: number };
  /** Colour this stroke lays down — the eraser end paints the background. */
  color?: number;
  /** Pointer angle about the selection centre when a rotate-drag began. */
  startAngle?: number;
  /** Quarter turns the rotate-drag has reached so far. */
  turns?: QuarterTurns;
}

/** Radius of the rotate grip, in css px. */
const ROTATE_HANDLE_R = 9;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function CanvasEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef({ w: 0, h: 0 });
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const chromeRef = useRef<HTMLCanvasElement | null>(null);
  const chromeKeyRef = useRef('');
  const chromeEmptyRef = useRef(true);
  const viewRef = useRef<View>({ zoom: 1 });
  const dragRef = useRef<DragState | null>(null);
  const hoverRef = useRef<Cell | null>(null);
  const spaceRef = useRef(false);
  /** Live contacts, so two fingers can be told apart from one. */
  const pointersRef = useRef(new Map<number, { x: number; y: number; type: string }>());
  /** When the pen was last seen, for palm rejection. */
  const lastPenRef = useRef<number | null>(null);
  /** The two contacts as of the last pinch frame; compared incrementally. */
  const pinchRef = useRef<{ last: [Point, Point] } | null>(null);
  const rafRef = useRef(0);
  const fittedForRef = useRef('');

  const chart = useStore((s) => s.chart);
  const gridVersion = useStore((s) => s.gridVersion);
  const squareMode = useStore((s) => s.squareMode);
  const tool = useStore((s) => s.tool);
  const activeColor = useStore((s) => s.activeColor);
  const floatWarnings = useStore((s) => s.floatWarnings);
  const showFloatHighlight = useStore((s) => s.showFloatHighlight);
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const pasteMode = useStore((s) => s.pasteMode);
  const chartEpoch = useStore((s) => s.chartEpoch);

  const cellW = BASE_CELL_W;
  const cellH = squareMode ? BASE_CELL_W : BASE_CELL_W * cellAspect(chart.gauge);

  /**
   * Where the grid's top-left corner sits in viewport coordinates. Derived from
   * the scroll container so the scrollbars, space-drag, and wheel-zoom can't
   * disagree about position. Content smaller than the viewport is centered.
   */
  const getPan = useCallback(() => {
    const sc = scrollRef.current;
    const { w: vw, h: vh } = viewportRef.current;
    const c = useStore.getState().chart;
    const zoom = viewRef.current.zoom;
    const gw = c.stitches * cellW * zoom;
    const gh = c.rows * cellH * zoom;
    const gut = guttersFor(vw);
    const contentW = gw + gut.left + gut.right;
    const contentH = gh + gut.top + gut.bottom;
    const scrollLeft = sc?.scrollLeft ?? 0;
    const scrollTop = sc?.scrollTop ?? 0;
    return {
      panX: contentW <= vw ? (vw - gw) / 2 : gut.left - scrollLeft,
      panY: contentH <= vh ? (vh - gh) / 2 : gut.top - scrollTop,
      gw,
      gh,
      contentW,
      contentH,
      gut,
    };
  }, [cellW, cellH]);

  /** Size the scroll spacer to the zoomed chart so the scrollbars match it. */
  const syncGeometry = useCallback(() => {
    const spacer = spacerRef.current;
    const sticky = stickyRef.current;
    const sc = scrollRef.current;
    if (!spacer || !sticky || !sc) return;
    viewportRef.current = { w: sc.clientWidth, h: sc.clientHeight };
    const { contentW, contentH } = getPan();
    spacer.style.width = `${Math.max(contentW, sc.clientWidth)}px`;
    spacer.style.height = `${Math.max(contentH, sc.clientHeight)}px`;
    sticky.style.width = `${sc.clientWidth}px`;
    sticky.style.height = `${sc.clientHeight}px`;
  }, [getPan]);

  // draw() is recreated when cell metrics change; route calls through a ref so
  // invalidate (stable identity) always hits the current version.
  const drawRef = useRef<() => void>(() => {});
  const invalidate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
    });
  }, []);

  /**
   * Update the 1px-per-cell offscreen raster of the grid.
   * `dirty` lists the cells that changed; null means rebuild everything.
   * Keeping the ImageData alive between edits means a paint stroke touches a
   * handful of pixels instead of re-encoding all 90k cells of a 300x300 chart.
   */
  const rebuildOffscreen = useCallback((dirty: number[] | null) => {
    const { grid, stitches, rows, palette } = useStore.getState().chart;
    let off = offscreenRef.current;
    let img = imageDataRef.current;
    const sizeChanged = !off || off.width !== stitches || off.height !== rows;
    if (sizeChanged) {
      off = document.createElement('canvas');
      off.width = stitches;
      off.height = rows;
      offscreenRef.current = off;
      img = new ImageData(stitches, rows);
      imageDataRef.current = img;
    }
    const ctx = off!.getContext('2d')!;
    const data = img!.data;
    const lut: Array<[number, number, number]> = palette.map((p) => hexToRgb(p.hex));
    const write = (i: number) => {
      const rgb = lut[grid[i]] ?? [255, 0, 255];
      const o = i * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    };

    if (sizeChanged || dirty === null) {
      for (let i = 0; i < grid.length; i++) write(i);
      ctx.putImageData(img!, 0, 0);
      return;
    }

    let minX = stitches;
    let maxX = -1;
    let minY = rows;
    let maxY = -1;
    for (const i of dirty) {
      if (i < 0 || i >= grid.length) continue;
      write(i);
      const x = i % stitches;
      const y = (i / stitches) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0) return;
    // Repaint only the bounding box of the changed cells.
    ctx.putImageData(img!, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
  }, []);

  const cellAt = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const el = overlayRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const { zoom } = viewRef.current;
      const { panX, panY } = getPan();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const col = Math.floor((x - panX) / (cellW * zoom));
      const row = Math.floor((y - panY) / (cellH * zoom));
      const c = useStore.getState().chart;
      if (col < 0 || col >= c.stitches || row < 0 || row >= c.rows) return null;
      return { row, col };
    },
    [cellW, cellH, getPan]
  );

  /** Pointer position in overlay-local css px. */
  const localPoint = useCallback((clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  /**
   * The rotate grip, sitting off the selection's top-right corner, and the
   * centre it turns about. Null when there is nothing selected.
   */
  const rotateHandle = useCallback(() => {
    const sel = useStore.getState().selection;
    if (!sel) return null;
    const { panX, panY } = getPan();
    const zoom = viewRef.current.zoom;
    const cw = cellW * zoom;
    const ch = cellH * zoom;
    return {
      x: panX + (sel.col + sel.w) * cw + 13,
      y: panY + sel.row * ch - 13,
      cx: panX + (sel.col + sel.w / 2) * cw,
      cy: panY + (sel.row + sel.h / 2) * ch,
    };
  }, [cellW, cellH, getPan]);

  /**
   * Grid lines and gutter labels, cached to their own canvas. They only change
   * when the view or chart shape does, so painting a stitch composites this
   * instead of re-stroking every line and re-laying out every label.
   */
  const drawChrome = useCallback(
    (
      w: number,
      h: number,
      cw: number,
      ch: number,
      panX: number,
      panY: number,
      compact: boolean
    ) => {
      const c = useStore.getState().chart;
      let chrome = chromeRef.current;
      const pxW = Math.max(1, Math.round(w * devicePixelRatio));
      const pxH = Math.max(1, Math.round(h * devicePixelRatio));
      if (!chrome || chrome.width !== pxW || chrome.height !== pxH) {
        chrome = document.createElement('canvas');
        chrome.width = pxW;
        chrome.height = pxH;
        chromeRef.current = chrome;
      }
      const ctx = chrome.getContext('2d')!;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const gridW = c.stitches * cw;
      const gridH = c.rows * ch;
      let drewSomething = false;

      // grid lines (skip when cells get tiny)
      if (cw >= 5 && ch >= 4) {
        drewSomething = true;
        ctx.beginPath();
        for (let col = 0; col <= c.stitches; col++) {
          const x = panX + col * cw;
          ctx.moveTo(x, panY);
          ctx.lineTo(x, panY + gridH);
        }
        for (let row = 0; row <= c.rows; row++) {
          const y = panY + row * ch;
          ctx.moveTo(panX, y);
          ctx.lineTo(panX + gridW, y);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // heavier line every 5 cells, counted from the bottom-right where knitting starts
        ctx.beginPath();
        for (let col = c.stitches; col >= 0; col -= 5) {
          const x = panX + col * cw;
          ctx.moveTo(x, panY);
          ctx.lineTo(x, panY + gridH);
        }
        for (let row = c.rows; row >= 0; row -= 5) {
          const y = panY + row * ch;
          ctx.moveTo(panX, y);
          ctx.lineTo(panX + gridW, y);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();
      }

      const fontPx = Math.min(12, Math.max(9, ch * 0.7));

      // Row numbers, RS/WS side labels, reading-direction arrows.
      // RS/WS gets its own column just left of the grid so it stays put even
      // though row numbers alternate sides; row numbers sit outside it.
      // Narrow screens drop the RS/WS column and stack every number on the
      // right — two gutters of labels cost more than they are worth on a phone.
      const rowStep = rowLabelStep(ch, fontPx);
      if (rowLabelsFit(ch, fontPx)) {
        drewSomething = true;
        ctx.font = `${fontPx.toFixed(0)}px system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        const sideColX = panX - 6;
        const numberColX = sideColX - SIDE_LABEL_W;
        const firstRow = Math.max(0, Math.floor(-panY / ch));
        const lastRow = Math.min(c.rows - 1, Math.ceil((h - panY) / ch));
        for (let r = firstRow; r <= lastRow; r++) {
          const num = rowNumber(c.rows, r);
          if (!showRowLabel(num, rowStep)) continue;
          const y = panY + (r + 0.5) * ch;
          const side = rowSide(c.direction, num);
          const arrow = rowArrow(c.direction, num);

          if (!compact) {
            ctx.textAlign = 'right';
            ctx.fillStyle = side === 'RS' ? '#8fa6c4' : '#94897d';
            ctx.fillText(side, sideColX, y);
          }

          // Tint the number itself with the RS/WS colours, so the side is still
          // readable once its own column is gone.
          ctx.fillStyle = compact ? (side === 'RS' ? '#8fa6c4' : '#94897d') : '#aab2bd';
          if (compact || rowNumberOnRight(c.direction, num)) {
            ctx.textAlign = 'left';
            ctx.fillText(`${num} ${arrow}`, panX + gridW + 5, y);
          } else {
            ctx.textAlign = 'right';
            ctx.fillText(`${arrow} ${num}`, numberColX, y);
          }
        }
      }

      // Stitch numbers along the bottom, counted right-to-left (stitch 1 at the
      // bottom right, where a RS row begins).
      if (cw >= 4) {
        drewSomething = true;
        ctx.font = `${fontPx.toFixed(0)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#aab2bd';
        const step = stitchLabelStep(cw, c.stitches, fontPx * 0.62);
        const firstCol = Math.max(0, Math.floor(-panX / cw));
        const lastCol = Math.min(c.stitches - 1, Math.ceil((w - panX) / cw));
        const y = panY + gridH + 5;
        for (let col = firstCol; col <= lastCol; col++) {
          const num = stitchNumber(c.stitches, col);
          if (!showStitchLabel(num, step)) continue;
          ctx.fillText(`${num}`, panX + (col + 0.5) * cw, y);
        }
      }
      // Zoomed far out nothing is legible, so the layer is blank — report that
      // so the caller can skip compositing a full-viewport empty canvas.
      chromeEmptyRef.current = !drewSomething;
    },
    []
  );

  const draw = useCallback(() => {
    const base = baseRef.current;
    const overlay = overlayRef.current;
    const off = offscreenRef.current;
    if (!base || !overlay || !off) return;
    const s = useStore.getState();
    const c = s.chart;
    const { zoom } = viewRef.current;
    const { panX, panY, gut } = getPan();
    const w = base.clientWidth;
    const h = base.clientHeight;
    const cw = cellW * zoom;
    const ch = cellH * zoom;
    const gridW = c.stitches * cw;
    const gridH = c.rows * ch;

    // ---- base layer: chart raster, then the cached grid/label chrome ----
    const ctx = base.getContext('2d')!;
    ctx.save();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#23262b';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, c.stitches, c.rows, panX, panY, gridW, gridH);

    // cw/ch already fold in zoom, gauge, and square mode
    const chromeKey = [w, h, cw, ch, panX, panY, c.stitches, c.rows, c.direction, gut.compact].join(
      '|'
    );
    if (chromeKey !== chromeKeyRef.current || !chromeRef.current) {
      drawChrome(w, h, cw, ch, panX, panY, gut.compact);
      chromeKeyRef.current = chromeKey;
    }
    if (!chromeEmptyRef.current) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(chromeRef.current!, 0, 0, w, h);
    }
    ctx.restore();

    // ---- overlay layer: float warnings, hover, drag preview ----
    const octx = overlay.getContext('2d')!;
    octx.save();
    octx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    octx.clearRect(0, 0, w, h);

    // Float warnings: mark each offending run with a bar along the bottom of
    // the stitches plus a faint tint. Deliberately NOT a solid block — a filled
    // rectangle over the cells reads as a selection rather than a warning.
    if (s.showFloatHighlight && s.floatWarnings.length > 0) {
      const barH = Math.max(2, Math.min(4, ch * 0.22));
      for (const seg of warningSegments(s.floatWarnings, c.stitches)) {
        const x = panX + seg.start * cw;
        const y = panY + seg.row * ch;
        const width = seg.len * cw;
        if (x + width < 0 || x > w || y + ch < 0 || y > h) continue; // offscreen

        octx.fillStyle = 'rgba(224, 49, 49, 0.13)';
        octx.fillRect(x, y, width, ch);

        // solid bar under the run, with end ticks marking where it starts/stops
        octx.fillStyle = 'rgba(214, 40, 40, 0.95)';
        octx.fillRect(x, y + ch - barH, width, barH);
        const tickH = Math.min(ch, barH * 3);
        octx.fillRect(x, y + ch - tickH, Math.max(1.5, barH * 0.6), tickH);
        octx.fillRect(
          x + width - Math.max(1.5, barH * 0.6),
          y + ch - tickH,
          Math.max(1.5, barH * 0.6),
          tickH
        );
      }
    }

    // drag preview for rect / line
    const drag = dragRef.current;
    if (drag && drag.mode === 'shape') {
      const t = s.tool;
      const cells =
        t === 'rect' ? rectCells(drag.start, drag.last, true) : lineCells(drag.start, drag.last);
      octx.fillStyle = s.chart.palette[s.activeColor]?.hex ?? '#000';
      octx.globalAlpha = 0.6;
      for (const cell of cells) {
        octx.fillRect(panX + cell.col * cw, panY + cell.row * ch, cw, ch);
      }
      octx.globalAlpha = 1;
    }

    // selection: the committed one, or a live preview while dragging
    const marchingAnts = (region: Region, dashed: boolean) => {
      const x = panX + region.col * cw;
      const y = panY + region.row * ch;
      const width = region.w * cw;
      const height = region.h * ch;
      octx.save();
      octx.fillStyle = 'rgba(79, 140, 201, 0.16)';
      octx.fillRect(x, y, width, height);
      // dark under-stroke first so the dashes read on light and dark stitches
      octx.strokeStyle = 'rgba(0,0,0,0.75)';
      octx.lineWidth = 1;
      octx.setLineDash([]);
      octx.strokeRect(x, y, width, height);
      if (dashed) octx.setLineDash([5, 4]);
      octx.strokeStyle = '#fff';
      octx.lineWidth = 1.5;
      octx.strokeRect(x, y, width, height);
      octx.restore();
    };

    if (drag?.mode === 'marquee') {
      marchingAnts(regionFromCorners(drag.start, drag.last), true);
    } else if (drag?.mode === 'rotateSelection' && s.selection) {
      const turns = drag.turns ?? 0;
      octx.save();
      octx.globalAlpha = 0.35;
      marchingAnts(s.selection, false);
      octx.restore();
      if (turns !== 0) {
        marchingAnts(
          rotatedPlacement(s.selection, { stitches: c.stitches, rows: c.rows }, turns),
          true
        );
      }
    } else if (drag?.mode === 'moveSelection' && drag.origin && s.selection) {
      // show where it will land, and where it came from
      const dRow = drag.last.row - drag.start.row;
      const dCol = drag.last.col - drag.start.col;
      octx.save();
      octx.globalAlpha = 0.35;
      marchingAnts(s.selection, false);
      octx.restore();
      marchingAnts(
        { ...s.selection, row: drag.origin.row + dRow, col: drag.origin.col + dCol },
        true
      );
    } else if (s.selection) {
      marchingAnts(s.selection, true);
    }

    // rotate grip — right angles only, so it snaps as you drag it round
    if (s.tool === 'select' && s.selection && drag?.mode !== 'marquee') {
      const grip = rotateHandle();
      if (grip) {
        octx.save();
        octx.beginPath();
        octx.arc(grip.x, grip.y, ROTATE_HANDLE_R, 0, Math.PI * 2);
        octx.fillStyle = drag?.mode === 'rotateSelection' ? '#4f8cc9' : 'rgba(20,22,26,0.85)';
        octx.fill();
        octx.strokeStyle = '#fff';
        octx.lineWidth = 1.5;
        octx.stroke();
        octx.fillStyle = '#fff';
        octx.font = '11px system-ui, sans-serif';
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillText('↻', grip.x, grip.y + 0.5);
        octx.restore();
      }
    }

    // hover cursor
    const hover = hoverRef.current;
    if (hover && !drag) {
      octx.strokeStyle = '#fff';
      octx.lineWidth = 2;
      octx.strokeRect(panX + hover.col * cw + 1, panY + hover.row * ch + 1, cw - 2, ch - 2);
      octx.strokeStyle = '#000';
      octx.lineWidth = 1;
      octx.strokeRect(panX + hover.col * cw, panY + hover.row * ch, cw, ch);
    }
    octx.restore();
  }, [cellW, cellH, getPan, drawChrome, rotateHandle]);
  drawRef.current = draw;

  // resize canvases to the scroll viewport, DPR-aware
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const resize = () => {
      syncGeometry();
      const { clientWidth, clientHeight } = sc;
      for (const canvas of [baseRef.current, overlayRef.current]) {
        if (!canvas) continue;
        canvas.style.width = `${clientWidth}px`;
        canvas.style.height = `${clientHeight}px`;
        canvas.width = Math.max(1, Math.round(clientWidth * devicePixelRatio));
        canvas.height = Math.max(1, Math.round(clientHeight * devicePixelRatio));
      }
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(sc);
    resize();
    return () => ro.disconnect();
  }, [invalidate, syncGeometry]);

  // Repaint the raster (only the changed cells) whenever the grid changes, then
  // empty the list. The store accumulates rather than replaces, so several
  // edits coalesced into one render all get drawn; consuming it here is what
  // stops the list growing without bound. Nothing selects `dirtyCells`, so this
  // write costs no re-renders.
  useEffect(() => {
    const dirty = useStore.getState().dirtyCells;
    rebuildOffscreen(dirty);
    if (useStore.getState().dirtyCells === dirty) useStore.setState({ dirtyCells: [] });
    invalidate();
  }, [gridVersion, chart.palette, rebuildOffscreen, invalidate]);

  // redraw on view-affecting state; gauge/square changes resize the content too
  useEffect(() => {
    syncGeometry();
    invalidate();
  }, [
    squareMode,
    floatWarnings,
    showFloatHighlight,
    selection,
    chart.direction,
    chart.gauge,
    chart.stitches,
    chart.rows,
    invalidate,
    syncGeometry,
  ]);

  // Fit the view only when a different chart arrives. Keyed on chartEpoch
  // rather than the dimensions, so resizing keeps the current zoom and scroll.
  useEffect(() => {
    const key = String(chartEpoch);
    if (fittedForRef.current === key) return;
    const sc = scrollRef.current;
    if (!sc || sc.clientWidth === 0) return;
    fittedForRef.current = key;
    const gut = guttersFor(sc.clientWidth);
    const w = sc.clientWidth - (gut.left + gut.right);
    const h = sc.clientHeight - (gut.top + gut.bottom);
    viewRef.current.zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(w / (chart.stitches * cellW), h / (chart.rows * cellH)))
    );
    syncGeometry();
    // centre the chart in the scrollable content
    sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
    sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2;
    invalidate();
  }, [chartEpoch, chart.stitches, chart.rows, cellW, cellH, invalidate, syncGeometry]);

  // Dev-only: let the browser test turn a stitch into a screen point using the
  // editor's own view maths, rather than duplicating (and drifting from) it.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (
      window as unknown as {
        __knitView: {
          cellPoint: (row: number, col: number) => { x: number; y: number } | null;
          rotateGrip: () => { x: number; y: number; cx: number; cy: number } | null;
        };
      }
    ).__knitView = {
      cellPoint: (row, col) => {
        const el = overlayRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const { panX, panY } = getPan();
        const zoom = viewRef.current.zoom;
        return {
          x: rect.left + panX + (col + 0.5) * cellW * zoom,
          y: rect.top + panY + (row + 0.5) * cellH * zoom,
        };
      },
      rotateGrip: () => {
        const el = overlayRef.current;
        const grip = rotateHandle();
        if (!el || !grip) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + grip.x,
          y: rect.top + grip.y,
          cx: rect.left + grip.cx,
          cy: rect.top + grip.cy,
        };
      },
    };
  }, [getPan, cellW, cellH, rotateHandle]);

  // space key for panning
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        spaceRef.current = true;
        if (overlayRef.current) overlayRef.current.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        if (overlayRef.current) overlayRef.current.style.cursor = 'crosshair';
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /** Grid indices for cells, expanded by the mirror axis and clipped to the chart. */
  const indicesFor = useCallback((cells: Cell[]): number[] => {
    const s = useStore.getState();
    const c = s.chart;
    const size = { stitches: c.stitches, rows: c.rows };
    const inside = cells
      .filter((p) => p.row >= 0 && p.row < c.rows && p.col >= 0 && p.col < c.stitches)
      .map((p) => p.row * c.stitches + p.col);
    return mirrorCellIndices(inside, size, s.mirrorAxis);
  }, []);

  const applyShape = useCallback(
    (shape: 'rect' | 'line', start: Cell, end: Cell) => {
      const s = useStore.getState();
      const cells = shape === 'rect' ? rectCells(start, end, true) : lineCells(start, end);
      s.applyCells(
        shape === 'rect' ? 'Rectangle' : 'Line',
        indicesFor(cells).map((i) => ({ i, color: s.activeColor }))
      );
    },
    [indicesFor]
  );

  /**
   * Change the zoom while keeping a chart position pinned to a screen point.
   *
   * `from` is where the anchor is now, `to` where it should end up — the same
   * point for a wheel zoom, two different points for a pinch that also drags.
   * Shared by both so they cannot drift: pan is derived from the scroll
   * container, so zooming means re-deriving the scroll offset for the new zoom.
   */
  const zoomAround = useCallback(
    (nextZoom: number, from: Point, to: Point) => {
      const sc = scrollRef.current;
      if (!sc) return;
      const size = { w: cellW, h: cellH };
      const v = viewRef.current;
      const before = getPan();
      const held = cellUnderPoint(from, { x: before.panX, y: before.panY }, size, v.zoom);

      v.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      syncGeometry();

      const after = getPan();
      const want = panForCell(held, to, size, v.zoom);
      const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
      const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
      // Content smaller than the viewport is centred, so scrolling does nothing.
      if (after.contentW > viewportRef.current.w) {
        sc.scrollLeft = clamp(after.gut.left - want.x, 0, maxLeft);
      }
      if (after.contentH > viewportRef.current.h) {
        sc.scrollTop = clamp(after.gut.top - want.y, 0, maxTop);
      }
      invalidate();
    },
    [getPan, syncGeometry, cellW, cellH, invalidate]
  );

  /** Contacts in canvas coordinates, oldest first. */
  const contactPoints = useCallback((): Point[] => {
    const el = overlayRef.current;
    if (!el) return [];
    const rect = el.getBoundingClientRect();
    return [...pointersRef.current.values()].map((pt) => ({
      x: pt.x - rect.left,
      y: pt.y - rect.top,
    }));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const s = useStore.getState();
      const now = performance.now();
      if (e.pointerType === 'pen') lastPenRef.current = now;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

      // A second contact means "move the chart", not "draw". The first finger
      // has already painted a short line by now, so throw it away rather than
      // leaving a stray mark at the start of every pinch.
      if (isGesture(pointersRef.current.size)) {
        if (dragRef.current?.mode === 'paint') s.cancelStroke();
        const pts = contactPoints();
        if (pts.length >= 2) {
          dragRef.current = {
            mode: 'pinch',
            start: { row: 0, col: 0 },
            last: { row: 0, col: 0 },
            panStart: null,
          };
          pinchRef.current = { last: [pts[0], pts[1]] };
        }
        hoverRef.current = null;
        invalidate();
        return;
      }

      // The hand resting on the glass while the pen is in play.
      if (isPalmTouch(e.pointerType, lastPenRef.current, now)) return;

      if (spaceRef.current || e.button === 1) {
        dragRef.current = {
          mode: 'pan',
          start: { row: 0, col: 0 },
          last: { row: 0, col: 0 },
          panStart: {
            x: e.clientX,
            y: e.clientY,
            scrollLeft: scrollRef.current?.scrollLeft ?? 0,
            scrollTop: scrollRef.current?.scrollTop ?? 0,
          },
        };
        el.style.cursor = 'grabbing';
        return;
      }
      // The pen's barrel button and flipped-over eraser end rub stitches back to
      // the background; a mouse right-click still does nothing.
      const erasing = isEraserButton(e.pointerType, e.button);
      if (e.button !== 0 && !erasing) return;

      // The rotate grip sits outside the selection, and often outside the grid
      // entirely, so it has to be tested before both the move branch and the
      // click-off-to-deselect below.
      if (s.tool === 'select' && s.selection) {
        const grip = rotateHandle();
        const p = localPoint(e.clientX, e.clientY);
        if (grip && p && Math.hypot(p.x - grip.x, p.y - grip.y) <= ROTATE_HANDLE_R + 3) {
          dragRef.current = {
            mode: 'rotateSelection',
            start: { row: 0, col: 0 },
            last: { row: 0, col: 0 },
            panStart: null,
            startAngle: Math.atan2(p.y - grip.cy, p.x - grip.cx),
            turns: 0,
          };
          invalidate();
          return;
        }
      }

      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) {
        // Clicking off the grid means "I'm done with this selection".
        if (s.tool === 'select' && s.selection) {
          s.setSelection(null);
          invalidate();
        }
        return;
      }
      const c = s.chart;
      const i = cell.row * c.stitches + cell.col;

      switch (s.tool) {
        case 'pencil': {
          const color = erasing ? 0 : s.activeColor;
          s.beginStroke();
          s.paintCells(indicesFor([cell]).map((idx) => ({ i: idx, color })));
          dragRef.current = { mode: 'paint', start: cell, last: cell, panStart: null, color };
          break;
        }
        case 'fill': {
          const indices = floodFill(c.grid, c.stitches, c.rows, cell.row, cell.col);
          s.applyCells(
            'Fill',
            indices.map((idx) => ({ i: idx, color: s.activeColor }))
          );
          break;
        }
        case 'eyedropper': {
          s.setActiveColor(c.grid[i]);
          break;
        }
        case 'rect':
        case 'line': {
          dragRef.current = { mode: 'shape', start: cell, last: cell, panStart: null };
          invalidate();
          break;
        }
        case 'select': {
          // Inside the current selection, drag moves it; anywhere else starts a
          // new marquee — which doubles as "click outside to deselect".
          if (s.selection && regionContains(s.selection, cell.row, cell.col)) {
            dragRef.current = {
              mode: 'moveSelection',
              start: cell,
              last: cell,
              panStart: null,
              origin: { row: s.selection.row, col: s.selection.col },
            };
          } else {
            s.setSelection(null);
            dragRef.current = { mode: 'marquee', start: cell, last: cell, panStart: null };
          }
          invalidate();
          break;
        }
      }
    },
    [cellAt, invalidate, indicesFor, rotateHandle, localPoint, contactPoints]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const tracked = pointersRef.current.get(e.pointerId);
      if (tracked) {
        tracked.x = e.clientX;
        tracked.y = e.clientY;
      }
      const drag = dragRef.current;

      // Pinch: measured against the previous frame rather than the gesture
      // start, so zooming and dragging compose without accumulating drift.
      if (drag?.mode === 'pinch') {
        const pts = contactPoints();
        const prev = pinchRef.current;
        if (pts.length >= 2 && prev) {
          const now: [Point, Point] = [pts[0], pts[1]];
          zoomAround(
            viewRef.current.zoom * pinchScale(prev.last, now),
            midpoint(prev.last[0], prev.last[1]),
            midpoint(now[0], now[1])
          );
          prev.last = now;
        }
        return;
      }

      // A palm dragging across the glass must not smear paint either.
      if (isPalmTouch(e.pointerType, lastPenRef.current, performance.now())) return;

      if (drag?.mode === 'pan' && drag.panStart) {
        const sc = scrollRef.current;
        if (sc) {
          // dragging right moves the chart right, i.e. scrolls left
          sc.scrollLeft = drag.panStart.scrollLeft - (e.clientX - drag.panStart.x);
          sc.scrollTop = drag.panStart.scrollTop - (e.clientY - drag.panStart.y);
        }
        invalidate();
        return;
      }
      // Rotating tracks the pointer wherever it goes, including off the grid.
      if (drag?.mode === 'rotateSelection' && drag.startAngle !== undefined) {
        const grip = rotateHandle();
        const p = localPoint(e.clientX, e.clientY);
        if (grip && p) {
          const angle = Math.atan2(p.y - grip.cy, p.x - grip.cx);
          const quarters = Math.round((angle - drag.startAngle) / (Math.PI / 2));
          drag.turns = (((quarters % 4) + 4) % 4) as QuarterTurns;
        }
        invalidate();
        return;
      }
      const cell = cellAt(e.clientX, e.clientY);
      hoverRef.current = cell;
      if (drag && cell) {
        const s = useStore.getState();
        if (drag.mode === 'paint') {
          // fill the gap since the last event so fast drags don't leave holes
          const cells = indicesFor(lineCells(drag.last, cell)).map((i) => ({
            i,
            color: drag.color ?? s.activeColor,
          }));
          s.paintCells(cells);
          drag.last = cell;
        } else if (drag.mode === 'shape' || drag.mode === 'marquee') {
          drag.last = cell;
        } else if (drag.mode === 'moveSelection' && drag.origin) {
          drag.last = cell;
        }
      }
      invalidate();
    },
    [cellAt, invalidate, indicesFor, rotateHandle, localPoint, contactPoints, zoomAround]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(e.pointerId);
      const drag = dragRef.current;

      // Stay in the gesture until the second finger lifts, then re-seed from
      // whatever is left so a third contact doesn't jump the chart.
      if (drag?.mode === 'pinch') {
        const pts = contactPoints();
        if (pts.length >= 2) {
          pinchRef.current = { last: [pts[0], pts[1]] };
        } else {
          dragRef.current = null;
          pinchRef.current = null;
        }
        invalidate();
        return;
      }

      dragRef.current = null;
      const s = useStore.getState();
      if (!drag) return;
      if (drag.mode === 'pan') {
        e.currentTarget.style.cursor = spaceRef.current ? 'grab' : 'crosshair';
      } else if (drag.mode === 'paint') {
        s.endStroke('Pencil');
      } else if (drag.mode === 'shape') {
        applyShape(s.tool === 'rect' ? 'rect' : 'line', drag.start, drag.last);
      } else if (drag.mode === 'marquee') {
        s.setSelection(regionFromCorners(drag.start, drag.last));
      } else if (drag.mode === 'rotateSelection') {
        if (drag.turns) s.rotateSelection(drag.turns);
      } else if (drag.mode === 'moveSelection' && drag.origin) {
        const dRow = drag.last.row - drag.start.row;
        const dCol = drag.last.col - drag.start.col;
        if (dRow !== 0 || dCol !== 0) {
          s.moveSelection(drag.origin.row + dRow, drag.origin.col + dCol);
        }
      }
      invalidate();
    },
    [applyShape, invalidate, contactPoints]
  );

  /**
   * Ctrl/plain wheel zooms toward the cursor; shift+wheel scrolls sideways.
   * Zooming keeps the stitch under the pointer fixed by re-deriving the scroll
   * offset for the new zoom, since pan comes from the scroll container.
   */
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const el = overlayRef.current;
      const sc = scrollRef.current;
      if (!el || !sc) return;

      if (e.shiftKey) {
        sc.scrollLeft += e.deltaY;
        invalidate();
        return;
      }

      // Same path a pinch takes: hold the stitch under the cursor still.
      const rect = el.getBoundingClientRect();
      const focus = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      zoomAround(viewRef.current.zoom * Math.pow(1.0015, -e.deltaY), focus, focus);
    },
    [invalidate, zoomAround]
  );

  /**
   * The browser can take a gesture away mid-flight (a system edge swipe, the
   * app backgrounding). Drop the contact and abandon anything in progress, or
   * the next touch resumes a stroke that visually ended long ago.
   */
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (dragRef.current?.mode === 'paint') useStore.getState().cancelStroke();
    if (pointersRef.current.size < 2) {
      dragRef.current = null;
      pinchRef.current = null;
    }
    hoverRef.current = null;
    invalidate();
  }, [invalidate]);

  return (
    <div ref={containerRef} className="editor-container">
      {/*
        The canvases live inside the scroller as a sticky layer sized to the
        viewport: the spacer gives the scrollbars something the size of the
        zoomed chart to scroll over, while the canvases stay pinned in view.
      */}
      <div ref={scrollRef} className="editor-scroll" onScroll={invalidate}>
        <div ref={spacerRef} className="editor-spacer">
          <div ref={stickyRef} className="editor-sticky">
            <canvas ref={baseRef} className="editor-canvas" />
            <canvas
              ref={overlayRef}
              className="editor-canvas editor-overlay"
              style={{ cursor: tool === 'eyedropper' ? 'copy' : 'crosshair' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onPointerLeave={() => {
                hoverRef.current = null;
                invalidate();
              }}
              onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        </div>
      </div>
      {tool === 'select' && selection && (
        <div className="selection-bar">
          <span className="selection-size">
            {selection.w} × {selection.h} sts
          </span>
          <button title="Copy (Ctrl+C)" onClick={() => useStore.getState().copySelection()}>
            Copy
          </button>
          <button
            title="Paste (Ctrl+V)"
            disabled={!clipboard}
            onClick={() => useStore.getState().pasteClipboard()}
          >
            Paste
          </button>
          {/* What Paste and Ctrl+V do: overwrite, or let the background colour
              of the copy show whatever is already on the chart. */}
          <span className="selection-modes" title="What a paste does to the stitches underneath">
            <button
              className={pasteMode === 'replace' ? 'seg on' : 'seg'}
              onClick={() => useStore.getState().setPasteMode('replace')}
            >
              Replace
            </button>
            <button
              className={pasteMode === 'over' ? 'seg on' : 'seg'}
              title={`Stitches in ${chart.palette[0]?.name ?? 'the first color'} stay see-through`}
              onClick={() => useStore.getState().setPasteMode('over')}
            >
              On top
            </button>
          </span>
          <button
            title="Turn a quarter clockwise — or drag the ↻ grip"
            onClick={() => useStore.getState().rotateSelection(1)}
          >
            ↻
          </button>
          <button
            title="Turn a quarter anticlockwise"
            onClick={() => useStore.getState().rotateSelection(3)}
          >
            ↺
          </button>
          <button
            title="Flip left to right"
            onClick={() => useStore.getState().mirrorSelection('horizontal')}
          >
            Flip ↔
          </button>
          <button
            title="Flip top to bottom"
            onClick={() => useStore.getState().mirrorSelection('vertical')}
          >
            Flip ↕
          </button>
          <button
            title={`Fill with ${chart.palette[activeColor]?.name ?? 'the active color'}`}
            onClick={() => useStore.getState().fillSelection(activeColor)}
          >
            Fill
          </button>
          <button title="Clear to background (Delete)" onClick={() => useStore.getState().fillSelection(0)}>
            Clear
          </button>
          <button title="Deselect (Esc)" onClick={() => useStore.getState().clearSelection()}>
            Done
          </button>
        </div>
      )}
      <div className="editor-hint">
        {tool === 'pencil' && `Pencil — drag to paint ${chart.palette[activeColor]?.name ?? ''}`}
        {tool === 'fill' && 'Flood fill — click a region'}
        {tool === 'eyedropper' && 'Eyedropper — click to pick up a color'}
        {tool === 'rect' && 'Rectangle — drag corner to corner'}
        {tool === 'line' && 'Line — drag start to end'}
        {tool === 'select' &&
          (selection
            ? 'Drag inside to move · drag the ↻ grip to turn it · Esc or click off the chart to deselect'
            : 'Drag to select stitches')}
        <span className="hint-pointer"> · wheel zoom · shift+wheel or scrollbars to pan</span>
        <span className="hint-touch"> · two fingers to zoom and pan</span>
      </div>
    </div>
  );
}
