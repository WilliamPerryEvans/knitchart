import { useEffect, useState } from 'react';
import { CanvasEditor } from './editor/CanvasEditor';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { PalettePanel } from './components/PalettePanel';
import { WarningsPanel } from './components/WarningsPanel';
import { NewChartDialog } from './components/NewChartDialog';
import { ChartSizePanel } from './components/ChartSizePanel';
import { PdfDialog } from './components/PdfDialog';
import { useStore } from './state/store';
import { openChart, saveChart } from './io/file';
import './App.css';

export default function App() {
  const [showNew, setShowNew] = useState(false);
  const [showPdf, setShowPdf] = useState(false);

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
      <TopBar onNewChart={() => setShowNew(true)} onPrint={() => setShowPdf(true)} />
      <div className="main">
        <Toolbar />
        <CanvasEditor />
        <div className="sidebar">
          <PalettePanel />
          <ChartSizePanel />
          <WarningsPanel />
        </div>
      </div>
      {showNew && <NewChartDialog onClose={() => setShowNew(false)} />}
      {showPdf && <PdfDialog onClose={() => setShowPdf(false)} />}
    </div>
  );
}
