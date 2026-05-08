import { C } from '../lib/colors';

const DEFAULT_HINTS = [
  { k: 'Ctrl+K', d: 'Search' },
  { k: '/', d: 'Filter' },
  { k: 'Esc', d: 'Deselect' },
  { k: 'A / B', d: 'Layout' },
  { k: '↓ csv', d: 'Export' },
];

interface HintBarProps {
  items?: { k: string; d: string }[];
}

export function HintBar({ items = DEFAULT_HINTS }: HintBarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 18, height: 24, padding: '0 14px', flexShrink: 0,
      borderTop: `1px solid ${C.borderSubtle}`,
      backgroundColor: C.bgApp,
    }}>
      {items.map((h) => (
        <span key={h.k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
          <kbd style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 16, minWidth: 16, padding: '0 4px',
            backgroundColor: C.bgPanelRaised,
            border: `1px solid ${C.borderSubtle}`,
            borderRadius: 3,
            fontFamily: C.fontMono, fontSize: 10,
            color: C.textSecondary,
          }}>{h.k}</kbd>
          <span style={{ color: C.textMuted, fontSize: 10.5 }}>{h.d}</span>
        </span>
      ))}
    </div>
  );
}
