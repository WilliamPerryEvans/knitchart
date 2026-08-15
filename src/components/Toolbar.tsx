import { useStore, type Tool } from '../state/store';
import type { MirrorAxis } from '../domain/region';

const TOOLS: Array<{ id: Tool; label: string; icon: string; key: string }> = [
  { id: 'pencil', label: 'Pencil', icon: '✏️', key: 'B' },
  { id: 'fill', label: 'Flood fill', icon: '🪣', key: 'G' },
  { id: 'eyedropper', label: 'Eyedropper', icon: '💧', key: 'I' },
  { id: 'rect', label: 'Rectangle', icon: '▭', key: 'R' },
  { id: 'line', label: 'Line', icon: '╱', key: 'L' },
  { id: 'select', label: 'Select', icon: '⬚', key: 'M' },
];

const MIRRORS: Array<{ id: MirrorAxis; label: string; icon: string }> = [
  { id: 'none', label: 'No mirroring', icon: '·' },
  { id: 'vertical', label: 'Mirror left ↔ right', icon: '⇔' },
  { id: 'horizontal', label: 'Mirror top ↕ bottom', icon: '⇕' },
  { id: 'both', label: 'Mirror both ways', icon: '✛' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const mirrorAxis = useStore((s) => s.mirrorAxis);

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={tool === t.id ? 'tool active' : 'tool'}
          title={`${t.label} (${t.key})`}
          onClick={() => useStore.getState().setTool(t.id)}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-key">{t.key}</span>
        </button>
      ))}

      <div className="toolbar-divider" />
      <div className="toolbar-caption" title="Paint the mirror image at the same time">
        Mirror
      </div>
      {MIRRORS.map((m) => (
        <button
          key={m.id}
          className={mirrorAxis === m.id ? 'tool mirror active' : 'tool mirror'}
          title={m.label}
          onClick={() => useStore.getState().setMirrorAxis(m.id)}
        >
          <span className="tool-icon">{m.icon}</span>
        </button>
      ))}
    </div>
  );
}
