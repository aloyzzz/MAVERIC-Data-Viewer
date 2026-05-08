import { C } from '../lib/colors';
import type { ColumnDef, Row, SortState } from '../types';
import { Cell, HeaderCell } from './Cell';

interface DataTableProps {
  rows: Row[];
  columns: ColumnDef[];
  selected: Row | null;
  onSelect: (row: Row) => void;
  sort: SortState | null;
  onSort: (colId: string) => void;
  highlightRow?: number;
  loading?: boolean;
}

export function DataTable({
  rows, columns, selected, onSelect, sort, onSort, highlightRow, loading,
}: DataTableProps) {
  const total = columns.reduce((a, c) => a + c.width, 0) + 60;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Sticky header */}
      <div style={{
        display: 'flex',
        backgroundColor: C.bgPanel,
        borderBottom: `1px solid ${C.borderStrong}`,
        position: 'sticky',
        top: 0,
        zIndex: 2,
        minWidth: total,
        flexShrink: 0,
      }}>
        <div style={{
          flex: '0 0 60px',
          fontSize: 10,
          fontFamily: C.fontMono,
          color: C.textDisabled,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingRight: 8,
          borderRight: `1px solid ${C.borderSubtle}`,
        }}>#</div>
        {columns.map((c) => (
          <HeaderCell key={c.id} col={c} sort={sort} onSort={onSort} />
        ))}
      </div>

      {/* Scrollable body */}
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ minWidth: total }}>
          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
              loading…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
              0 rows match filter
            </div>
          )}
          {rows.map((row) => {
            const sel = selected?.__idx === row.__idx;
            const flash = highlightRow === row.__idx;
            return (
              <div
                key={row.__idx}
                onClick={() => onSelect(row)}
                style={{
                  display: 'flex',
                  height: 24,
                  alignItems: 'center',
                  borderBottom: `1px solid ${C.borderSubtle}`,
                  borderLeft: `2px solid ${sel ? C.active : 'transparent'}`,
                  backgroundColor: sel ? C.bgPanelRaised : flash ? 'rgba(60,201,142,0.06)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background-color 80ms ease',
                }}
                onMouseEnter={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.025)'; }}
                onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.backgroundColor = flash ? 'rgba(60,201,142,0.06)' : 'transparent'; }}
              >
                <div style={{
                  flex: '0 0 60px',
                  padding: '0 8px',
                  textAlign: 'right',
                  fontFamily: C.fontMono,
                  fontSize: 10.5,
                  color: sel ? C.active : C.textDisabled,
                  borderRight: `1px solid ${C.borderSubtle}`,
                }}>
                  {(row.__idx + 1).toString().padStart(4, '0')}
                </div>
                {columns.map((c) => (
                  <Cell key={c.id} col={c} value={row[c.id]} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
