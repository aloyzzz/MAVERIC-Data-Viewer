import type { CSSProperties } from 'react';
import { C, toneOf, toneColor, toneFill, frameColor } from '../lib/colors';
import type { ColumnDef } from '../types';

interface CellProps {
  col: ColumnDef;
  value: unknown;
}

export function Cell({ col, value }: CellProps) {
  const base: CSSProperties = {
    flex: `0 0 ${col.width}px`,
    width: col.width,
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
    fontFamily: col.mono ? C.fontMono : C.fontSans,
    fontSize: 12,
    color: C.textPrimary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  if (value === null || value === undefined || value === '') {
    return <div style={{ ...base, color: C.textDisabled }}>—</div>;
  }

  if (col.type === 'tag') {
    const tone = toneOf(String(value));
    return (
      <div style={base}>
        <span style={{
          fontSize: 10.5, letterSpacing: '0.04em',
          padding: '2px 6px', borderRadius: 3,
          color: toneColor(tone), backgroundColor: toneFill(tone),
          border: `1px solid ${toneColor(tone)}33`,
          fontFamily: C.fontMono, textTransform: 'uppercase',
        }}>
          {String(value)}
        </span>
      </div>
    );
  }

  if (col.type === 'frame') {
    return <div style={{ ...base, color: frameColor(String(value)) }}>{String(value)}</div>;
  }

  if (col.type === 'bool') {
    const ok = value === 'True' || value === true || value === 'true' || value === 1;
    const clr = ok ? C.success : C.danger;
    const fill = ok ? C.successFill : C.dangerFill;
    return (
      <div style={base}>
        <span style={{
          fontSize: 10.5, padding: '1px 6px', borderRadius: 3,
          color: clr, backgroundColor: fill,
          border: `1px solid ${clr}33`, fontFamily: C.fontMono,
        }}>
          {ok ? 'true' : 'false'}
        </span>
      </div>
    );
  }

  if (col.type === 'float') {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    const s = isNaN(n) ? String(value) : (Math.abs(n) > 100 ? n.toFixed(2) : n.toFixed(4));
    return <div style={base}>{s}</div>;
  }

  if (col.type === 'int') {
    return <div style={base}>{Number(value).toLocaleString()}</div>;
  }

  if (col.type === 'time') {
    return <div style={{ ...base, color: C.textSecondary, fontFamily: C.fontMono }}>{String(value)}</div>;
  }

  return <div style={base}>{String(value)}</div>;
}

interface HeaderCellProps {
  col: ColumnDef;
  sort: { col: string; dir: 'asc' | 'desc' } | null;
  onSort: (colId: string) => void;
}

export function HeaderCell({ col, sort, onSort }: HeaderCellProps) {
  const dir = sort?.col === col.id ? sort.dir : null;
  return (
    <div
      onClick={() => onSort(col.id)}
      style={{
        flex: `0 0 ${col.width}px`,
        width: col.width,
        padding: '0 10px',
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
        cursor: 'pointer',
        gap: 6,
        userSelect: 'none',
        fontSize: 11,
        fontFamily: C.fontMono,
        color: dir ? C.active : C.textMuted,
        textTransform: 'lowercase',
        letterSpacing: '0.02em',
        borderRight: `1px solid ${C.borderSubtle}`,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
      {col.fk && <span style={{ color: C.info, fontSize: 9, opacity: 0.8 }}>FK</span>}
      <span style={{ marginLeft: 'auto', opacity: dir ? 1 : 0.25, fontSize: 9 }}>
        {dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '◆'}
      </span>
    </div>
  );
}
