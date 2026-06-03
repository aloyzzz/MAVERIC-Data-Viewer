import { useState, useMemo, useEffect } from 'react';
import { C, toneColor } from '../lib/colors';
import type { AppSchema, Row, SortState, FilterChip } from '../types';
import { applyFilter, applySort, exportCsv } from '../lib/dataUtils';
import { useTableRows } from '../hooks/useApi';
import { FilterBar } from '../components/FilterBar';
import { DataTable } from '../components/DataTable';
import { DetailPane } from '../components/DetailPane';
import { Sparkline } from '../components/Sparkline';
import { CommandPalette } from '../components/CommandPalette';
import { CsvExportTab } from '../components/CsvExportTab';
import { Dashboard } from '../components/Dashboard';

const LIVE_STATS: Record<string, { rate: string; tone: 'success' | 'warning' | 'neutral' }> = {
  event_rx_packet:    { rate: '0.5/s', tone: 'success' },
  event_tx_command:   { rate: 'idle',  tone: 'neutral' },
  event_parameter:    { rate: '4.2/s', tone: 'success' },
  event_alarm:        { rate: '—',     tone: 'warning' },
  event_cmd_verifier: { rate: 'idle',  tone: 'neutral' },
  event_radio:        { rate: 'idle',  tone: 'neutral' },
  passes:             { rate: '—',     tone: 'neutral' },
};

interface StatProps {
  label: string;
  value: string;
  tone?: string;
  mono?: boolean;
}

function Stat({ label, value, tone, mono }: StatProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 9.5, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted }}>
        {label}
      </span>
      <span style={{
        fontSize: 12,
        fontFamily: mono ? C.fontMono : C.fontSans,
        color: tone ? toneColor(tone as Parameters<typeof toneColor>[0]) : C.textPrimary,
      }}>
        {value}
      </span>
    </div>
  );
}

interface VariationBProps {
  schema: AppSchema;
}

export function VariationB({ schema }: VariationBProps) {
  const [navTab, setNavTab] = useState('__dashboard__');
  const [openTabs, setOpenTabs] = useState(['event_rx_packet', 'event_parameter', 'passes', 'event_alarm']);
  const [activeId, setActiveId] = useState('event_rx_packet');
  const [selected, setSelected] = useState<Row | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterChip[]>([]);
  const [sort, setSort] = useState<SortState>({ col: 'ts_ms', dir: 'desc' });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showSchemaPicker, setShowSchemaPicker] = useState(false);

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
      if (e.key === 'Escape') { setPaletteOpen(false); setSelected(null); setShowSchemaPicker(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSort = (colId: string) => {
    setSort(sort.col === colId ? { col: colId, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: colId, dir: 'asc' });
  };

  const openTable = (id: string) => {
    if (!openTabs.includes(id)) setOpenTabs([...openTabs, id]);
    setActiveId(id);
    setShowSchemaPicker(false);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = openTabs.filter((t) => t !== id);
    setOpenTabs(next);
    if (activeId === id && next.length) setActiveId(next[0]);
  };

  const liveStats = LIVE_STATS[activeId] ?? { rate: 'idle', tone: 'neutral' as const };

  return (
    <>
      {/* Page-level tab strip */}
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 30, padding: '0 14px', flexShrink: 0,
        backgroundColor: 'rgba(8,8,8,0.8)',
        borderBottom: `1px solid ${C.borderSubtle}`,
        gap: 2,
      }}>
        {[
          { id: '__dashboard__', label: 'Dashboard' },
          { id: '__db__', label: 'Database' },
          { id: '__radio__', label: 'Radio' },
          { id: 'gnc', label: 'GNC' },
          { id: 'eps', label: 'EPS' },
          { id: '__export__', label: '↓ Export CSV' },
        ].map((t) => {
          const active = t.id === navTab;
          const isExport = t.id === '__export__';
          return (
            <div
              key={t.id}
              onClick={() => setNavTab(t.id)}
              style={{
                padding: '4px 10px', fontSize: 11.5,
                color: active ? (isExport ? C.active : C.textPrimary) : C.textMuted,
                backgroundColor: active ? C.bgPanelRaised : 'transparent',
                border: active ? `1px solid ${C.borderSubtle}` : '1px solid transparent',
                borderBottom: active ? `1px solid ${C.bgPanelRaised}` : '1px solid transparent',
                borderRadius: '3px 3px 0 0',
                cursor: 'pointer',
                marginLeft: isExport ? 'auto' : undefined,
                fontFamily: isExport ? C.fontMono : undefined,
              }}
            >
              {t.label}
            </div>
          );
        })}
      </div>

      {/* Dashboard tab */}
      {navTab === '__dashboard__' && <Dashboard schema={schema} onNavigate={(tab) => setNavTab(tab)} />}

      {/* Export tab */}
      {navTab === '__export__' && <CsvExportTab schema={schema} />}

      {/* Database body */}
      {navTab !== '__export__' && navTab !== '__dashboard__' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 12 }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 4, overflow: 'hidden',
          backgroundColor: C.bgPanel,
        }}>
          {/* Open-table tab strip */}
          <div style={{
            display: 'flex', alignItems: 'stretch',
            backgroundColor: C.bgApp,
            borderBottom: `1px solid ${C.borderStrong}`,
            position: 'relative',
            paddingLeft: 4,
            overflowX: 'auto',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setShowSchemaPicker(!showSchemaPicker)}
              style={{
                padding: '0 10px',
                background: showSchemaPicker ? C.bgPanelRaised : 'transparent',
                border: 0,
                borderRight: `1px solid ${C.borderSubtle}`,
                color: C.textMuted, cursor: 'pointer',
                fontFamily: C.fontMono, fontSize: 11,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ color: C.active }}>▦</span> tables
              <span style={{ fontSize: 9, color: C.textDisabled }}>▾</span>
            </button>

            {openTabs.map((id) => {
              const t = allTables.find((x) => x.id === id);
              if (!t) return null;
              const sel = id === activeId;
              return (
                <div
                  key={id}
                  onClick={() => setActiveId(id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 10px',
                    fontSize: 11.5, fontFamily: C.fontMono,
                    color: sel ? C.textPrimary : C.textMuted,
                    backgroundColor: sel ? C.bgPanel : 'transparent',
                    borderRight: `1px solid ${C.borderSubtle}`,
                    borderTop: sel ? `2px solid ${C.active}` : '2px solid transparent',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: sel ? C.active : C.textDisabled, fontSize: 10 }}>▦</span>
                  {t.label}
                  {sel && <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.success, marginLeft: 2 }} />}
                  <button
                    onClick={(e) => closeTab(id, e)}
                    style={{ background: 'transparent', border: 0, color: C.textDisabled, cursor: 'pointer', padding: '0 0 0 4px', fontSize: 12, lineHeight: 1 }}
                  >×</button>
                </div>
              );
            })}

            <button
              onClick={() => setShowSchemaPicker(true)}
              style={{ padding: '0 8px', background: 'transparent', border: 0, color: C.textDisabled, cursor: 'pointer', fontSize: 14, fontFamily: C.fontMono }}
            >+</button>

            {/* Schema picker dropdown */}
            {showSchemaPicker && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute', top: 30, left: 4, zIndex: 20,
                  width: 240, backgroundColor: C.bgPanel,
                  border: `1px solid ${C.borderStrong}`, borderRadius: 4,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                  maxHeight: 360, overflow: 'auto',
                }}
              >
                {schema.schemas.map((s) => (
                  <div key={s.name}>
                    <div style={{
                      padding: '5px 10px', fontSize: 9.5, fontFamily: C.fontMono,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: C.textMuted, backgroundColor: C.bgApp,
                      borderBottom: `1px solid ${C.borderSubtle}`,
                    }}>{s.name}</div>
                    {s.tables.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => openTable(t.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', fontSize: 11, fontFamily: C.fontMono,
                          color: C.textPrimary, cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanelRaised; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                      >
                        <span style={{ color: C.textDisabled, fontSize: 10 }}>▦</span>
                        {t.label}
                        <span style={{ marginLeft: 'auto', color: C.textDisabled, fontSize: 9.5 }}>
                          {t.rows > 9999 ? `${(t.rows / 1000).toFixed(0)}k` : t.rows}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Table info strip */}
          {table && (
            <div style={{
              padding: '6px 12px',
              borderBottom: `1px solid ${C.borderSubtle}`,
              display: 'flex', alignItems: 'center', gap: 16,
              backgroundColor: C.bgPanel, flexShrink: 0,
            }}>
              <Stat label="rows" value={table.rows.toLocaleString()} />
              <Stat label="ingest" value={liveStats.rate} tone={liveStats.tone} />
              <Stat label="primary" value={table.primary} mono />
              <Stat label="cols" value={String(columns.length)} />
              <span style={{ flex: 1, color: C.textMuted, fontSize: 11, fontFamily: C.fontMono, fontStyle: 'italic' }}>
                {table.desc}
              </span>
              <Sparkline seed={activeId.length} color={toneColor(liveStats.tone)} points={48} height={26} />
            </div>
          )}

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
            highlightRow={0}
            loading={loading}
          />

          {table && (
            <DetailPane
              row={selected}
              columns={columns}
              table={table}
              onClose={() => setSelected(null)}
              position="bottom"
            />
          )}

          {/* Status bar */}
          <div style={{
            padding: '4px 12px',
            borderTop: `1px solid ${C.borderStrong}`,
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: C.fontMono, fontSize: 10.5,
            color: C.textMuted, backgroundColor: C.bgApp, flexShrink: 0,
          }}>
            <span style={{ color: C.active }}>SELECT</span>
            <span>* FROM {table?.label}</span>
            {query && <><span style={{ color: C.active }}>WHERE</span><span>{query}</span></>}
            {sort.col && <><span style={{ color: C.active }}>ORDER BY</span><span>{sort.col} {sort.dir.toUpperCase()}</span></>}
            <span style={{ marginLeft: 'auto' }}>{sorted.length.toLocaleString()} rows · cached</span>
          </div>
        </div>
      </div>}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        schemas={schema.schemas}
        onPick={openTable}
      />
    </>
  );
}
