import { C } from '../lib/colors';
import type { ColumnDef, FilterChip, TableMeta } from '../types';

interface FilterBarProps {
  table: TableMeta;
  columns: ColumnDef[];
  filter: FilterChip[];
  setFilter: (f: FilterChip[]) => void;
  query: string;
  setQuery: (q: string) => void;
  rowCount: number;
  totalCount: number;
  onExport: () => void;
}

export function FilterBar({
  table, filter, setFilter, query, setQuery, rowCount, totalCount, onExport,
}: FilterBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      borderBottom: `1px solid ${C.borderSubtle}`,
      backgroundColor: C.bgApp,
      fontSize: 11,
      fontFamily: C.fontMono,
      flexWrap: 'wrap',
      flexShrink: 0,
    }}>
      <span style={{ color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>
        FROM
      </span>
      <span style={{ color: C.active, fontWeight: 500 }}>{table.label}</span>
      <span style={{ color: C.textDisabled }}>·</span>
      <span style={{ color: C.textMuted }}>WHERE</span>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: C.bgPanelRaised,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 3,
        padding: '0 6px',
        flex: '1 1 280px',
      }}>
        <span style={{ color: C.textDisabled, marginRight: 6 }}>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter rows…  e.g.  ts_ms > 1000  •  name:callsign  •  outcome=SUCCESS"
          style={{
            flex: 1,
            background: 'transparent',
            border: 0,
            outline: 'none',
            color: C.textPrimary,
            fontFamily: C.fontMono,
            fontSize: 11,
            padding: '4px 0',
            minWidth: 60,
          }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={{ background: 'transparent', border: 0, color: C.textDisabled, cursor: 'pointer', fontSize: 11, padding: '0 4px' }}
          >×</button>
        )}
      </div>

      {filter.map((f, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 6px', borderRadius: 3,
          backgroundColor: C.activeFill, border: `1px solid ${C.active}33`,
          color: C.active, fontSize: 10.5,
        }}>
          {f.col} {f.op} {f.val}
          <button
            onClick={() => setFilter(filter.filter((_, j) => j !== i))}
            style={{ background: 'none', border: 0, color: C.active, cursor: 'pointer', padding: 0, marginLeft: 2 }}
          >×</button>
        </span>
      ))}

      <span style={{ marginLeft: 'auto', color: C.textMuted }}>
        <span style={{ color: C.textPrimary }}>{rowCount.toLocaleString()}</span>
        <span style={{ color: C.textDisabled }}> / {totalCount.toLocaleString()} rows</span>
      </span>
      <button
        onClick={onExport}
        style={{
          background: 'transparent', border: `1px solid ${C.borderSubtle}`,
          color: C.textMuted, padding: '2px 8px', borderRadius: 3,
          fontSize: 11, fontFamily: C.fontMono, cursor: 'pointer',
        }}
      >↓ csv</button>
    </div>
  );
}
