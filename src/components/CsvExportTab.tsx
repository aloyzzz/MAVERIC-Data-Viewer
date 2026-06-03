import { useState, useMemo, CSSProperties } from 'react';
import { C } from '../lib/colors';
import type { AppSchema, Row } from '../types';
import { applyFilter, exportCsv } from '../lib/dataUtils';
import { useTableRows } from '../hooks/useApi';

/* ─── tiny shared styles ─────────────────────────────────────────────────── */

const inputStyle: CSSProperties = {
  width: '100%', padding: '5px 8px', fontSize: 11,
  fontFamily: C.fontMono, color: C.textPrimary,
  backgroundColor: C.bgApp, border: `1px solid ${C.borderStrong}`,
  borderRadius: 3, outline: 'none', boxSizing: 'border-box',
};

const smallBtnStyle: CSSProperties = {
  padding: '3px 8px', fontSize: 10, fontFamily: C.fontMono,
  color: C.textMuted, backgroundColor: C.bgApp,
  border: `1px solid ${C.borderSubtle}`, borderRadius: 3, cursor: 'pointer',
};

/* ─── helpers ────────────────────────────────────────────────────────────── */

function estimateSize(rows: number, cols: number): string {
  const bytes = rows * cols * 12; // rough estimate
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchAndExportTable(
  tableId: string,
  columns: { id: string }[],
) {
  const res = await fetch(`/api/tables/${tableId}`);
  const data: Record<string, unknown>[] = await res.json();
  const rows: Row[] = data.map((r, i) => ({ ...r, __idx: i }));
  exportCsv(rows, columns, `${tableId}.csv`);
}

/* ─── sub-components ─────────────────────────────────────────────────────── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      padding: '6px 12px', fontSize: 9.5, fontFamily: C.fontMono,
      letterSpacing: '0.1em', textTransform: 'uppercase',
      color: C.textDisabled, backgroundColor: C.bgApp,
      borderBottom: `1px solid ${C.borderSubtle}`,
      borderTop: `1px solid ${C.borderSubtle}`,
      flexShrink: 0,
    }}>
      {label}
    </div>
  );
}

function ConfigSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flexShrink: 0 }}>
      <SectionHeader label={label} />
      <div style={{ padding: '10px 12px' }}>{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled,
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
    }}>
      {children}
    </div>
  );
}

function StatPill({
  label, value, highlight,
}: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
      <span style={{ fontSize: 9.5, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textDisabled }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontFamily: C.fontMono, color: highlight ? C.active : C.textPrimary }}>
        {value}
      </span>
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────────────── */

interface CsvExportTabProps {
  schema: AppSchema;
}

export function CsvExportTab({ schema }: CsvExportTabProps) {
  const allTables = schema.schemas.flatMap((s) => s.tables);

  /* table selection */
  const [selectedTableId, setSelectedTableId] = useState('event_parameter');

  /* batch mode */
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  /* column selection */
  const [colSelection, setColSelection] = useState<Map<string, Set<string>>>(new Map());

  /* filters */
  const [tsFrom, setTsFrom] = useState('');
  const [tsTo, setTsTo]     = useState('');
  const [textFilter, setTextFilter]       = useState('');
  const [paramFilter, setParamFilter]     = useState('');
  const [passIdFrom, setPassIdFrom]       = useState('');
  const [passIdTo, setPassIdTo]           = useState('');

  /* fetch rows for selected table */
  const { rows: allRows, loading } = useTableRows(selectedTableId);
  const columns  = schema.columns[selectedTableId] ?? [];
  const table    = allTables.find((t) => t.id === selectedTableId) ?? allTables[0];

  /* ensure column selection is initialised for this table */
  const colSet: Set<string> = useMemo(() => {
    if (!colSelection.has(selectedTableId)) {
      const s = new Set(columns.map((c) => c.id));
      setColSelection((prev) => new Map(prev).set(selectedTableId, s));
      return s;
    }
    return colSelection.get(selectedTableId)!;
  }, [selectedTableId, columns, colSelection]);

  const hasTsMs      = columns.some((c) => c.id === 'ts_ms');
  const hasPassId    = columns.some((c) => c.id === 'pass_id');
  const isParamTable = selectedTableId === 'event_parameter';

  /* pass id range available in this table */
  const passIdRange = useMemo(() => {
    if (!hasPassId || loading || allRows.length === 0) return null;
    let lo = Infinity, hi = -Infinity;
    allRows.forEach((r) => {
      const v = Number(r['pass_id']);
      if (!isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    });
    if (!isFinite(lo)) return null;
    return { lo, hi };
  }, [allRows, hasPassId, loading]);

  /* unique parameter names */
  const paramNames = useMemo(() => {
    if (!isParamTable || loading) return [];
    const s = new Set<string>();
    allRows.forEach((r) => { if (r['name']) s.add(String(r['name'])); });
    return Array.from(s).sort();
  }, [allRows, isParamTable, loading]);

  /* filtered rows */
  const filtered: Row[] = useMemo(() => {
    let rows = allRows;

    if (hasTsMs && tsFrom) {
      const from = new Date(tsFrom).getTime();
      rows = rows.filter((r) => Number(r['ts_ms']) >= from);
    }
    if (hasTsMs && tsTo) {
      const to = new Date(tsTo).getTime();
      rows = rows.filter((r) => Number(r['ts_ms']) <= to);
    }
    if (hasPassId && passIdFrom.trim()) {
      const lo = Number(passIdFrom.trim());
      if (!isNaN(lo)) rows = rows.filter((r) => Number(r['pass_id']) >= lo);
    }
    if (hasPassId && passIdTo.trim()) {
      const hi = Number(passIdTo.trim());
      if (!isNaN(hi)) rows = rows.filter((r) => Number(r['pass_id']) <= hi);
    }
    if (isParamTable && paramFilter.trim()) {
      const lc = paramFilter.toLowerCase();
      rows = rows.filter((r) => String(r['name'] ?? '').toLowerCase().includes(lc));
    }
    if (textFilter.trim()) {
      rows = applyFilter(rows, textFilter);
    }
    return rows;
  }, [allRows, hasTsMs, tsFrom, tsTo, hasPassId, passIdFrom, passIdTo, isParamTable, paramFilter, textFilter]);

  const activeColumns = columns.filter((c) => colSet.has(c.id));
  const preview       = filtered.slice(0, 10);

  /* handlers */
  const toggleCol = (id: string) => {
    const next = new Set(colSet);
    next.has(id) ? next.delete(id) : next.add(id);
    setColSelection((prev) => new Map(prev).set(selectedTableId, next));
  };

  const pickTable = (id: string) => {
    setSelectedTableId(id);
    setTsFrom(''); setTsTo('');
    setTextFilter(''); setParamFilter('');
    setPassIdFrom(''); setPassIdTo('');
  };

  const handleDownload = () => {
    exportCsv(filtered, activeColumns, `${selectedTableId}_export.csv`);
  };

  const handleBatchDownload = async () => {
    setBatchLoading(true);
    for (const tid of Array.from(batchSelected)) {
      const cols = schema.columns[tid] ?? [];
      await fetchAndExportTable(tid, cols);
      await new Promise((r) => setTimeout(r, 300)); // slight stagger
    }
    setBatchLoading(false);
  };

  const toggleBatch = (id: string) => {
    const next = new Set(batchSelected);
    next.has(id) ? next.delete(id) : next.add(id);
    setBatchSelected(next);
  };

  /* ── render ──────────────────────────────────────────────────────────────*/
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 12 }}>
      <div style={{
        flex: 1, display: 'flex', minHeight: 0,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 4, overflow: 'hidden',
        backgroundColor: C.bgPanel,
      }}>

        {/* ── LEFT SIDEBAR ─────────────────────────────────────────────── */}
        <div style={{
          width: 220, flexShrink: 0,
          borderRight: `1px solid ${C.borderSubtle}`,
          display: 'flex', flexDirection: 'column',
          backgroundColor: C.bgApp,
        }}>
          {/* mode toggle */}
          <div style={{
            padding: '8px 12px', borderBottom: `1px solid ${C.borderSubtle}`,
            display: 'flex', gap: 4,
          }}>
            {(['single', 'batch'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setBatchMode(m === 'batch')}
                style={{
                  flex: 1, padding: '4px 0', fontSize: 10.5, fontFamily: C.fontMono,
                  backgroundColor: (m === 'batch') === batchMode ? C.activeFill : C.bgPanelRaised,
                  color: (m === 'batch') === batchMode ? C.active : C.textMuted,
                  border: `1px solid ${(m === 'batch') === batchMode ? C.active + '55' : C.borderSubtle}`,
                  borderRadius: 3, cursor: 'pointer',
                }}
              >
                {m}
              </button>
            ))}
          </div>

          {/* table list */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {schema.schemas.map((sg) => (
              <div key={sg.name}>
                <div style={{
                  padding: '5px 12px', fontSize: 9, fontFamily: C.fontMono,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: C.textDisabled,
                  borderBottom: `1px solid ${C.borderSubtle}`,
                }}>
                  {sg.name}
                </div>

                {sg.tables.map((t) => {
                  const sel  = !batchMode && t.id === selectedTableId;
                  const bsel = batchMode && batchSelected.has(t.id);
                  return (
                    <div
                      key={t.id}
                      onClick={() => batchMode ? toggleBatch(t.id) : pickTable(t.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px',
                        backgroundColor: sel || bsel ? C.bgPanelRaised : 'transparent',
                        borderLeft: sel ? `2px solid ${C.active}` : bsel ? `2px solid ${C.info}` : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => { if (!sel && !bsel) (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanel; }}
                      onMouseLeave={(e) => { if (!sel && !bsel) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                    >
                      {batchMode && (
                        <input
                          type="checkbox"
                          checked={bsel}
                          onChange={() => toggleBatch(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: C.info, flexShrink: 0 }}
                        />
                      )}
                      {!batchMode && (
                        <span style={{ fontSize: 9, color: sel ? C.active : C.textDisabled }}>▦</span>
                      )}
                      <span style={{
                        flex: 1, fontSize: 11, fontFamily: C.fontMono,
                        color: sel || bsel ? C.textPrimary : C.textMuted,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {t.label}
                      </span>
                      <span style={{ fontSize: 9.5, color: C.textDisabled, fontFamily: C.fontMono, flexShrink: 0 }}>
                        {t.rows > 9999 ? `${(t.rows / 1000).toFixed(1)}k` : t.rows}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* batch download button */}
          {batchMode && (
            <div style={{ borderTop: `1px solid ${C.borderSubtle}`, padding: 10 }}>
              <div style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, marginBottom: 6 }}>
                {batchSelected.size} table{batchSelected.size !== 1 ? 's' : ''} selected
              </div>
              <button
                onClick={handleBatchDownload}
                disabled={batchSelected.size === 0 || batchLoading}
                style={{
                  width: '100%', padding: '6px 0', fontSize: 11,
                  fontFamily: C.fontMono,
                  backgroundColor: batchSelected.size > 0 && !batchLoading ? C.info : C.bgPanelRaised,
                  color: batchSelected.size > 0 && !batchLoading ? C.bgApp : C.textDisabled,
                  border: 'none', borderRadius: 3,
                  cursor: batchSelected.size > 0 && !batchLoading ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}
              >
                {batchLoading ? 'downloading…' : `↓ download all`}
              </button>
              <div style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, marginTop: 5, lineHeight: 1.5 }}>
                one CSV per table,<br />all columns, no filters
              </div>
            </div>
          )}
        </div>

        {/* ── MAIN PANEL ───────────────────────────────────────────────── */}
        {!batchMode && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

            {/* title bar */}
            <div style={{
              padding: '6px 16px', borderBottom: `1px solid ${C.borderStrong}`,
              display: 'flex', alignItems: 'center', gap: 10,
              backgroundColor: C.bgPanel, flexShrink: 0,
            }}>
              <span style={{ fontSize: 9.5, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted }}>export</span>
              <span style={{ fontSize: 13, fontFamily: C.fontMono, color: C.textPrimary }}>{table?.label}</span>
              <span style={{ fontSize: 11, color: C.textMuted, fontFamily: C.fontMono, fontStyle: 'italic' }}>{table?.desc}</span>
              {loading && (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: C.active, fontFamily: C.fontMono }}>
                  ⟳ loading…
                </span>
              )}
            </div>

            {/* inner split */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

              {/* ── config column ── */}
              <div style={{
                width: 280, flexShrink: 0,
                borderRight: `1px solid ${C.borderSubtle}`,
                display: 'flex', flexDirection: 'column',
                overflow: 'auto',
              }}>

                {/* TIME RANGE */}
                {hasTsMs && (
                  <ConfigSection label="time range filter">
                    <FieldLabel>from (local time)</FieldLabel>
                    <input
                      type="datetime-local"
                      value={tsFrom}
                      onChange={(e) => setTsFrom(e.target.value)}
                      style={inputStyle}
                    />
                    <div style={{ height: 6 }} />
                    <FieldLabel>to (local time)</FieldLabel>
                    <input
                      type="datetime-local"
                      value={tsTo}
                      onChange={(e) => setTsTo(e.target.value)}
                      style={inputStyle}
                    />
                    {(tsFrom || tsTo) && (
                      <button
                        onClick={() => { setTsFrom(''); setTsTo(''); }}
                        style={{ ...smallBtnStyle, marginTop: 6, width: '100%' }}
                      >
                        ✕ clear range
                      </button>
                    )}
                  </ConfigSection>
                )}

                {/* PARAMETER NAME FILTER */}
                {isParamTable && (
                  <ConfigSection label="parameter name filter">
                    <FieldLabel>name contains</FieldLabel>
                    <input
                      type="text"
                      placeholder="temperature, voltage, …"
                      value={paramFilter}
                      onChange={(e) => setParamFilter(e.target.value)}
                      style={inputStyle}
                    />
                    {paramNames.length > 0 && (
                      <>
                        <div style={{ height: 8 }} />
                        <FieldLabel>
                          {paramFilter
                            ? `matches (${paramNames.filter((n) => n.toLowerCase().includes(paramFilter.toLowerCase())).length})`
                            : `all parameters (${paramNames.length})`}
                        </FieldLabel>
                        <div style={{
                          marginTop: 4, maxHeight: 140, overflow: 'auto',
                          border: `1px solid ${C.borderSubtle}`, borderRadius: 3,
                          backgroundColor: C.bgApp,
                        }}>
                          {paramNames
                            .filter((n) => !paramFilter || n.toLowerCase().includes(paramFilter.toLowerCase()))
                            .map((n) => (
                              <div
                                key={n}
                                onClick={() => setParamFilter(n)}
                                style={{
                                  padding: '3px 8px', fontSize: 10.5, fontFamily: C.fontMono,
                                  color: paramFilter === n ? C.active : C.textSecondary,
                                  cursor: 'pointer', borderBottom: `1px solid ${C.borderSubtle}`,
                                  backgroundColor: paramFilter === n ? C.activeFill : 'transparent',
                                }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanelRaised; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = paramFilter === n ? C.activeFill : 'transparent'; }}
                              >
                                {n}
                              </div>
                            ))}
                        </div>
                      </>
                    )}
                  </ConfigSection>
                )}

                {/* PASS ID RANGE FILTER */}
                {hasPassId && (
                  <ConfigSection label="pass id range">
                    <FieldLabel>from pass id</FieldLabel>
                    <input
                      type="number"
                      placeholder="min pass id"
                      value={passIdFrom}
                      onChange={(e) => setPassIdFrom(e.target.value)}
                      style={inputStyle}
                    />
                    <div style={{ height: 6 }} />
                    <FieldLabel>to pass id</FieldLabel>
                    <input
                      type="number"
                      placeholder="max pass id"
                      value={passIdTo}
                      onChange={(e) => setPassIdTo(e.target.value)}
                      style={inputStyle}
                    />
                    {passIdRange && (
                      <div style={{
                        marginTop: 6, padding: '4px 8px',
                        backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`,
                        borderRadius: 3, fontSize: 9.5, fontFamily: C.fontMono,
                        color: C.textDisabled, lineHeight: 1.6,
                      }}>
                        available&nbsp;
                        <span style={{ color: C.active }}>{passIdRange.lo}</span>
                        {passIdRange.lo !== passIdRange.hi && (
                          <> – <span style={{ color: C.active }}>{passIdRange.hi}</span></>
                        )}
                        {' '}({passIdRange.hi - passIdRange.lo + 1} pass{passIdRange.hi - passIdRange.lo + 1 !== 1 ? 'es' : ''})
                      </div>
                    )}
                    {(passIdFrom || passIdTo) && (
                      <button
                        onClick={() => { setPassIdFrom(''); setPassIdTo(''); }}
                        style={{ ...smallBtnStyle, marginTop: 6, width: '100%' }}
                      >
                        ✕ clear range
                      </button>
                    )}
                  </ConfigSection>
                )}

                {/* ROW FILTER */}
                <ConfigSection label="row filter">
                  <FieldLabel>query expression</FieldLabel>
                  <input
                    type="text"
                    placeholder="col:substr  col=exact  col>n"
                    value={textFilter}
                    onChange={(e) => setTextFilter(e.target.value)}
                    style={inputStyle}
                  />
                  <div style={{
                    marginTop: 6, padding: '5px 8px',
                    backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`, borderRadius: 3,
                    fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, lineHeight: 1.7,
                  }}>
                    <span style={{ color: C.active }}>col:val</span> substring ·{' '}
                    <span style={{ color: C.active }}>col=val</span> exact ·{' '}
                    <span style={{ color: C.active }}>col!=val</span> exclude{'\n'}
                    <span style={{ color: C.active }}>col&gt;n</span> ·{' '}
                    <span style={{ color: C.active }}>col&lt;n</span> numeric ·{' '}
                    freetext → all cols
                  </div>
                </ConfigSection>

                {/* COLUMN SELECTION */}
                <ConfigSection
                  label={`columns — ${colSet.size} / ${columns.length} selected`}
                >
                  <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                    <button
                      onClick={() => setColSelection((p) => new Map(p).set(selectedTableId, new Set(columns.map((c) => c.id))))}
                      style={smallBtnStyle}
                    >
                      select all
                    </button>
                    <button
                      onClick={() => setColSelection((p) => new Map(p).set(selectedTableId, new Set()))}
                      style={smallBtnStyle}
                    >
                      clear all
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {columns.map((col) => {
                      const checked = colSet.has(col.id);
                      return (
                        <label
                          key={col.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '3px 6px', borderRadius: 3, cursor: 'pointer',
                            backgroundColor: checked ? C.bgPanelRaised : 'transparent',
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanelRaised; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = checked ? C.bgPanelRaised : 'transparent'; }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCol(col.id)}
                            style={{ accentColor: C.active, flexShrink: 0 }}
                          />
                          <span style={{
                            flex: 1, fontSize: 11, fontFamily: C.fontMono,
                            color: checked ? C.textPrimary : C.textMuted,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {col.id}
                          </span>
                          <span style={{
                            fontSize: 8.5, fontFamily: C.fontMono, padding: '1px 4px',
                            borderRadius: 2, backgroundColor: C.bgApp, color: C.textDisabled,
                            border: `1px solid ${C.borderSubtle}`, flexShrink: 0,
                          }}>
                            {col.type}
                          </span>
                          {col.pk !== null && (
                            <span style={{ fontSize: 8.5, color: C.warning, fontFamily: C.fontMono }}>pk</span>
                          )}
                          {col.fk && (
                            <span style={{ fontSize: 8.5, color: C.info, fontFamily: C.fontMono }}>fk</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </ConfigSection>
              </div>

              {/* ── preview + download ── */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

                {/* stats strip */}
                <div style={{
                  padding: '7px 16px', borderBottom: `1px solid ${C.borderSubtle}`,
                  display: 'flex', alignItems: 'center', gap: 20,
                  backgroundColor: C.bgApp, flexShrink: 0, flexWrap: 'wrap',
                }}>
                  <StatPill label="matched rows" value={filtered.length.toLocaleString()} highlight />
                  <StatPill label="total rows" value={(table?.rows ?? 0).toLocaleString()} />
                  <StatPill label="columns" value={`${colSet.size} / ${columns.length}`} />
                  <StatPill label="est. file size" value={estimateSize(filtered.length, colSet.size)} />
                  {(tsFrom || tsTo || textFilter || paramFilter || passIdFrom || passIdTo) && (
                    <span style={{
                      fontSize: 9.5, fontFamily: C.fontMono, color: C.warning,
                      padding: '2px 7px', borderRadius: 3,
                      backgroundColor: C.warningFill, border: `1px solid ${C.warning}33`,
                    }}>
                      filters active
                    </span>
                  )}
                </div>

                {/* preview table */}
                <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
                  <div style={{
                    fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled,
                    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span>preview — first {preview.length} of {filtered.length.toLocaleString()} rows</span>
                    {activeColumns.length === 0 && (
                      <span style={{ color: C.warning }}>select at least one column</span>
                    )}
                  </div>

                  {loading ? (
                    <div style={{
                      padding: 24, textAlign: 'center',
                      color: C.textDisabled, fontFamily: C.fontMono, fontSize: 11,
                    }}>
                      loading {table?.label}…
                    </div>
                  ) : filtered.length === 0 ? (
                    <div style={{
                      padding: 24, textAlign: 'center',
                      color: C.textDisabled, fontFamily: C.fontMono, fontSize: 11,
                    }}>
                      no rows match the current filters
                    </div>
                  ) : activeColumns.length === 0 ? (
                    <div style={{
                      padding: 24, textAlign: 'center',
                      color: C.textDisabled, fontFamily: C.fontMono, fontSize: 11,
                    }}>
                      select at least one column to preview
                    </div>
                  ) : (
                    <div style={{
                      overflow: 'auto',
                      border: `1px solid ${C.borderSubtle}`, borderRadius: 4,
                    }}>
                      <table style={{
                        borderCollapse: 'collapse', fontSize: 10.5,
                        fontFamily: C.fontMono, width: '100%', minWidth: 'max-content',
                      }}>
                        <thead>
                          <tr style={{ backgroundColor: C.bgApp }}>
                            <th style={{
                              padding: '4px 10px', textAlign: 'left',
                              borderBottom: `1px solid ${C.borderStrong}`,
                              color: C.textDisabled, fontWeight: 'normal',
                              fontSize: 9, whiteSpace: 'nowrap',
                              borderRight: `1px solid ${C.borderSubtle}`,
                            }}>
                              #
                            </th>
                            {activeColumns.map((col) => (
                              <th key={col.id} style={{
                                padding: '4px 12px', textAlign: 'left',
                                borderBottom: `1px solid ${C.borderStrong}`,
                                color: C.textMuted, fontWeight: 'normal',
                                whiteSpace: 'nowrap', letterSpacing: '0.04em',
                                borderRight: `1px solid ${C.borderSubtle}`,
                              }}>
                                {col.id}
                                <span style={{ marginLeft: 5, fontSize: 8.5, color: C.textDisabled }}>{col.type}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((row, ri) => (
                            <tr
                              key={row.__idx}
                              style={{ borderBottom: `1px solid ${C.borderSubtle}` }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanelRaised; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                            >
                              <td style={{
                                padding: '3px 10px', color: C.textDisabled,
                                fontSize: 9, borderRight: `1px solid ${C.borderSubtle}`,
                              }}>
                                {ri + 1}
                              </td>
                              {activeColumns.map((col) => {
                                const v = row[col.id];
                                const str = v == null ? '' : String(v);
                                return (
                                  <td key={col.id} style={{
                                    padding: '3px 12px',
                                    color: v == null ? C.textDisabled : C.textSecondary,
                                    whiteSpace: 'nowrap',
                                    maxWidth: 260,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    borderRight: `1px solid ${C.borderSubtle}`,
                                  }}>
                                    {v == null ? <span style={{ color: C.textDisabled }}>null</span> : str}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* download bar */}
                <div style={{
                  padding: '10px 16px',
                  borderTop: `1px solid ${C.borderStrong}`,
                  display: 'flex', alignItems: 'center', gap: 12,
                  backgroundColor: C.bgApp, flexShrink: 0,
                }}>
                  <button
                    onClick={handleDownload}
                    disabled={filtered.length === 0 || colSet.size === 0 || loading}
                    style={{
                      padding: '7px 22px', fontSize: 12.5, fontFamily: C.fontMono,
                      fontWeight: 700, borderRadius: 4, border: 'none',
                      backgroundColor:
                        filtered.length > 0 && colSet.size > 0 && !loading
                          ? C.active : C.bgPanelRaised,
                      color:
                        filtered.length > 0 && colSet.size > 0 && !loading
                          ? C.bgApp : C.textDisabled,
                      cursor:
                        filtered.length > 0 && colSet.size > 0 && !loading
                          ? 'pointer' : 'not-allowed',
                      transition: 'background 0.15s, color 0.15s',
                      letterSpacing: '0.02em',
                    }}
                    onMouseEnter={(e) => {
                      if (filtered.length > 0 && colSet.size > 0 && !loading)
                        (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)';
                    }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ''; }}
                  >
                    ↓ Download CSV
                  </button>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, fontFamily: C.fontMono, color: C.textMuted }}>
                      {selectedTableId}_export.csv
                    </span>
                    <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
                      {filtered.length.toLocaleString()} rows · {colSet.size} columns · {estimateSize(filtered.length, colSet.size)}
                    </span>
                  </div>

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {(tsFrom || tsTo) && (
                      <span style={{
                        fontSize: 9.5, fontFamily: C.fontMono, padding: '2px 7px', borderRadius: 3,
                        backgroundColor: C.activeFill, color: C.active, border: `1px solid ${C.active}33`,
                      }}>
                        time-filtered
                      </span>
                    )}
                    {(passIdFrom || passIdTo) && (
                      <span style={{
                        fontSize: 9.5, fontFamily: C.fontMono, padding: '2px 7px', borderRadius: 3,
                        backgroundColor: C.infoFill, color: C.info, border: `1px solid ${C.info}33`,
                      }}>
                        pass {passIdFrom || '…'}–{passIdTo || '…'}
                      </span>
                    )}
                    {(textFilter || paramFilter) && (
                      <span style={{
                        fontSize: 9.5, fontFamily: C.fontMono, padding: '2px 7px', borderRadius: 3,
                        backgroundColor: C.warningFill, color: C.warning, border: `1px solid ${C.warning}33`,
                      }}>
                        row-filtered
                      </span>
                    )}
                    {colSet.size < columns.length && (
                      <span style={{
                        fontSize: 9.5, fontFamily: C.fontMono, padding: '2px 7px', borderRadius: 3,
                        backgroundColor: C.infoFill, color: C.info, border: `1px solid ${C.info}33`,
                      }}>
                        {columns.length - colSet.size} cols excluded
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── BATCH MODE PLACEHOLDER ───────────────────────────────────── */}
        {batchMode && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            color: C.textMuted, fontFamily: C.fontMono,
          }}>
            <div style={{ fontSize: 32, opacity: 0.3 }}>⇩</div>
            <div style={{ fontSize: 13, color: C.textPrimary }}>
              {batchSelected.size === 0
                ? 'Select tables from the sidebar'
                : `${batchSelected.size} table${batchSelected.size !== 1 ? 's' : ''} queued`}
            </div>
            <div style={{ fontSize: 11, color: C.textDisabled, textAlign: 'center', maxWidth: 340, lineHeight: 1.6 }}>
              Each table will be exported as a separate CSV file with all columns
              and no row filters applied.
            </div>
            {batchSelected.size > 0 && (
              <div style={{
                marginTop: 8, padding: '8px 16px',
                border: `1px solid ${C.borderSubtle}`, borderRadius: 4,
                backgroundColor: C.bgApp,
              }}>
                {Array.from(batchSelected).map((id) => {
                  const t = allTables.find((x) => x.id === id);
                  return (
                    <div key={id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '3px 0', fontSize: 11, fontFamily: C.fontMono,
                      color: C.textSecondary, borderBottom: `1px solid ${C.borderSubtle}`,
                    }}>
                      <span style={{ color: C.info, fontSize: 9 }}>▦</span>
                      <span>{t?.label ?? id}</span>
                      <span style={{ marginLeft: 'auto', color: C.textDisabled }}>{(t?.rows ?? 0).toLocaleString()} rows</span>
                    </div>
                  );
                })}
                <div style={{ marginTop: 8, fontSize: 10, color: C.textDisabled }}>
                  total: {Array.from(batchSelected).reduce((acc, id) => acc + (allTables.find((x) => x.id === id)?.rows ?? 0), 0).toLocaleString()} rows
                </div>
              </div>
            )}
            {batchSelected.size > 0 && (
              <button
                onClick={handleBatchDownload}
                disabled={batchLoading}
                style={{
                  marginTop: 8, padding: '8px 28px', fontSize: 12.5,
                  fontFamily: C.fontMono, fontWeight: 700,
                  backgroundColor: batchLoading ? C.bgPanelRaised : C.info,
                  color: batchLoading ? C.textDisabled : C.bgApp,
                  border: 'none', borderRadius: 4,
                  cursor: batchLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {batchLoading ? 'downloading…' : `↓ Export ${batchSelected.size} CSV files`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
