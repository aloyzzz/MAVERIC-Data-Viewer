/* global React */
const { useState, useMemo, useEffect, useRef, useCallback } = React;

// ── Tokens lifted from web/src/lib/colors.ts ──────────────────────
window.GSS = {
  bgApp:         '#080808',
  bgPanel:       '#0E0E0E',
  bgPanelRaised: '#151515',
  borderSubtle:  '#222222',
  borderStrong:  '#333333',
  textPrimary:   '#E5E5E5',
  textSecondary: '#A0A0A0',
  textMuted:     '#8A8A8A',
  textDisabled:  '#777777',

  danger:  '#FF3838', dangerFill:  '#1A0E0E',
  warning: '#E8B83A', warningFill: '#1A1508',
  info:    '#5AA8F0', infoFill:    '#0E1418',
  success: '#3CC98E', successFill: '#0C1612',
  active:  '#30C8E0', activeFill:  '#0C1315',
  neutral: '#888888', neutralFill: '#141414',

  frameAx25:  '#6690B8',
  frameGolay: '#50A898',

  fontSans: "'Inter Variable', Inter, system-ui, sans-serif",
  fontMono: "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', monospace",
};
const C = window.GSS;

// ── tone helpers ──────────────────────────────────────────────────
window.toneOf = function (label) {
  const m = {
    ACK:'info', RES:'success', CMD:'neutral', REQ:'neutral', TLM:'active',
    FILE:'neutral', ERR:'danger', FAIL:'danger', TIMEOUT:'danger',
    NACK:'danger', GUARD:'warning', NONE:'neutral',
    danger:'danger', warning:'warning', info:'info', success:'success',
    active:'active', neutral:'neutral',
    live:'success', closed:'neutral', rotated:'warning',
    CHARGE:'success', DISCHARGE:'warning', IDLE:'neutral',
  };
  return m[String(label).toUpperCase()] || m[String(label)] || 'neutral';
};
window.toneColor = function (t) {
  return ({ danger:C.danger, warning:C.warning, info:C.info, success:C.success, active:C.active, neutral:C.neutral })[t] || C.neutral;
};
window.toneFill = function (t) {
  return ({ danger:C.dangerFill, warning:C.warningFill, info:C.infoFill, success:C.successFill, active:C.activeFill, neutral:C.neutralFill })[t] || C.neutralFill;
};
window.frameColor = function (f) {
  if (!f) return C.danger;
  const u = f.toUpperCase();
  if (u.includes('AX')) return C.frameAx25;
  if (u.includes('GOLAY')) return C.frameGolay;
  return C.danger;
};

// ── Cell renderer ─────────────────────────────────────────────────
window.Cell = function Cell({ col, value }) {
  const align = col.align === 'right' ? 'flex-end' : 'flex-start';
  const fontFamily = col.mono ? C.fontMono : C.fontSans;
  const baseStyle = {
    flex: `0 0 ${col.width}px`,
    width: col.width,
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: align,
    fontFamily,
    fontSize: 12,
    color: C.textPrimary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  if (value === null || value === undefined || value === '') {
    return <div style={{ ...baseStyle, color: C.textDisabled }}>—</div>;
  }

  if (col.type === 'tag') {
    const tone = window.toneOf(value);
    return (
      <div style={baseStyle}>
        <span style={{
          fontSize: 10.5,
          letterSpacing: '0.04em',
          padding: '2px 6px',
          borderRadius: 3,
          color: window.toneColor(tone),
          backgroundColor: window.toneFill(tone),
          border: `1px solid ${window.toneColor(tone)}33`,
          fontFamily: C.fontMono,
          textTransform: 'uppercase',
        }}>{value}</span>
      </div>
    );
  }
  if (col.type === 'frame') {
    return <div style={{ ...baseStyle, color: window.frameColor(value) }}>{value}</div>;
  }
  if (col.type === 'bool') {
    const ok = !!value;
    return (
      <div style={baseStyle}>
        <span style={{
          fontSize: 10.5,
          padding: '1px 6px',
          borderRadius: 3,
          color: ok ? C.success : C.danger,
          backgroundColor: ok ? C.successFill : C.dangerFill,
          border: `1px solid ${(ok ? C.success : C.danger)}33`,
          fontFamily: C.fontMono,
        }}>{ok ? 'true' : 'false'}</span>
      </div>
    );
  }
  if (col.type === 'float') {
    const n = typeof value === 'number' ? value : parseFloat(value);
    const s = isNaN(n) ? String(value) : (Math.abs(n) > 100 ? n.toFixed(2) : n.toFixed(4));
    return <div style={{ ...baseStyle, color: C.textPrimary }}>{s}</div>;
  }
  if (col.type === 'int') {
    return <div style={{ ...baseStyle, color: C.textPrimary }}>{Number(value).toLocaleString()}</div>;
  }
  if (col.type === 'time') {
    return <div style={{ ...baseStyle, color: C.textSecondary, fontFamily: C.fontMono }}>{value}</div>;
  }
  return <div style={baseStyle}>{String(value)}</div>;
};

// ── Header cell with sort + filter ────────────────────────────────
window.HeaderCell = function HeaderCell({ col, sort, onSort }) {
  const dir = sort && sort.col === col.id ? sort.dir : null;
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
      <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{col.label}</span>
      {col.fk && <span style={{ color: C.info, fontSize: 9, opacity: 0.8 }}>FK</span>}
      <span style={{ marginLeft: 'auto', opacity: dir ? 1 : 0.25, fontSize: 9 }}>
        {dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '◆'}
      </span>
    </div>
  );
};

// ── DataTable ─────────────────────────────────────────────────────
window.DataTable = function DataTable({ tableId, rows, columns, selected, onSelect, sort, onSort, density='compact', highlightRow=null }) {
  const rowH = density === 'comfy' ? 30 : 24;
  const total = columns.reduce((a, c) => a + c.width, 0) + 60;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        backgroundColor: C.bgPanel,
        borderBottom: `1px solid ${C.borderStrong}`,
        position: 'sticky',
        top: 0,
        zIndex: 2,
        minWidth: total,
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
        {columns.map(c => <window.HeaderCell key={c.id} col={c} sort={sort} onSort={onSort} />)}
      </div>

      {/* Body */}
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ minWidth: total }}>
          {rows.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12, fontFamily: C.fontMono }}>
              0 rows match filter
            </div>
          )}
          {rows.map((row, i) => {
            const sel = selected && selected.__idx === row.__idx;
            const flash = highlightRow === row.__idx;
            return (
              <div
                key={row.__idx}
                onClick={() => onSelect(row)}
                style={{
                  display: 'flex',
                  height: rowH,
                  alignItems: 'center',
                  borderBottom: `1px solid ${C.borderSubtle}`,
                  borderLeft: `2px solid ${sel ? C.active : 'transparent'}`,
                  backgroundColor: sel ? C.bgPanelRaised : (flash ? 'rgba(60,201,142,0.06)' : 'transparent'),
                  cursor: 'pointer',
                  transition: 'background-color 100ms ease',
                }}
                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.025)'; }}
                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.backgroundColor = flash ? 'rgba(60,201,142,0.06)' : 'transparent'; }}
              >
                <div style={{
                  flex: '0 0 60px',
                  padding: '0 8px',
                  textAlign: 'right',
                  fontFamily: C.fontMono,
                  fontSize: 10.5,
                  color: sel ? C.active : C.textDisabled,
                  borderRight: `1px solid ${C.borderSubtle}`,
                }}>{(row.__idx + 1).toString().padStart(4, '0')}</div>
                {columns.map(c => <window.Cell key={c.id} col={c} value={row[c.id]} />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Filter chip bar ───────────────────────────────────────────────
window.FilterBar = function FilterBar({ table, columns, filter, setFilter, query, setQuery, rowCount, totalCount, onExport }) {
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
        gap: 0,
        backgroundColor: C.bgPanelRaised,
        border: `1px solid ${C.borderSubtle}`,
        borderRadius: 3,
        padding: '0 6px',
        flex: '1 1 280px',
      }}>
        <span style={{ color: C.textDisabled, marginRight: 6 }}>⌕</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="filter rows…  e.g.  rssi_dbm < -100  •  cmd:eps  •  crc_ok=false"
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
            style={{
              background:'transparent', border:0, color: C.textDisabled, cursor:'pointer',
              fontSize: 11, padding: '0 4px',
            }}
          >×</button>
        )}
      </div>

      {filter.map((f, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 6px',
          borderRadius: 3,
          backgroundColor: C.activeFill,
          border: `1px solid ${C.active}33`,
          color: C.active,
          fontSize: 10.5,
        }}>
          {f.col} {f.op} {f.val}
          <button onClick={() => setFilter(filter.filter((_, j) => j !== i))} style={{ background:'none', border:0, color: C.active, cursor:'pointer', padding:0, marginLeft: 2 }}>×</button>
        </span>
      ))}

      <span style={{ marginLeft: 'auto', color: C.textMuted }}>
        <span style={{ color: C.textPrimary }}>{rowCount.toLocaleString()}</span>
        <span style={{ color: C.textDisabled }}> / {totalCount.toLocaleString()} rows</span>
      </span>
      <button onClick={onExport} style={{
        background: 'transparent', border: `1px solid ${C.borderSubtle}`,
        color: C.textMuted, padding: '2px 8px', borderRadius: 3, fontSize: 11,
        fontFamily: C.fontMono, cursor: 'pointer',
      }}>↓ csv</button>
    </div>
  );
};

// ── filter logic
window.applyFilter = function (rows, query) {
  if (!query.trim()) return rows;
  const q = query.trim();
  // operators
  const m = q.match(/^(\w+)\s*(=|!=|>=|<=|>|<|:)\s*(.+)$/);
  if (m) {
    const [, col, op, raw] = m;
    const val = raw.trim().replace(/^['"]|['"]$/g, '');
    return rows.filter(r => {
      const v = r[col];
      if (v === undefined || v === null) return false;
      if (op === ':') return String(v).toLowerCase().includes(val.toLowerCase());
      if (op === '=' || op === '==') return String(v) == val;
      if (op === '!=') return String(v) != val;
      const a = parseFloat(v), b = parseFloat(val);
      if (op === '>')  return a > b;
      if (op === '<')  return a < b;
      if (op === '>=') return a >= b;
      if (op === '<=') return a <= b;
      return false;
    });
  }
  const lc = q.toLowerCase();
  return rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(lc)));
};

window.applySort = function (rows, sort) {
  if (!sort || !sort.col) return rows;
  const out = rows.slice();
  out.sort((a, b) => {
    const av = a[sort.col], bv = b[sort.col];
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = parseFloat(av), bn = parseFloat(bv);
    let cmp;
    if (!isNaN(an) && !isNaN(bn) && String(av).match(/^-?\d/)) cmp = an - bn;
    else cmp = String(av).localeCompare(String(bv));
    return sort.dir === 'desc' ? -cmp : cmp;
  });
  return out;
};
