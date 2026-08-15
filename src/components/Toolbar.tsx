import { useStore, type Tool } from '../state/store';

const TOOLS: Array<{ id: Tool; label: string; icon: string; key: string }> = [
  { id: 'pencil', label: 'Pencil', icon: '✏️', key: 'B' },
  { id: 'fill', label: 'Flood fill', icon: '🪣', key: 'G' },
  { id: 'eyedropper', label: 'Eyedropper', icon: '💧', key: 'I' },
  { id: 'rect', label: 'Rectangle', icon: '▭', key: 'R' },
  { id: 'line', label: 'Line', icon: '╱', key: 'L' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
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
    </div>
  );
}
