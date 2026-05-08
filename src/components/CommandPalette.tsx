import { useState, useEffect, useRef } from 'react';
import { C } from '../lib/colors';
import type { SchemaGroup } from '../types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  schemas: SchemaGroup[];
  onPick: (id: string) => void;
}

export function CommandPalette({ open, onClose, schemas, onPick }: CommandPaletteProps) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;

  const items = schemas.flatMap((s) => s.tables.map((t) => ({ ...t, schema: s.name })));
  const filtered = items.filter(
    (t) => !q || t.label.toLowerCase().includes(q.toLowerCase()) || t.schema.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12%',
        backgroundColor: 'rgba(8,8,8,0.85)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          backgroundColor: C.bgPanel,
          border: `1px solid ${C.borderStrong}`,
          borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borderSubtle}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.active, fontFamily: C.fontMono, fontSize: 12 }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="jump to table…"
            style={{
              flex: 1, background: 'transparent', border: 0, outline: 'none',
              color: C.textPrimary, fontSize: 13, fontFamily: C.fontMono,
            }}
          />
          <kbd style={{
            backgroundColor: C.bgPanelRaised, border: `1px solid ${C.borderSubtle}`,
            color: C.textMuted, padding: '1px 5px', borderRadius: 3, fontSize: 10, fontFamily: C.fontMono,
          }}>Esc</kbd>
        </div>

        <div style={{ maxHeight: 320, overflow: 'auto', padding: 4 }}>
          {filtered.slice(0, 12).map((t) => (
            <div
              key={t.id}
              onClick={() => { onPick(t.id); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 10px', borderRadius: 3,
                cursor: 'pointer', fontFamily: C.fontMono, fontSize: 12,
                color: C.textPrimary,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanelRaised; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              <span style={{ color: C.textDisabled, fontSize: 10 }}>▦</span>
              <span style={{ color: C.textMuted, fontSize: 10 }}>{t.schema}.</span>
              <span>{t.label}</span>
              <span style={{ marginLeft: 'auto', color: C.textDisabled, fontSize: 10 }}>
                {t.rows.toLocaleString()} rows
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 16, color: C.textDisabled, fontSize: 11, fontFamily: C.fontMono, textAlign: 'center' }}>
              no matching tables
            </div>
          )}
        </div>

        <div style={{
          padding: '6px 10px', borderTop: `1px solid ${C.borderSubtle}`,
          display: 'flex', gap: 12, fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled,
        }}>
          <span>↵ open</span>
          <span>Esc close</span>
          <span style={{ marginLeft: 'auto' }}>{filtered.length} results</span>
        </div>
      </div>
    </div>
  );
}
