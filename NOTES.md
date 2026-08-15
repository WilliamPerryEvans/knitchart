# KnitChart — build notes

A desktop knitting chart maker for Windows. React + TypeScript + Vite frontend,
Canvas 2D chart rendering, Zustand state, wrapped with Tauri v2.

Background research lives in `../Custom Knitter Technical Build Guide.md`. This
app implements **the core editor only** — see "Deliberately not built" below.

## Where to pick up

The editor and printing are done: painting, selection, resize, palette
management, float checking, PNG/SVG export, and print-ready multi-page PDF.
The roadmap agreed with the user, in order:

1. ~~Print + multi-page PDF~~ — done
2. **Written instructions + yarn/stitch estimates** ← next
3. Fractal generator — Sierpinski and Rule 90, purely local, no AI needed
4. Repeat boxes → knit mode → image import → stitch symbols
5. AI assistant, last: it needs a key-holding proxy before it does anything, and
   step 3 delivers most of the generative value with none of that infrastructure

## Running it

```bash
npm install
npm run dev          # browser at localhost:5173
npm test             # vitest, 146 unit tests
npx tauri dev        # desktop app with hot reload
npx tauri build      # NSIS installer -> src-tauri/target/release/bundle/nsis/
```

The Rust toolchain is required for the Tauri commands (`rustup`, MSVC target).
First `tauri build` takes ~6 minutes; later builds are much faster.

## Layout

```
src/
  model/     types, RLE codec, .knitchart file <-> Chart, gauge math
  domain/    float checker, label conventions, region geometry, page tiling,
             yarn presets
  state/     Zustand store + undo/redo command stack
  editor/    Canvas render loop, tool geometry (line/rect/flood fill)
  components/ TopBar, Toolbar, PalettePanel, ChartSizePanel, WarningsPanel,
              NewChartDialog
  io/        save/open, PNG + SVG export, print-ready PDF
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

**Undo/redo has two command kinds.** `Command` is a tagged union:

- `cells` — per-cell diffs, used by every painting operation. A 300×300 snapshot
  would be 90 KB per step; a diff is a handful of entries. A drag coalesces into
  one command: `beginStroke()` → many `paintCell()` → `endStroke()`. If a cell is
  repainted within one stroke, the command keeps the *original* `before` so a
  single undo reverts the whole drag.
- `structure` — a full snapshot of grid + dimensions + palette, used by resize,
  crop, and palette delete/reorder. Those change the grid's *shape* or the
  *meaning* of its indices, which diffs cannot express. Snapshotting is fine
  precisely because structural edits are rare.

History is capped at 200 commands. `applyCells` merges repeated indices within
one command, keeping the first `before` and last `after` — undo replays diffs in
order, so two diffs for the same cell would otherwise restore the wrong value.
Moving a selection is the operation that can produce them.

**Palette ids are array indices, and cells store them directly.** Deleting or
reordering a color therefore has to renumber the whole grid, not just edit the
palette array — `deleteColor` builds a remap table and rewrites every cell, and
both operations emit a single `structure` command so palette and grid can never
undo apart. A palette change that undid without its grid remap would silently
recolor the chart; the store tests exist to catch exactly that.

**The view fits on `chartEpoch`, not on dimensions.** The canvas re-fits and
re-centres when a different chart arrives. Keying that on `stitches`/`rows` would
make the view jump on every click of a resize stepper, so the store bumps
`chartEpoch` only in `newChart`/`loadChart`; resizing deliberately leaves zoom
and scroll alone.

**Selection is a plain region, and all its operations are `cells` commands.**
`domain/region.ts` holds the pure geometry (extract, place with clipping, move,
mirror, rotate, fill), so move/copy/paste/flip all route through the existing
`applyCells` and need no new undo machinery. Moving clears the vacated stitches
to palette index 0, the documented background slot. Escape or a click outside
deselects — the first person to use the app assumed the float highlighting was a
selection and expected exactly that, so the real selection honors it.

**The PDF is the print path; there is no separate print stylesheet.** A browser
print of the canvas cannot tile a 100-stitch chart across sheets, so Ctrl+P opens
the PDF dialog instead. Keeping one layout engine means paper always matches
what the dialog promised.

Page geometry is deliberately identical on every page — fixed header, fixed
footer holding the key and gauge line, grid in between — so tiles line up and
any single page can be knitted from on its own. `domain/pageLayout.ts` holds the
pure tiling maths (`tileStarts` guarantees forward progress even if overlap is
set larger than a page, which would otherwise loop forever). Two drawing details
worth keeping: the built-in Helvetica is WinAnsi-only, so `safeText` replaces
glyphs it cannot encode and the ← → arrows are drawn as triangles rather than
text; and the overlap guide gets a white casing under its dashes, because a
plain red line vanishes over red or navy stitches.

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

- `npm test` — 189 unit tests. pdf-lib runs in Node, so the PDF export is tested
  directly: page counts against the built document, paper sizes, unencodable
  titles, and that the dialog's page estimate always matches what gets saved.
  The rest cover the pure functions: RLE encode/decode
  (round-trips, malformed input), gauge math, float checker (flat, in the round,
  wrap, thresholds, incremental vs full rescan), label conventions (row/stitch
  numbering, RS/WS, label thinning), yarn-weight presets, region geometry
  (resize per anchor, crop bounds, extract/place with clipping, overlapping
  moves, mirroring), and the store's stroke coalescing, undo/redo, resize undo,
  selection ops, and palette index remapping.
- Browser smoke test (not in the repo — it lives in the session scratchpad):
  drives the real app with puppeteer-core against Edge, checking drag-paint,
  undo/redo via keyboard, flood fill, eyedropper, rectangle, the square-grid
  toggle, round-wrap warnings, export bytes, a save→load round trip, and frame
  rate. It relies on `window.__knitStore` (from `src/state/store.ts`) and
  `window.__knitView.cellPoint(row, col)` (from `CanvasEditor`, which turns a
  stitch into a screen point using the editor's own view maths so the test can't
  drift from it). Both are exposed **only under `import.meta.env.DEV`**.
- `puppeteer.launch()` fails to hand off in this environment. Start Edge
  separately with `--remote-debugging-port=9333 --headless=new` and use
  `puppeteer.connect({ browserURL })`. Kill stray `msedge` processes between
  runs — but check `MainWindowTitle` first so you don't close a real browser.

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
