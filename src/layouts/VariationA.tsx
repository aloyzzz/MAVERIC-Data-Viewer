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
import { CsvExportTab } from '../components/CsvExportTab';
import { Dashboard } from '../components/Dashboard';
import { IngestPage } from '../components/IngestPage';
import { ColumnFilterPanel } from '../components/ColumnFilterPanel';
import { DecodedFramesTab, TelemetryTab, FilesTab } from '../components/DecodedFramesTab';
import { HistoryTab } from '../components/LiveTab';
import { BeaconEntryTab } from '../components/BeaconEntryTab';

const NAV_TABS = [
  { id: '__dashboard__', label: 'Dashboard' },
  { id: '__db__', label: 'Database' },
  { id: '__live__', label: 'History' },
  { id: '__ingest__', label: 'Ingest' },
];

interface VariationAProps {
  schema: AppSchema;
  onSchemaRefresh?: () => void;
}

export function VariationA({ schema, onSchemaRefresh }: VariationAProps) {
  const allTables = schema.schemas.flatMap((s) => s.tables);

  const [navTab, setNavTab] = useState('__dashboard__');
  const [activeId, setActiveId] = useState(() => {
    // Default to the first pass event table, falling back to the first table in schema
    const passGroup = schema.schemas.find((s) => s.name === 'passes');
    return passGroup?.tables[0]?.id ?? allTables[0]?.id ?? '';
  });
  const [selected, setSelected] = useState<Row | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterChip[]>([]);
  const [sort, setSort] = useState<SortState>({ col: 'ts_ms', dir: 'desc' });
  const [sidebarFilter, setSidebarFilter] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dbSubTab, setDbSubTab] = useState<'data' | 'columns' | 'frames' | 'telemetry' | 'files' | 'export'>('data');
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(1000);
  const [ingestSubTab, setIngestSubTab] = useState<'file' | 'beacon'>('file');

  const { rows: allRows, loading } = useTableRows(activeId, limit);

  // Use the resolved table (with fallback) so columns always matches what's displayed
  const table = allTables.find((t) => t.id === activeId) ?? allTables[0];
  const columns = schema.columns[table?.id ?? activeId] ?? [];

  const filtered = useMemo(() => applyFilter(allRows, query), [allRows, query]);
  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);
  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.id)),
    [columns, hiddenColumns],
  );

  useEffect(() => {
    setSelected(null);
    setQuery('');
    setHiddenColumns(new Set());
    // Reset sort to ts_ms for pass event tables; use primary key for others
    if (/^pass_\d+$/.test(activeId)) {
      setSort({ col: 'ts_ms', dir: 'desc' });
    } else {
      const t = allTables.find((t) => t.id === activeId);
      setSort({ col: t?.primary ?? 'id', dir: 'asc' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

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
        {NAV_TABS.map((t) => {
          const active = t.id === navTab;
          const isIngest = t.id === '__ingest__';
          return (
            <div
              key={t.id}
              onClick={() => setNavTab(t.id)}
              style={{
                padding: '4px 10px', fontSize: 11.5,
                color: active
                  ? (isIngest ? C.info : C.textPrimary)
                  : C.textMuted,
                backgroundColor: active ? C.bgPanelRaised : 'transparent',
                border: active ? `1px solid ${C.borderSubtle}` : '1px solid transparent',
                borderBottom: active ? `1px solid ${C.bgPanelRaised}` : '1px solid transparent',
                borderRadius: '3px 3px 0 0',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </div>
          );
        })}
      </div>

      {/* Dashboard tab */}
      {navTab === '__dashboard__' && <Dashboard schema={schema} onNavigate={(tab) => setNavTab(tab)} />}

      {/* History tab */}
      {navTab === '__live__' && <HistoryTab />}

      {/* Ingest tab (file import + beacon entry) */}
      {navTab === '__ingest__' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            height: 28, padding: '0 10px',
            borderBottom: `1px solid ${C.borderSubtle}`,
            backgroundColor: C.bgApp,
            gap: 2, flexShrink: 0,
          }}>
            {(['file', 'beacon'] as const).map((sub) => {
              const active = ingestSubTab === sub;
              return (
                <div
                  key={sub}
                  onClick={() => setIngestSubTab(sub)}
                  style={{
                    padding: '3px 10px', fontSize: 11,
                    fontFamily: C.fontMono,
                    color: active ? C.textPrimary : C.textMuted,
                    backgroundColor: active ? C.bgPanelRaised : 'transparent',
                    border: active ? `1px solid ${C.borderSubtle}` : '1px solid transparent',
                    borderBottom: active ? `1px solid ${C.bgPanelRaised}` : '1px solid transparent',
                    borderRadius: '3px 3px 0 0',
                    cursor: 'pointer',
                  }}
                >
                  {sub === 'file' ? 'File Import' : 'Beacon Entry'}
                </div>
              );
            })}
          </div>
          {ingestSubTab === 'file' && <IngestPage onIngestComplete={onSchemaRefresh} />}
          {ingestSubTab === 'beacon' && <BeaconEntryTab schema={schema} />}
        </div>
      )}

      {/* 3-pane area */}
      {navTab !== '__dashboard__' && navTab !== '__ingest__' && navTab !== '__live__' && (
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
                  }}>{visibleColumns.length}{hiddenColumns.size > 0 ? `/${columns.length}` : ''} cols</span>
                </span>
              </div>

              {/* Database sub-tab strip */}
              <div style={{
                display: 'flex', alignItems: 'center',
                height: 28, padding: '0 10px',
                borderBottom: `1px solid ${C.borderSubtle}`,
                backgroundColor: C.bgApp,
                gap: 2, flexShrink: 0,
              }}>
                {(['data', 'frames', 'files', 'telemetry', 'export', 'columns'] as const).map((tab) => {
                  const active = dbSubTab === tab;
                  return (
                    <div
                      key={tab}
                      onClick={() => setDbSubTab(tab)}
                      style={{
                        padding: '3px 10px',
                        fontSize: 11,
                        fontFamily: C.fontMono,
                        color: active ? C.textPrimary : C.textMuted,
                        backgroundColor: active ? C.bgPanelRaised : 'transparent',
                        border: active ? `1px solid ${C.borderSubtle}` : '1px solid transparent',
                        borderBottom: active ? `1px solid ${C.bgPanelRaised}` : '1px solid transparent',
                        borderRadius: '3px 3px 0 0',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      {tab === 'columns' && hiddenColumns.size > 0 && (
                        <span style={{
                          display: 'inline-block', width: 5, height: 5,
                          borderRadius: '50%', backgroundColor: C.active,
                        }} />
                      )}
                      {tab}
                    </div>
                  );
                })}
              </div>

              {dbSubTab === 'columns' && (
                <ColumnFilterPanel
                  columns={columns}
                  hiddenColumns={hiddenColumns}
                  setHiddenColumns={setHiddenColumns}
                />
              )}

              {dbSubTab === 'frames' && (
                <DecodedFramesTab tableId={activeId} />
              )}

              {dbSubTab === 'files' && (
                <FilesTab tableId={activeId} />
              )}

              {dbSubTab === 'telemetry' && (
                <TelemetryTab tableId={activeId} sourceFile={table?.sourceFile} />
              )}

              {dbSubTab === 'export' && (
                <CsvExportTab schema={schema} embedded />
              )}

              {dbSubTab === 'data' && table && (
                <FilterBar
                  table={table}
                  columns={visibleColumns}
                  filter={filter}
                  setFilter={setFilter}
                  query={query}
                  setQuery={setQuery}
                  rowCount={sorted.length}
                  totalCount={table.rows}
                  limit={limit}
                  setLimit={setLimit}
                  onExport={() => exportCsv(sorted, visibleColumns, `${activeId}.csv`)}
                />
              )}

              {(dbSubTab === 'data') && (
                <DataTable
                  rows={sorted}
                  columns={visibleColumns}
                  selected={selected}
                  onSelect={(r) => setSelected(selected?.__idx === r.__idx ? null : r)}
                  sort={sort}
                  onSort={onSort}
                  loading={loading}
                />
              )}

              {/* Status bar — hidden on frames/files/telemetry/export/columns tabs */}
              {dbSubTab !== 'frames' && dbSubTab !== 'files' && dbSubTab !== 'telemetry' && dbSubTab !== 'export' && dbSubTab !== 'columns' && (
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
              )}
            </div>

            {table && dbSubTab === 'data' && (
              <DetailPane
                row={selected}
                columns={columns}
                table={table}
                onClose={() => setSelected(null)}
                onPassDeleted={() => window.location.reload()}
                position="right"
              />
            )}
          </div>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        schemas={schema.schemas}
        onPick={setActiveId}
      />
    </>
  );
}
