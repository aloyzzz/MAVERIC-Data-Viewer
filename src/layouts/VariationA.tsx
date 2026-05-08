import { useState, useMemo, useEffect } from 'react';
import { C } from '../lib/colors';
import type { AppSchema, Row, SortState, FilterChip } from '../types';
import { applyFilter, applySort, exportCsv } from '../lib/dataUtils';
import { useTableRows } from '../hooks/useApi';
import { SchemaSidebar } from '../components/SchemaSidebar';
import { FilterBar } from '../components/FilterBar';
import { DataTable } from '../components/DataTable';
import { DetailPane } from '../components/DetailPane';
import { CommandPalette } from '../components/CommandPalette';

const NAV_TABS = [
  { id: '__dashboard__', label: 'Dashboard' },
  { id: '__db__', label: 'Database', active: true },
  { id: '__radio__', label: 'Radio' },
  { id: 'gnc', label: 'GNC' },
  { id: 'eps', label: 'EPS' },
];

interface VariationAProps {
  schema: AppSchema;
}

export function VariationA({ schema }: VariationAProps) {
  const [activeId, setActiveId] = useState('event_parameter');
  const [selected, setSelected] = useState<Row | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterChip[]>([]);
  const [sort, setSort] = useState<SortState>({ col: 'ts_ms', dir: 'desc' });
  const [sidebarFilter, setSidebarFilter] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { rows: allRows, loading } = useTableRows(activeId);
  const columns = schema.columns[activeId] ?? [];
  const allTables = schema.schemas.flatMap((s) => s.tables);
  const table = allTables.find((t) => t.id === activeId) ?? allTables[0];

  const filtered = useMemo(() => applyFilter(allRows, query), [allRows, query]);
  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);

  useEffect(() => { setSelected(null); }, [activeId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === 'Escape') { setPaletteOpen(false); setSelected(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSort = (colId: string) => {
    setSort(sort.col === colId ? { col: colId, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: colId, dir: 'asc' });
  };

  return (
    <>
      {/* Navigation tab strip */}
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 30, padding: '0 14px', flexShrink: 0,
        backgroundColor: 'rgba(8,8,8,0.8)',
        borderBottom: `1px solid ${C.borderSubtle}`,
        gap: 2,
      }}>
        {NAV_TABS.map((t) => (
          <div key={t.id} style={{
            padding: '4px 10px', fontSize: 11.5,
            color: t.active ? C.textPrimary : C.textMuted,
            backgroundColor: t.active ? C.bgPanelRaised : 'transparent',
            border: t.active ? `1px solid ${C.borderSubtle}` : '1px solid transparent',
            borderBottom: t.active ? `1px solid ${C.bgPanelRaised}` : '1px solid transparent',
            borderRadius: '3px 3px 0 0',
            cursor: 'default',
          }}>{t.label}</div>
        ))}
      </div>

      {/* 3-pane area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: 12 }}>
        <div style={{
          display: 'flex', flex: 1, minHeight: 0,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 4, overflow: 'hidden',
          backgroundColor: C.bgPanel,
        }}>
          <SchemaSidebar
            schemas={schema.schemas}
            activeId={activeId}
            onPick={setActiveId}
            sidebarFilter={sidebarFilter}
            setSidebarFilter={setSidebarFilter}
          />

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            {/* Table title bar */}
            <div style={{
              padding: '6px 12px',
              borderBottom: `1px solid ${C.borderStrong}`,
              display: 'flex', alignItems: 'center', gap: 10,
              backgroundColor: C.bgPanel, flexShrink: 0,
            }}>
              <span style={{ fontSize: 9.5, fontFamily: C.fontMono, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted }}>
                table
              </span>
              <span style={{ fontSize: 13, fontFamily: C.fontMono, color: C.textPrimary }}>{table?.label}</span>
              <span style={{ fontSize: 11, color: C.textMuted, fontFamily: C.fontMono }}>{table?.desc}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 3,
                  backgroundColor: C.activeFill, color: C.active,
                  fontSize: 10, fontFamily: C.fontMono,
                  border: `1px solid ${C.active}33`,
                }}>● live tail</span>
                <span style={{
                  padding: '1px 6px', borderRadius: 3,
                  backgroundColor: C.bgPanelRaised, color: C.textMuted,
                  fontSize: 10, fontFamily: C.fontMono,
                  border: `1px solid ${C.borderSubtle}`,
                }}>{columns.length} cols</span>
              </span>
            </div>

            {table && (
              <FilterBar
                table={table}
                columns={columns}
                filter={filter}
                setFilter={setFilter}
                query={query}
                setQuery={setQuery}
                rowCount={sorted.length}
                totalCount={table.rows}
                onExport={() => exportCsv(sorted, columns, `${activeId}.csv`)}
              />
            )}

            <DataTable
              rows={sorted}
              columns={columns}
              selected={selected}
              onSelect={(r) => setSelected(selected?.__idx === r.__idx ? null : r)}
              sort={sort}
              onSort={onSort}
              loading={loading}
            />

            {/* Status bar */}
            <div style={{
              padding: '4px 12px',
              borderTop: `1px solid ${C.borderSubtle}`,
              display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: C.fontMono, fontSize: 10.5,
              color: C.textMuted, backgroundColor: C.bgApp, flexShrink: 0,
            }}>
              <span>SELECT * FROM {table?.label}</span>
              {query && <span style={{ color: C.active }}>WHERE {query}</span>}
              {sort.col && <span>ORDER BY {sort.col} {sort.dir.toUpperCase()}</span>}
              <span style={{ marginLeft: 'auto' }}>{sorted.length.toLocaleString()} rows</span>
            </div>
          </div>

          {table && (
            <DetailPane
              row={selected}
              columns={columns}
              table={table}
              onClose={() => setSelected(null)}
              position="right"
            />
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        schemas={schema.schemas}
        onPick={setActiveId}
      />
    </>
  );
}
