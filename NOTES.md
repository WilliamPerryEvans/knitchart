# KnitChart — build notes

A desktop knitting chart maker for Windows. React + TypeScript + Vite frontend,
Canvas 2D chart rendering, Zustand state, wrapped with Tauri v2.

Background research lives in `../Custom Knitter Technical Build Guide.md`, which
lays out a ten-phase roadmap; what is built so far is listed below, and the rest
is deliberately deferred — see "Deliberately not built".

## Where to pick up

Editor, printing, pattern output, and the pattern generator are done: painting,
selection, resize, palette management, float checking, PNG/SVG export,
print-ready multi-page PDF, written instructions, yarn estimates, and fractal /
repeat generation. The roadmap agreed with the user:

1. ~~Print + multi-page PDF~~ — done
2. ~~Written instructions + yarn/stitch estimates~~ — done
3. ~~Fractal generator (Sierpinski, Rule 90)~~ — done
4. **Repeat boxes → knit mode → image import → stitch symbols** ← next
5. AI assistant, last: it needs a key-holding proxy before it does anything, and
   step 3 delivered most of the generative value with none of that infrastructure

## Running it

```bash
npm install
npm run dev          # browser at localhost:5173
npm test             # vitest, 322 unit tests
npx tauri dev        # desktop app with hot reload
npm run install-app  # build, then update the installed desktop app
npx tauri build      # NSIS installer -> src-tauri/target/release/bundle/nsis/
```

The Rust toolchain is required for the Tauri commands (`rustup`, MSVC target).
First `tauri build` takes ~6 minutes; later builds are much faster.

**Updating the desktop app: use `npm run install-app`, not the installer.** The
install is a single `app.exe` next to `uninstall.exe` in
`%LOCALAPPDATA%\KnitChart`, so `scripts/install-local.mjs` just copies the fresh
build over it and the existing desktop shortcut picks it up. Running the NSIS
installer means clicking past an unsigned-publisher SmartScreen warning and a
wizard every single time, for the same result. `Update KnitChart.cmd` in the
repo root does the same thing from Explorer for anyone not at a terminal. Both
stop with a plain message if the app is open, because Windows locks a running
`.exe` and the copy would otherwise fail with a permissions error.

The NSIS installer is still the right thing for a *first* install on a machine,
or for giving the app to somebody else — it is what creates the Start menu entry
and the uninstaller.

## Layout

```
src/
  model/     types, RLE codec, .knitchart file <-> Chart, gauge math
  domain/    float checker, label conventions, region geometry, page tiling,
             written instructions, yarn estimates, yarn presets, generators
  state/     Zustand store + undo/redo command stack
  editor/    Canvas render loop, tool geometry (line/rect/flood fill)
  components/ TopBar, Toolbar, PalettePanel, ChartSizePanel, WarningsPanel,
              NewChartDialog, PdfDialog, PatternDialog, GenerateDialog
  io/        save/open, PNG + SVG export, print-ready PDF + pattern pages
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
mirror, rotate, fill), so move/copy/paste/flip/turn all route through the
existing `applyCells` and need no new undo machinery. Moving clears the vacated
stitches to palette index 0, the documented background slot. Escape, a click
inside the grid but outside the marquee, or a click off the grid entirely all
deselect — the first person to use the app assumed the float highlighting was a
selection and expected exactly that, so the real selection honors it.

**Rotation snaps to right angles, deliberately.** Any other angle has to
resample the grid, and half a stitch does not exist: the edges come out ragged
and the chart stops being knittable. The drag grip off the selection's top-right
corner measures the pointer's angle about the selection centre and rounds to the
nearest quarter turn, so free dragging still feels natural; ↻ / ↺ buttons in the
selection bar do the same thing precisely. `rotateRegionCells` follows
`moveRegionCells` — clear the old footprint, stamp the turned copy centred on
the same point, dedupe through a `Map` — and `rotatedPlacement` nudges the
result back onto the chart when a turned oblong would hang off an edge.

**Paste has two modes.** 'replace' overwrites everything under the clipboard;
'over' treats palette index 0 as see-through so a motif can be laid on top of
existing stitches. `placeRegion` takes an optional `transparent` index and omits
those cells from the changes it returns — leaving it undefined keeps the
replace behaviour that moving and mirroring depend on. The choice is sticky in
the store so Ctrl+V keeps doing whatever was picked last.

**The palette swatch opens the colour picker, so picking a colour to paint with
needs its own button.** Each row starts with a small round `.palette-pick`; the
row itself still works, but the most obvious target used to be the one that did
something else.

**The PDF is the print path; there is no separate print stylesheet.** A browser
print of the canvas cannot tile a 100-stitch chart across sheets, so Ctrl+P opens
the PDF dialog instead. Keeping one layout engine means paper always matches
what the dialog promised.

**It fits on one page by default**, and the dialog says what that cost
("One page. Stitches print at 3.0 mm.") because squeezing a big chart onto letter
can leave stitches too small to follow — under 2 mm it suggests a fixed size
across taped pages instead. Fixing the default exposed a bug in `'fit'` that had
been there since it was written: gutters are sized from the cell and the cell is
sized from what the gutters leave, so fitting once produced bigger cells, bigger
labels, and a chart that no longer fit — silently splitting in two.
`fittedCellWidth` iterates to a fixed point (gutters grow with the cell, the fit
shrinks with the gutters, so it settles downward), shaves a hair off for
floating point, and caps at 10 mm so a one-stitch chart doesn't print a square
the size of the sheet.

Page geometry is deliberately identical on every page — fixed header, fixed
footer holding the key and gauge line, grid in between — so tiles line up and
any single page can be knitted from on its own. `domain/pageLayout.ts` holds the
pure tiling maths (`tileStarts` guarantees forward progress even if overlap is
set larger than a page, which would otherwise loop forever). Two drawing details
worth keeping: the built-in Helvetica is WinAnsi-only, so `safeText` replaces
glyphs it cannot encode and the ← → arrows are drawn as triangles rather than
text; and the overlap guide gets a white casing under its dashes, because a
plain red line vanishes over red or navy stitches.

**Reading direction is the thing to get right in written instructions.** Row 1
is the bottom of the chart. A RS row is worked right-to-left across the chart and
knitted; a WS row is worked left-to-right and purled; every round is worked
right-to-left and knitted. `workingOrder` reverses the row for RS, so the text
starts where the knitter starts — reading a row the wrong way produces a mirrored
garment. Repeats collapse only when a period of 2 or more saves a full cycle; a
period of 1 means every row is identical, and "Rows 1–8: k2 MC" reads better than
"Row 1: … / Rows 2–8: repeat row 1".

**The yarn estimate counts floats, not just stitches.** A colour is carried
behind the work whenever it is in play but not being knitted, so a sparse
contrast colour can need far more yarn than its stitch count suggests — in the
Sierpinski test chart CC1 knits 585 stitches but carries 1,179. Worked flat a
colour is carried only between its first and last use in a row; in the round the
yarn travels the full circumference. Absent from a row, it is not carried at all.
The per-stitch figure is a rule of thumb (~3x stitch width) with a stated margin,
so the UI calls it an estimate rather than a shopping list.

**The pattern generators are one engine with named front doors.** A Sierpinski
triangle *is* elementary rule 90 seeded with a single stitch and plain edges, so
`domain/generators.ts` implements the automaton once and exposes "Sierpinski
triangle" as a preset — knitters look for it by name, not by rule number. Every
generator produces a binary grid at pattern-cell resolution, which is then blown
up by the stitch/row scale, centre-cropped to the target, and mapped onto two
palette indices. The same function feeds the dialog preview, the chart, and the
tests, so what you see previewed is exactly what lands on the chart.

Three knitting-specific decisions inside it:

- **Wrap defaults to the chart's direction.** Knitting in the round makes a row
  a cylinder, so the automaton should carry on across the join rather than
  stopping dead at the edges. Flat knitting gets plain edges.
- **"Match my gauge" scales rows, not stitches.** Stitches are wider than they
  are tall, so a fractal charted one-cell-per-stitch knits up squashed;
  `gaugeRowScale` returns `round(scaleX * rowsPer4in / stsPer4in)` — worsted
  needs 5 rows per 4 stitches. The preview is drawn at gauge aspect too, so a
  squashed motif looks squashed on screen rather than surprising you off the
  needles.
- **A burnt-out automaton re-seeds.** Rule 90 with plain edges dies to nothing
  whenever the width is one less than a power of two — and 60 stitches at 4
  stitches per cell gives exactly 15, so it is easy to hit by accident and
  leaves half the chart bare. `restart` sows the seed again when a generation
  comes out empty, turning it into a repeating motif; a checkbox turns it off.

Generating emits a single `structure` command rather than up to 90,000 cell
diffs, and `replaceGrid` restores the selection afterwards because the size
hasn't changed — you may well want to mirror what you just generated. With a
selection active the generator fills only that region, so a motif can be dropped
into a panel without disturbing the rest of the chart.

The Sierpinski carpet tiles *in phase*: `tileOffset` centres a whole number of
motifs on the chart, so a 54-stitch chart gets two intact 27-stitch carpets
rather than a repeat sliced at an arbitrary column.

**The equilateral triangle is geometric, not cellular, and equilateral in the
fabric.** Rule 90 grows one column per side per row, which on worsted knits up
as a wide flat wedge — right maths, wrong shape for a garment panel. The
`'equilateral'` generator instead works in units of one cell width (a cell being
`1` wide and `aspect` tall), fits the largest true equilateral triangle inside
the chart's real proportions, and tests points against the gasket with
`inGasket` — barycentric coordinates, halved into whichever corner sub-triangle
the point falls in, or rejected if it lands in the central inverted one.
Measured on a 60×78 worsted chart the result is 12.0 in across and 10.3 in
tall: a ratio of 0.859 against the ideal 0.866, the difference being whole
stitches. On the chart *squares* it reads 1.12, which is the point — a triangle
that looks equilateral on graph paper does not knit up equilateral.

**Rasterising it needs coverage AND the apexes, not stitch centres.** The first
version tested each stitch's centre point, and the motif came out in
disconnected pieces with entirely blank rows across the joins — at 40×40 depth 1
the top triangle floated free of the two beneath it. A gasket pinches to a
*single point* wherever two sub-triangles meet, and no stitch centre lands in a
point. Two things fix it, and both are needed:

- Fill a stitch by how much of it the shape covers (4×4 samples, threshold 0.3),
  not by its centre. That gives solid edges and stops small triangles
  disappearing.
- Mark the stitch containing each sub-triangle's apex outright
  (`gasketApexes`, the same subdivision that builds the shape). Coverage alone
  is not enough: when a tip lands exactly on a stitch boundary its coverage
  splits between the two neighbours and neither passes the threshold — which is
  what still severed the 60×78 chart after the coverage change went in.

`smallestTriangle` reports what a depth actually costs in stitches, and the
dialog shows it — depth 3 on a 40-stitch chart leaves the smallest triangle only
4 sts × 5 rows, and under 3 it says so plainly instead of drawing mush.

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
for new/loaded charts and palette hex changes).

**`dirtyCells` accumulates; the canvas drains it.** It used to be replaced on
every mutation, which quietly lost repaints: React can coalesce several grid
edits into one render, and the canvas reads the list once per render, so only
the last edit's cells reached the screen. Six `paintCell` calls in one task left
five stitches painted in the store but invisible on the chart. `addDirty` now
appends (and keeps `null`, since a pending full rebuild already covers
everything), and the canvas effect empties the list after consuming it — which
is also what keeps it from growing without bound. A browser check confirms it
stays at one stroke's worth while painting a 300-wide chart. Two stacked canvases: the base
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

- `npm test` — 322 unit tests. pdf-lib runs in Node, so the PDF export is tested
  directly: page counts against the built document, paper sizes, unencodable
  titles, and that the dialog's page estimate always matches what gets saved.
  The rest cover the pure functions: RLE encode/decode
  (round-trips, malformed input), gauge math, float checker (flat, in the round,
  wrap, thresholds, incremental vs full rescan), label conventions (row/stitch
  numbering, RS/WS, label thinning), yarn-weight presets, region geometry
  (resize per anchor, crop bounds, extract/place with clipping, overlapping
  moves, mirroring, quarter turns, see-through placement), the pattern generators
  (rule-table decoding, rule 90 checked against binomial coefficients mod 2, wrap
  vs plain edges, re-seeding, carpet recursion and tiling phase, the equilateral
  gasket measured against the gauge, scaling, gauge row scale), and the store's
  stroke coalescing, undo/redo, resize undo, selection ops, paste modes, rotation,
  dirty-cell accumulation, and palette index remapping. The automaton tests inject
  the random source so a "random seed" run is reproducible.
- Browser smoke test (not in the repo — it lives in the session scratchpad):
  drives the real app with puppeteer-core against Edge, checking drag-paint,
  undo/redo via keyboard, flood fill, eyedropper, rectangle, the square-grid
  toggle, round-wrap warnings, export bytes, a save→load round trip, and frame
  rate. It relies on `window.__knitStore` (from `src/state/store.ts`) and
  `window.__knitView.cellPoint(row, col)` (from `CanvasEditor`, which turns a
  stitch into a screen point using the editor's own view maths so the test can't
  drift from it), plus `__knitView.rotateGrip()` for the same reason — guessing
  at the grip's position from a cell centre put the drag inside the selection and
  moved it instead. All are exposed **only under `import.meta.env.DEV`**.
- `puppeteer.launch()` fails to hand off in this environment. Start Edge
  separately with `--remote-debugging-port=9333 --headless=new` and use
  `puppeteer.connect({ browserURL })`. Kill stray `msedge` processes between
  runs — but check `MainWindowTitle` first so you don't close a real browser.

## Deliberately not built

Repeat boxes, image import, stitch symbols, knit-mode progress tracking, and AI
features are still out. The data model has room for them: `symbolLayer` and
`repeats` are already in the file format.

## Gotchas

- `saveBytes`/`saveChart` detect Tauri via `window.__TAURI_INTERNALS__` and fall
  back to browser download / file picker, so the app stays fully usable under
  `npm run dev` without the desktop shell.
- Tauri file access needs both the plugin registered in `src-tauri/src/lib.rs`
  and the permission listed in `src-tauri/capabilities/default.json`. Missing
  the capability entry fails at runtime, not at build time.
- The bundle target is `nsis` only. `"targets": "all"` also attempts an MSI via
  WiX, which is a slower extra download for no benefit here.
