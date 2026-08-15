import { useEffect, useState } from 'react';
import { CanvasEditor } from './editor/CanvasEditor';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { PalettePanel } from './components/PalettePanel';
import { WarningsPanel } from './components/WarningsPanel';
import { NewChartDialog } from './components/NewChartDialog';
import { useStore } from './state/store';
import { openChart, saveChart } from './io/file';
import './App.css';

export default function App() {
  const [showNew, setShowNew] = useState(false);

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
        }
        return;
      }
      if (typing) return;

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
      <TopBar onNewChart={() => setShowNew(true)} />
      <div className="main">
        <Toolbar />
        <CanvasEditor />
        <div className="sidebar">
          <PalettePanel />
          <WarningsPanel />
        </div>
      </div>
      {showNew && <NewChartDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}
