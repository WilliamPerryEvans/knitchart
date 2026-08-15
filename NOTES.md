# KnitChart — build notes

A desktop knitting chart maker for Windows. React + TypeScript + Vite frontend,
Canvas 2D chart rendering, Zustand state, wrapped with Tauri v2.

Background research lives in `../Custom Knitter Technical Build Guide.md`. This
app implements **the core editor only** — see "Deliberately not built" below.

## Where to pick up

Core editor is complete and verified. Next candidates, in the guide's order:
image import (image-q quantization), PDF export (pdf-lib with page tiling),
stitch symbols, repeat boxes, knit-mode progress tracker, AI assistant.

## Running it

```bash
npm install
npm run dev          # browser at localhost:5173
npm test             # vitest, 53 unit tests
npx tauri dev        # desktop app with hot reload
npx tauri build      # NSIS installer -> src-tauri/target/release/bundle/nsis/
```

The Rust toolchain is required for the Tauri commands (`rustup`, MSVC target).
First `tauri build` takes ~6 minutes; later builds are much faster.

## Layout

```
src/
  model/     types, RLE codec, .knitchart file <-> Chart, gauge math
  domain/    float checker, gutter label conventions
  state/     Zustand store + undo/redo command stack
  editor/    Canvas render loop, tool geometry (line/rect/flood fill)
  components/ TopBar, Toolbar, PalettePanel, WarningsPanel, NewChartDialog
  io/        save/open, PNG + SVG export
src-tauri/   Rust shell, NSIS bundle config, fs/dialog permissions
```

## Decisions worth remembering

**Grid orientation.** `grid[row * stitches + col]`, row 0 is the **top** of the
chart. Knitting numbers rows from the bottom, so the displayed number is
`rows - gridRow`. Heavy 5-cell guide lines are counted from the bottom-right
(where knitting starts), not the top-left, so they land on the same stitches a
knitter counts to.

**Gutter labels live in one module** (`domain/labels.ts`) that both the canvas
and the PNG/SVG export import, so the printed chart can't drift from the edited
one. It fixes the conventions: rows number from the bottom, stitches number from
the **right** (stitch 1 is the bottom-right corner, where a RS row begins), odd
rows are RS and even are WS when flat, and every round is RS. RS/WS labels get
their own fixed column immediately left of the grid, with row numbers outside
it — the numbers alternate sides, so RS/WS needs its own lane to stay readable.
Stitch numbers thin to every 5th or 10th automatically when cells are too narrow
for the digits (`stitchLabelStep`).

**Gauge aspect ratio** is `stsPer4in / rowsPer4in` (~0.77 for worsted 20×26),
i.e. cells are *wider than tall*. The "Square grid" toggle only changes
rendering; it never touches the data.

**Float checking treats a solid single-color row as having no floats** — with
one color in play there is no second yarn being stranded behind. This matters
because a blank chart is entirely one color and would otherwise light up red.
In the round, the scan wraps the row boundary and reports the run once, anchored
at the first color change so it can't be double-counted.

**Undo/redo stores cell diffs, not grid snapshots.** A 300×300 snapshot is 90 KB
per step; a diff is a handful of entries. A drag coalesces into one command:
`beginStroke()` → many `paintCell()` → `endStroke()`. If a cell is repainted
within one stroke, the command keeps the *original* `before` so a single undo
reverts the whole drag. History is capped at 200 commands.

**Pan comes from a real scroll container, not a stored offset.** The canvases sit
inside `.editor-scroll` as a `position: sticky` layer sized to the viewport,
over a spacer sized to the zoomed chart — so the browser draws genuine
scrollbars and `getPan()` derives the grid origin from `scrollLeft`/`scrollTop`.
Scrollbars, space-drag, and wheel-zoom therefore cannot disagree about position:
space-drag and zoom both write to the scroll offset. Content smaller than the
viewport is centered instead. Wheel zooms (anchored on the cursor), shift+wheel
scrolls sideways.

**Float warnings are drawn as a bar under each run, not a filled block.** The
first version tinted the whole run solid red, and the first person to use it
asked "what is the red select for?" — a filled rectangle over cells reads as a
selection, not a warning. It is now a faint tint plus a solid bar with end ticks
along the bottom of the stitches, and `showFloatHighlight` toggles it off
entirely from the Float Check panel.

**Yarn weight presets** (`domain/yarn.ts`) fill in gauge for people who don't
have a swatch — stitch counts are the Craft Yarn Council standard categories,
row counts are typical values (CYC doesn't publish them). They only *set* the
gauge fields; nothing stores which yarn was picked, so the numbers stay editable
and the preset dropdown just shows whichever entry matches, or "Custom".

**Rendering is a 1px-per-cell offscreen canvas scaled up**, not per-cell
fillRect. The `ImageData` persists between edits and only cells listed in
`store.dirtyCells` are rewritten (`dirtyCells: null` forces a full rebuild, used
for new/loaded charts and palette hex changes). Two stacked canvases: the base
holds the chart + grid + row numbers, the overlay holds float warnings, hover
cursor, and shape previews, so UI chrome never repaints the chart.

**Float warnings redraw as one span per run, not per cell.** Painting one
contrast stitch in a 300-wide row flags two ~150-stitch runs; filling those
cell-by-cell dropped the editor to 39 fps. Spans hold 60 fps.

**Float rechecking is row-scoped.** `updateChartFloats` rescans only the rows an
edit touched and reuses the rest; a unit test asserts it agrees with a full
rescan, including in the round.

**The warnings panel lists at most 50 rows** (`MAX_LISTED`), with a "+N more"
line. This is a performance guard, not just tidiness: the list re-renders on
every stroke, and an unbounded one degraded painting from ~58 fps to 14 fps as
warnings accumulated past 600 on a 300×300 chart. The chart itself highlights
every offending run, so the list only needs to be a readable summary.

## Performance

On a 300×300 chart (90,000 cells), painting sustains **~55–60 fps**, holding
steady over a 6-second session while active float warnings grew past 470. The
guide's threshold for reaching for WebGL is a sustained drop below 30 fps —
nowhere near it, so the base grid stays on Canvas 2D.

Worth knowing if you optimize further: the per-edit JavaScript is already
negligible (**0.09 ms** for the store mutation plus row-scoped float rescan; a
full 90k-cell rescan would be 0.73 ms). The frame cost is React re-rendering and
canvas compositing, not the chart logic — so measure before optimizing, and
measure the *right* thing. Two rounds of plausible-sounding canvas tuning here
moved nothing because the actual cost was the DOM warning list.

## File format

`.knitchart` is JSON, documented by the `KnitChartFile` interface in
`src/model/types.ts`. Rows are run-length encoded (`[paletteIndex, runLength]`
pairs), which keeps colorwork tiny — a 300×300 chart with large solid areas is a
few KB. In memory the grid is a flat `Uint8Array` for editing speed; RLE happens
only on save.

`symbolLayer` and `repeats` are already in the format and reserved for stitch
symbols and repeat boxes. Loading is validated: dimension sanity, RLE row-width
agreement, and every cell referencing a palette entry that exists.

## Testing

- `npm test` — 79 unit tests over the pure functions: RLE encode/decode
  (round-trips, malformed input), gauge math, float checker (flat, in the round,
  wrap, thresholds, incremental vs full rescan), label conventions (row/stitch
  numbering, RS/WS, label thinning), yarn-weight presets, and the store's stroke
  coalescing, undo/redo, and color swap.
- Browser smoke test (not in the repo — it lives in the session scratchpad):
  drives the real app with puppeteer-core against Edge, checking drag-paint,
  undo/redo via keyboard, flood fill, eyedropper, rectangle, the square-grid
  toggle, round-wrap warnings, export bytes, a save→load round trip, and frame
  rate. It relies on `window.__knitStore`, which `src/state/store.ts` exposes
  **only under `import.meta.env.DEV`**.

## Deliberately not built

Image import, AI features, PDF export, stitch symbols, and knit-mode progress
tracking were all scoped out of this pass. The data model has room for them.

## Gotchas

- `saveBytes`/`saveChart` detect Tauri via `window.__TAURI_INTERNALS__` and fall
  back to browser download / file picker, so the app stays fully usable under
  `npm run dev` without the desktop shell.
- Tauri file access needs both the plugin registered in `src-tauri/src/lib.rs`
  and the permission listed in `src-tauri/capabilities/default.json`. Missing
  the capability entry fails at runtime, not at build time.
- The bundle target is `nsis` only. `"targets": "all"` also attempts an MSI via
  WiX, which is a slower extra download for no benefit here.
