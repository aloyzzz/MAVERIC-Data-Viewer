/* global React */
const { useState, useMemo, useEffect, useRef } = React;
const C = window.GSS;

// ── Variation A: Left sidebar + main grid + right detail drawer ──
window.VariationA = function VariationA() {
  const [activeId, setActiveId] = useState('event_parameter');
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState([]);
  const [sort, setSort] = useState({ col: 'ts_ms', dir: 'desc' });
  const [sidebarFilter, setSidebarFilter] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const schemas = window.DB_SCHEMA.schemas;
  const allTables = schemas.flatMap(s => s.tables);
  const table = allTables.find(t => t.id === activeId);
  const columns = window.DB_COLUMNS[activeId] || [];

  const allRows = useMemo(() => window.DB_GENERATE(activeId, Math.min(table.rows, 200)), [activeId, table.rows]);
  const filtered = useMemo(() => window.applyFilter(allRows, query), [allRows, query]);
  const sorted = useMemo(() => window.applySort(filtered, sort), [filtered, sort]);

  useEffect(() => { setSelected(null); }, [activeId]);
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === 'Escape') { setPaletteOpen(false); setSelected(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSort = (colId) => {
    if (sort.col === colId) setSort({ col: colId, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ col: colId, dir: 'asc' });
  };

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      backgroundColor: C.bgApp,
      fontFamily: C.fontSans,
      color: C.textPrimary,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <window.MiniHeader />

      {/* Tab strip placeholder — current pages */}
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 30, padding: '0 14px', flexShrink: 0,
        backgroundColor: 'rgba(8,8,8,0.8)',
        borderBottom: `1px solid ${C.borderSubtle}`,
        gap: 2,
      }}>
        {[
          { id: '__dashboard__', label: 'Dashboard', active: false },
          { id: '__db__', label: 'Database', active: true },
          { id: '__radio__', label: 'Radio', active: false },
          { id: 'imaging', label: 'Imaging', active: false },
          { id: 'gnc', label: 'GNC', active: false },
          { id: 'eps', label: 'EPS', active: false },
        ].map(t => (
          <div key={t.id} style={{
            padding: '4px 10px',
            fontSize: 11.5,
            fontFamily: C.fontSans,
            color: t.active ? C.textPrimary : C.textMuted,
            backgroundColor: t.active ? C.bgPanelRaised : 'transparent',
            border: t.active ? `1px solid ${C.borderSubtle}` : '1px solid transparent',
            borderBottom: t.active ? `1px solid ${C.bgPanelRaised}` : '1px solid transparent',
            borderRadius: '3px 3px 0 0',
            cursor: 'pointer',
          }}>{t.label}</div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontSize: 10.5, color: C.textMuted, fontFamily: C.fontMono }}>
          <span>Logs</span><span>Config</span><span>Help</span>
        </div>
      </div>

      {/* Main 3-pane area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: 12, gap: 0 }}>
        <div style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 4,
          overflow: 'hidden',
          backgroundColor: C.bgPanel,
        }}>
          <window.SchemaSidebar
            schemas={schemas}
            activeId={activeId}
            onPick={setActiveId}
            sidebarFilter={sidebarFilter}
            setSidebarFilter={setSidebarFilter}
          />

          {/* Main grid column */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            {/* Table title bar */}
            <div style={{
              padding: '6px 12px',
              borderBottom: `1px solid ${C.borderStrong}`,
              display: 'flex', alignItems: 'center', gap: 10,
              backgroundColor: C.bgPanel,
            }}>
              <span style={{
                fontSize: 9.5, fontFamily: C.fontMono, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: C.textMuted,
              }}>table</span>
              <span style={{ fontSize: 13, fontFamily: C.fontMono, color: C.textPrimary }}>{table.label}</span>
              <span style={{ fontSize: 11, color: C.textMuted, fontFamily: C.fontMono }}>{table.desc}</span>
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

            <window.FilterBar
              table={table}
              columns={columns}
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
              rowCount={sorted.length}
              totalCount={table.rows}
              onExport={() => {}}
            />

            <window.DataTable
              tableId={activeId}
              rows={sorted}
              columns={columns}
              selected={selected}
              onSelect={(r) => setSelected(r === selected ? null : r)}
              sort={sort}
              onSort={onSort}
            />

            {/* Status bar */}
            <div style={{
              padding: '4px 12px',
              borderTop: `1px solid ${C.borderSubtle}`,
              display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: C.fontMono, fontSize: 10.5,
              color: C.textMuted,
              backgroundColor: C.bgApp,
            }}>
              <span>SELECT * FROM {table.label}</span>
              {query && <span style={{ color: C.active }}>WHERE {query}</span>}
              {sort.col && <span>ORDER BY {sort.col} {sort.dir.toUpperCase()}</span>}
              <span style={{ marginLeft: 'auto' }}>{sorted.length} rows · 18ms</span>
            </div>
          </div>

          <window.DetailPane
            row={selected}
            columns={columns}
            table={table}
            onClose={() => setSelected(null)}
            position="right"
          />
        </div>
      </div>

      <window.HintBar />

      <window.CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        schemas={schemas}
        onPick={setActiveId}
      />
    </div>
  );
};

// ── Variation B: Top tab strip + grid + bottom detail strip ──────
window.VariationB = function VariationB() {
  const [openTabs, setOpenTabs] = useState(['event_rx_packet', 'event_parameter', 'passes', 'event_alarm']);
  const [activeId, setActiveId] = useState('event_rx_packet');
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState([]);
  const [sort, setSort] = useState({ col: 'ts_ms', dir: 'desc' });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showSchemaPicker, setShowSchemaPicker] = useState(false);

  const schemas = window.DB_SCHEMA.schemas;
  const allTables = schemas.flatMap(s => s.tables);
  const table = allTables.find(t => t.id === activeId);
  const columns = window.DB_COLUMNS[activeId] || [];

  const allRows = useMemo(() => window.DB_GENERATE(activeId, Math.min(table.rows, 200)), [activeId, table.rows]);
  const filtered = useMemo(() => window.applyFilter(allRows, query), [allRows, query]);
  const sorted = useMemo(() => window.applySort(filtered, sort), [filtered, sort]);

  useEffect(() => { setSelected(null); }, [activeId]);
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === 'Escape') { setPaletteOpen(false); setSelected(null); setShowSchemaPicker(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSort = (colId) => {
    if (sort.col === colId) setSort({ col: colId, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ col: colId, dir: 'asc' });
  };

  const openTable = (id) => {
    if (!openTabs.includes(id)) setOpenTabs([...openTabs, id]);
    setActiveId(id);
    setShowSchemaPicker(false);
  };
  const closeTab = (id, e) => {
    e.stopPropagation();
    const next = openTabs.filter(t => t !== id);
    setOpenTabs(next);
    if (activeId === id && next.length) setActiveId(next[0]);
  };

  // Tone for the active table mini-stat row
  const totalNum = table.rows;
  const liveStats = {
    event_rx_packet:    { rate: '0.5/s',  tone: 'success' },
    event_tx_command:   { rate: 'idle',   tone: 'neutral' },
    event_parameter:    { rate: '4.2/s',  tone: 'success' },
    event_alarm:        { rate: '—',      tone: 'warning' },
    event_cmd_verifier: { rate: 'idle',   tone: 'neutral' },
    event_radio:        { rate: 'idle',   tone: 'neutral' },
    passes:             { rate: '—',      tone: 'neutral' },
  }[activeId] || { rate: 'idle', tone: 'neutral' };
  liveStats.total = totalNum.toLocaleString();

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      backgroundColor: C.bgApp,
      fontFamily: C.fontSans,
      color: C.textPrimary,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <window.MiniHeader />

      {/* Page-level tab strip — like the existing console */}
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 30, padding: '0 14px', flexShrink: 0,
        backgroundColor: 'rgba(8,8,8,0.8)',
        borderBottom: `1px solid ${C.borderSubtle}`,
        gap: 2,
      }}>
        {[
          { id: '__dashboard__', label: 'Dashboard' },
          { id: '__db__', label: 'Database', active: true },
          { id: '__radio__', label: 'Radio' },
          { id: 'gnc', label: 'GNC' },
          { id: 'eps', label: 'EPS' },
        ].map(t => (
          <div key={t.id} style={{
            padding: '4px 10px', fontSize: 11.5,
            color: t.active ? C.textPrimary : C.textMuted,
            backgroundColor: t.active ? C.bgPanelRaised : 'transparent',
            border: t.active ? `1px solid ${C.borderSubtle}` : '1px solid transparent',
            borderBottom: t.active ? `1px solid ${C.bgPanelRaised}` : '1px solid transparent',
            borderRadius: '3px 3px 0 0',
            cursor: 'pointer',
          }}>{t.label}</div>
        ))}
      </div>

      {/* Database body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 12 }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 4,
          overflow: 'hidden',
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
            {openTabs.map(id => {
              const t = allTables.find(x => x.id === id);
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
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: sel ? C.active : C.textDisabled, fontSize: 10 }}>▦</span>
                  {t.label}
                  {sel && <span style={{ width: 4, height: 4, borderRadius: '50%', background: C.success, marginLeft: 2 }} />}
                  <button onClick={(e) => closeTab(id, e)} style={{
                    background: 'transparent', border: 0,
                    color: C.textDisabled, cursor: 'pointer',
                    padding: '0 0 0 4px', fontSize: 12, lineHeight: 1,
                  }}>×</button>
                </div>
              );
            })}
            <button
              onClick={() => setShowSchemaPicker(true)}
              style={{
                padding: '0 8px', background: 'transparent', border: 0,
                color: C.textDisabled, cursor: 'pointer',
                fontSize: 14, fontFamily: C.fontMono,
              }}
            >+</button>

            {/* schema picker dropdown */}
            {showSchemaPicker && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute', top: 30, left: 4, zIndex: 20,
                  width: 240,
                  backgroundColor: C.bgPanel,
                  border: `1px solid ${C.borderStrong}`,
                  borderRadius: 4,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                  maxHeight: 360, overflow: 'auto',
                }}
              >
                {schemas.map(s => (
                  <div key={s.name}>
                    <div style={{
                      padding: '5px 10px',
                      fontSize: 9.5, fontFamily: C.fontMono,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: C.textMuted,
                      backgroundColor: C.bgApp,
                      borderBottom: `1px solid ${C.borderSubtle}`,
                    }}>{s.name}</div>
                    {s.tables.map(t => (
                      <div
                        key={t.id}
                        onClick={() => openTable(t.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px',
                          fontSize: 11, fontFamily: C.fontMono,
                          color: C.textPrimary, cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = C.bgPanelRaised}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <span style={{ color: C.textDisabled, fontSize: 10 }}>▦</span>
                        {t.label}
                        <span style={{ marginLeft: 'auto', color: C.textDisabled, fontSize: 9.5 }}>
                          {t.rows > 9999 ? `${(t.rows/1000).toFixed(0)}k` : t.rows}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Table info strip */}
          <div style={{
            padding: '6px 12px',
            borderBottom: `1px solid ${C.borderSubtle}`,
            display: 'flex', alignItems: 'center', gap: 16,
            backgroundColor: C.bgPanel,
          }}>
            <Stat label="rows" value={liveStats.total} />
            <Stat label="ingest" value={liveStats.rate} tone={liveStats.tone} />
            <Stat label="primary" value={table.primary} mono />
            <Stat label="cols" value={String(columns.length)} />
            <span style={{ flex: 1, color: C.textMuted, fontSize: 11, fontFamily: C.fontMono, fontStyle: 'italic' }}>
              {table.desc}
            </span>
            <window.Sparkline seed={activeId.length} color={window.toneColor(liveStats.tone)} points={48} height={26} />
          </div>

          <window.FilterBar
            table={table}
            columns={columns}
            filter={filter}
            setFilter={setFilter}
            query={query}
            setQuery={setQuery}
            rowCount={sorted.length}
            totalCount={table.rows}
            onExport={() => {}}
          />

          <window.DataTable
            tableId={activeId}
            rows={sorted}
            columns={columns}
            selected={selected}
            onSelect={(r) => setSelected(r === selected ? null : r)}
            sort={sort}
            onSort={onSort}
            highlightRow={0}
          />

          <window.DetailPane
            row={selected}
            columns={columns}
            table={table}
            onClose={() => setSelected(null)}
            position="bottom"
          />

          {/* Status bar */}
          <div style={{
            padding: '4px 12px',
            borderTop: `1px solid ${C.borderStrong}`,
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: C.fontMono, fontSize: 10.5,
            color: C.textMuted,
            backgroundColor: C.bgApp,
          }}>
            <span style={{ color: C.active }}>SELECT</span>
            <span>* FROM {table.label}</span>
            {query && <span><span style={{ color: C.active }}>WHERE</span> {query}</span>}
            {sort.col && <span><span style={{ color: C.active }}>ORDER BY</span> {sort.col} {sort.dir.toUpperCase()}</span>}
            <span style={{ marginLeft: 'auto' }}>{sorted.length} rows · 18ms · cached</span>
          </div>
        </div>
      </div>

      <window.HintBar />

      <window.CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        schemas={schemas}
        onPick={openTable}
      />
    </div>
  );
};

function Stat({ label, value, tone, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{
        fontSize: 9.5, fontFamily: C.fontMono,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        color: C.textMuted,
      }}>{label}</span>
      <span style={{
        fontSize: 12,
        fontFamily: mono ? C.fontMono : C.fontSans,
        color: tone ? window.toneColor(tone) : C.textPrimary,
      }}>{value}</span>
    </div>
  );
}
