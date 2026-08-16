import { useEffect, useState } from 'react';
import { CanvasEditor } from './editor/CanvasEditor';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { PalettePanel } from './components/PalettePanel';
import { WarningsPanel } from './components/WarningsPanel';
import { NewChartDialog } from './components/NewChartDialog';
import { ChartSizePanel } from './components/ChartSizePanel';
import { PdfDialog } from './components/PdfDialog';
import { PatternDialog } from './components/PatternDialog';
import { GenerateDialog } from './components/GenerateDialog';
import { LibraryDialog } from './components/LibraryDialog';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useStore } from './state/store';
import { useAutosave } from './state/autosave';
import { openChart, saveChart } from './io/file';
import './App.css';

export default function App() {
  const [showNew, setShowNew] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [showPattern, setShowPattern] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const { restored, dismissRestored } = useAutosave();
  // Phone-only view state. On a desktop the CSS ignores both, so the layout is
  // exactly what it has always been.
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelsOpen, setPanelsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      const s = useStore.getState();

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) s.redo();
            else s.undo();
            return;
          case 'y':
            e.preventDefault();
            s.redo();
            return;
          case 's':
            e.preventDefault();
            saveChart(s.chart, s.filePath, e.shiftKey).then((path) => {
              if (path) s.setFilePath(path);
              s.markSaved();
            });
            return;
          case 'o':
            e.preventDefault();
            openChart().then((r) => {
              if (r) useStore.getState().loadChart(r.chart, r.path);
            });
            return;
          case 'n':
            e.preventDefault();
            setShowNew(true);
            return;
          case 'p':
            // Our PDF lays the chart out properly across pages; the browser's
            // print of the canvas would not.
            e.preventDefault();
            setShowPdf(true);
            return;
          case 'g':
            e.preventDefault();
            setShowGenerate(true);
            return;
          case 'c':
            if (s.selection) {
              e.preventDefault();
              s.copySelection();
            }
            return;
          case 'v':
            if (s.clipboard) {
              e.preventDefault();
              s.pasteClipboard();
            }
            return;
        }
        return;
      }
      if (typing) return;

      if (e.key === 'Escape') {
        s.clearSelection();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        e.preventDefault();
        s.fillSelection(0); // clear back to the background color
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'b':
          s.setTool('pencil');
          break;
        case 'g':
          s.setTool('fill');
          break;
        case 'i':
          s.setTool('eyedropper');
          break;
        case 'r':
          s.setTool('rect');
          break;
        case 'l':
          s.setTool('line');
          break;
        case 'm':
          s.setTool('select');
          break;
        case '[': {
          const n = s.chart.palette.length;
          s.setActiveColor((s.activeColor - 1 + n) % n);
          break;
        }
        case ']': {
          const n = s.chart.palette.length;
          s.setActiveColor((s.activeColor + 1) % n);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar
        onNewChart={() => setShowNew(true)}
        onPrint={() => setShowPdf(true)}
        onPattern={() => setShowPattern(true)}
        onGenerate={() => setShowGenerate(true)}
        onLibrary={() => setShowLibrary(true)}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
      />
      <UpdatePrompt />
      {restored && (
        <div className="restore-note" role="status">
          <span>Picked up where you left off.</span>
          <button onClick={() => setShowLibrary(true)}>Save it to my charts</button>
          <button className="restore-dismiss" aria-label="Dismiss" onClick={dismissRestored}>
            ✕
          </button>
        </div>
      )}
      <div className="main">
        <Toolbar />
        <CanvasEditor />
        <div className={panelsOpen ? 'sidebar open' : 'sidebar'}>
          {/* Only rendered as a control on a phone, where the sidebar becomes a
              bottom sheet; `display: none` on wider screens. */}
          <button
            className="sheet-handle"
            aria-expanded={panelsOpen}
            onClick={() => setPanelsOpen((o) => !o)}
          >
            <span className="sheet-grip" />
            <span className="sheet-label">Colours · Size · Floats</span>
            <span className="sheet-chevron">{panelsOpen ? '▾' : '▴'}</span>
          </button>
          <PalettePanel />
          <ChartSizePanel />
          <WarningsPanel />
        </div>
      </div>
      {showNew && <NewChartDialog onClose={() => setShowNew(false)} />}
      {showPdf && <PdfDialog onClose={() => setShowPdf(false)} />}
      {showPattern && <PatternDialog onClose={() => setShowPattern(false)} />}
      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
      {showLibrary && <LibraryDialog onClose={() => setShowLibrary(false)} />}
    </div>
  );
}
