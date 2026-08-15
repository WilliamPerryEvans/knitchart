import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { cellAspect } from '../model/gauge';
import { warningSegments } from '../domain/floats';
import {
  rowArrow,
  rowNumber,
  rowNumberOnRight,
  rowSide,
  showStitchLabel,
  stitchLabelStep,
  stitchNumber,
} from '../domain/labels';
import { floodFill, lineCells, rectCells, type Cell } from './tools';

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

interface DragState {
  mode: 'paint' | 'shape' | 'pan';
  start: Cell;
  last: Cell;
  panStart: { x: number; y: number; scrollLeft: number; scrollTop: number } | null;
}

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
  const rafRef = useRef(0);
  const fittedForRef = useRef('');

  const chart = useStore((s) => s.chart);
  const gridVersion = useStore((s) => s.gridVersion);
  const squareMode = useStore((s) => s.squareMode);
  const tool = useStore((s) => s.tool);
  const activeColor = useStore((s) => s.activeColor);
  const floatWarnings = useStore((s) => s.floatWarnings);
  const showFloatHighlight = useStore((s) => s.showFloatHighlight);

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
    const contentW = gw + MARGIN_L + MARGIN_R;
    const contentH = gh + MARGIN_T + MARGIN_B;
    const scrollLeft = sc?.scrollLeft ?? 0;
    const scrollTop = sc?.scrollTop ?? 0;
    return {
      panX: contentW <= vw ? (vw - gw) / 2 : MARGIN_L - scrollLeft,
      panY: contentH <= vh ? (vh - gh) / 2 : MARGIN_T - scrollTop,
      gw,
      gh,
      contentW,
      contentH,
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

  /**
   * Grid lines and gutter labels, cached to their own canvas. They only change
   * when the view or chart shape does, so painting a stitch composites this
   * instead of re-stroking every line and re-laying out every label.
   */
  const drawChrome = useCallback(
    (w: number, h: number, cw: number, ch: number, panX: number, panY: number) => {
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
      if (ch >= 7) {
        drewSomething = true;
        ctx.font = `${fontPx.toFixed(0)}px system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        const sideColX = panX - 6;
        const numberColX = sideColX - SIDE_LABEL_W;
        const firstRow = Math.max(0, Math.floor(-panY / ch));
        const lastRow = Math.min(c.rows - 1, Math.ceil((h - panY) / ch));
        for (let r = firstRow; r <= lastRow; r++) {
          const num = rowNumber(c.rows, r);
          const y = panY + (r + 0.5) * ch;
          const side = rowSide(c.direction, num);
          const arrow = rowArrow(c.direction, num);

          ctx.textAlign = 'right';
          ctx.fillStyle = side === 'RS' ? '#8fa6c4' : '#94897d';
          ctx.fillText(side, sideColX, y);

          ctx.fillStyle = '#aab2bd';
          if (rowNumberOnRight(c.direction, num)) {
            ctx.textAlign = 'left';
            ctx.fillText(`${num} ${arrow}`, panX + gridW + 6, y);
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
    const { panX, panY } = getPan();
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
    const chromeKey = [w, h, cw, ch, panX, panY, c.stitches, c.rows, c.direction].join('|');
    if (chromeKey !== chromeKeyRef.current || !chromeRef.current) {
      drawChrome(w, h, cw, ch, panX, panY);
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
  }, [cellW, cellH, getPan]);
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

  // repaint the raster (only the changed cells) whenever the grid changes
  useEffect(() => {
    rebuildOffscreen(useStore.getState().dirtyCells);
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
    chart.direction,
    chart.gauge,
    invalidate,
    syncGeometry,
  ]);

  // fit chart to view when a new/loaded chart arrives
  useEffect(() => {
    const key = `${chart.created}|${chart.stitches}x${chart.rows}`;
    if (fittedForRef.current === key) return;
    const sc = scrollRef.current;
    if (!sc || sc.clientWidth === 0) return;
    fittedForRef.current = key;
    const w = sc.clientWidth - (MARGIN_L + MARGIN_R);
    const h = sc.clientHeight - (MARGIN_T + MARGIN_B);
    viewRef.current.zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(w / (chart.stitches * cellW), h / (chart.rows * cellH)))
    );
    syncGeometry();
    // centre the chart in the scrollable content
    sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
    sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2;
    invalidate();
  }, [chart.created, chart.stitches, chart.rows, cellW, cellH, invalidate, syncGeometry]);

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

  const applyShape = useCallback((shape: 'rect' | 'line', start: Cell, end: Cell) => {
    const s = useStore.getState();
    const c = s.chart;
    const cells = shape === 'rect' ? rectCells(start, end, true) : lineCells(start, end);
    s.applyCells(
      shape === 'rect' ? 'Rectangle' : 'Line',
      cells
        .filter((p) => p.row >= 0 && p.row < c.rows && p.col >= 0 && p.col < c.stitches)
        .map((p) => ({ i: p.row * c.stitches + p.col, color: s.activeColor }))
    );
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const s = useStore.getState();

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
      if (e.button !== 0) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      const c = s.chart;
      const i = cell.row * c.stitches + cell.col;

      switch (s.tool) {
        case 'pencil': {
          s.beginStroke();
          s.paintCell(i, s.activeColor);
          dragRef.current = { mode: 'paint', start: cell, last: cell, panStart: null };
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
      }
    },
    [cellAt, invalidate]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
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
      const cell = cellAt(e.clientX, e.clientY);
      hoverRef.current = cell;
      if (drag && cell) {
        const s = useStore.getState();
        if (drag.mode === 'paint') {
          const c = s.chart;
          const cells = lineCells(drag.last, cell).map((p) => ({
            i: p.row * c.stitches + p.col,
            color: s.activeColor,
          }));
          s.paintCells(cells);
          drag.last = cell;
        } else if (drag.mode === 'shape') {
          drag.last = cell;
        }
      }
      invalidate();
    },
    [cellAt, invalidate]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      const s = useStore.getState();
      if (!drag) return;
      if (drag.mode === 'pan') {
        e.currentTarget.style.cursor = spaceRef.current ? 'grab' : 'crosshair';
      } else if (drag.mode === 'paint') {
        s.endStroke('Pencil');
      } else if (drag.mode === 'shape') {
        applyShape(s.tool === 'rect' ? 'rect' : 'line', drag.start, drag.last);
      }
      invalidate();
    },
    [applyShape, invalidate]
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

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const v = viewRef.current;
      const before = getPan();
      // which cell (fractional) sits under the cursor right now
      const cellX = (x - before.panX) / (cellW * v.zoom);
      const cellY = (y - before.panY) / (cellH * v.zoom);

      const factor = Math.pow(1.0015, -e.deltaY);
      v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      syncGeometry();

      // put that same cell back under the cursor
      const after = getPan();
      const wantPanX = x - cellX * cellW * v.zoom;
      const wantPanY = y - cellY * cellH * v.zoom;
      const maxLeft = Math.max(0, sc.scrollWidth - sc.clientWidth);
      const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
      if (after.contentW > viewportRef.current.w) {
        sc.scrollLeft = Math.max(0, Math.min(maxLeft, MARGIN_L - wantPanX));
      }
      if (after.contentH > viewportRef.current.h) {
        sc.scrollTop = Math.max(0, Math.min(maxTop, MARGIN_T - wantPanY));
      }
      invalidate();
    },
    [invalidate, getPan, syncGeometry, cellW, cellH]
  );

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
      <div className="editor-hint">
        {tool === 'pencil' && `Pencil — drag to paint ${chart.palette[activeColor]?.name ?? ''}`}
        {tool === 'fill' && 'Flood fill — click a region'}
        {tool === 'eyedropper' && 'Eyedropper — click to pick up a color'}
        {tool === 'rect' && 'Rectangle — drag corner to corner'}
        {tool === 'line' && 'Line — drag start to end'}
        {' · wheel zoom · shift+wheel or scrollbars to pan'}
      </div>
    </div>
  );
}
