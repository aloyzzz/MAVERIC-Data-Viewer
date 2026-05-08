import { C, toneOf, toneColor, frameColor } from '../lib/colors';
import type { ColumnDef, Row, TableMeta } from '../types';
import { Sparkline } from './Sparkline';

interface DetailPaneProps {
  row: Row | null;
  columns: ColumnDef[];
  table: TableMeta;
  onClose: () => void;
  position?: 'right' | 'bottom';
}

const SPARKLINE_TABLES = new Set(['eps_battery', 'gnc_attitude', 'parameters_cache', 'event_parameter']);

function btnStyle(tone?: string) {
  const clr = tone ? toneColor(tone as Parameters<typeof toneColor>[0]) : C.textMuted;
  return {
    background: 'transparent',
    border: `1px solid ${tone ? clr + '33' : C.borderSubtle}`,
    color: clr,
    padding: '3px 8px',
    borderRadius: 3,
    fontSize: 10.5,
    fontFamily: C.fontMono,
    cursor: 'pointer',
  } as const;
}

export function DetailPane({ row, columns, table, onClose, position = 'right' }: DetailPaneProps) {
  const sizeStyle = position === 'right'
    ? { flex: '0 0 360px', borderLeft: `1px solid ${C.borderSubtle}` }
    : { flex: '0 0 240px', borderTop: `1px solid ${C.borderSubtle}` };

  if (!row) {
    return (
      <div style={{
        ...sizeStyle,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: C.bgPanel,
        color: C.textDisabled,
        fontFamily: C.fontMono,
        fontSize: 11,
        textAlign: 'center',
        padding: 20,
      }}>
        <div>
          <div style={{ marginBottom: 8, fontSize: 28, opacity: 0.3 }}>▦</div>
          <div>select a row to inspect</div>
          <div style={{ marginTop: 4, color: C.textDisabled, fontSize: 10 }}>click any row · Esc to deselect</div>
        </div>
      </div>
    );
  }

  const handleCopyJson = () => {
    const { __idx, ...data } = row;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  return (
    <div style={{
      ...sizeStyle,
      display: 'flex', flexDirection: 'column',
      backgroundColor: C.bgPanel,
      minHeight: 0,
      animation: 'detail-swap-anim 250ms cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${C.borderStrong}`,
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 9.5, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.active }}>
          row inspector
        </span>
        <span style={{ color: C.textDisabled, fontSize: 10 }}>·</span>
        <span style={{ fontSize: 11, color: C.textPrimary, fontFamily: C.fontMono }}>{table.label}</span>
        <span style={{ color: C.textDisabled, fontSize: 10 }}>·</span>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: C.fontMono }}>
          #{(row.__idx + 1).toString().padStart(4, '0')}
        </span>
        <button onClick={onClose} style={{
          marginLeft: 'auto', background: 'transparent', border: 0,
          color: C.textDisabled, cursor: 'pointer', fontSize: 14, padding: '0 4px',
        }}>×</button>
      </div>

      <div style={{ overflow: 'auto', flex: 1, fontFamily: C.fontMono, fontSize: 11 }}>
        {columns.map((col) => {
          const v = row[col.id];
          let valColor: string = C.textPrimary;
          const valText = v == null ? 'NULL' : String(v);
          if (v == null) valColor = C.textDisabled;
          if (col.type === 'tag' && v) valColor = toneColor(toneOf(String(v)));
          if (col.type === 'frame' && v) valColor = frameColor(String(v));
          if (col.type === 'bool') valColor = (v === 'True' || v === true || v === 1) ? C.success : C.danger;

          return (
            <div key={col.id} style={{
              display: 'flex',
              padding: '6px 12px',
              borderBottom: `1px solid ${C.borderSubtle}`,
              gap: 10,
              alignItems: 'baseline',
            }}>
              <div style={{ flex: '0 0 110px', color: C.textMuted, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col.label}
                {col.fk && <span style={{ marginLeft: 4, color: C.info, fontSize: 9 }}>FK</span>}
              </div>
              <div style={{ flex: 1, color: valColor, wordBreak: 'break-all', fontSize: 11 }}>
                {valText}
              </div>
              <div style={{ flex: '0 0 auto', color: C.textDisabled, fontSize: 9.5, textTransform: 'uppercase' }}>
                {col.type}
              </div>
            </div>
          );
        })}

        {SPARKLINE_TABLES.has(table.id) && (
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borderSubtle}` }}>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ◊ value · last 60 samples
            </div>
            <Sparkline seed={row.__idx} color={C.active} />
          </div>
        )}
      </div>

      <div style={{
        padding: '8px 12px',
        borderTop: `1px solid ${C.borderStrong}`,
        display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0,
      }}>
        <button onClick={handleCopyJson} style={btnStyle()}>Copy JSON</button>
        <button style={btnStyle('info')}>Open FK</button>
      </div>
    </div>
  );
}
