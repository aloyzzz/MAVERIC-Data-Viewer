/* global React */
const { useState, useMemo, useEffect, useRef, useCallback } = React;
const C = window.GSS;

// ── Sidebar (Variation A) ─────────────────────────────────────────
window.SchemaSidebar = function SchemaSidebar({ schemas, activeId, onPick, sidebarFilter, setSidebarFilter }) {
  const [collapsed, setCollapsed] = useState({});
  const filt = sidebarFilter.toLowerCase();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: 240, flexShrink: 0,
      backgroundColor: C.bgPanel,
      borderRight: `1px solid ${C.borderSubtle}`,
      minHeight: 0,
    }}>
      <div style={{
        padding: '8px 10px',
        borderBottom: `1px solid ${C.borderSubtle}`,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          fontSize: 9.5,
          fontFamily: C.fontMono,
          letterSpacing: '0.1em',
          color: C.textMuted,
          textTransform: 'uppercase',
        }}>db /</span>
        <span style={{ fontSize: 11.5, fontFamily: C.fontMono, color: C.textPrimary }}>maveric_gss</span>
        <span style={{
          marginLeft: 'auto', fontSize: 9.5,
          color: C.success, fontFamily: C.fontMono,
          padding: '1px 5px', backgroundColor: C.successFill,
          border: `1px solid ${C.success}33`, borderRadius: 2,
        }}>● live</span>
      </div>

      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${C.borderSubtle}` }}>
        <input
          value={sidebarFilter}
          onChange={(e) => setSidebarFilter(e.target.value)}
          placeholder="filter tables…"
          style={{
            width: '100%',
            background: C.bgApp,
            border: `1px solid ${C.borderSubtle}`,
            color: C.textPrimary,
            fontFamily: C.fontMono,
            fontSize: 11,
            padding: '4px 8px',
            outline: 'none',
            borderRadius: 3,
          }}
        />
      </div>

      <div style={{ overflow: 'auto', flex: 1, padding: '4px 0' }}>
        {schemas.map(s => {
          const tables = s.tables.filter(t => !filt || t.label.toLowerCase().includes(filt));
          if (tables.length === 0 && filt) return null;
          const isCol = collapsed[s.name];
          return (
            <div key={s.name} style={{ marginBottom: 4 }}>
              <div
                onClick={() => setCollapsed({ ...collapsed, [s.name]: !isCol })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px',
                  fontSize: 10,
                  fontFamily: C.fontMono,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: C.textMuted,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 8, color: C.textDisabled }}>{isCol ? '▸' : '▾'}</span>
                {s.name}
                <span style={{ marginLeft: 'auto', color: C.textDisabled, fontSize: 9.5 }}>{s.tables.length}</span>
              </div>
              {!isCol && tables.map(t => {
                const sel = activeId === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => onPick(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px 4px 22px',
                      fontSize: 11.5,
                      fontFamily: C.fontMono,
                      color: sel ? C.active : C.textPrimary,
                      backgroundColor: sel ? C.bgPanelRaised : 'transparent',
                      borderLeft: `2px solid ${sel ? C.active : 'transparent'}`,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { if (!sel) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.025)'; }}
                    onMouseLeave={(e) => { if (!sel) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span style={{ color: sel ? C.active : C.textDisabled, fontSize: 10 }}>▦</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.label}</span>
                    <span style={{ fontSize: 9.5, color: C.textDisabled, fontFamily: C.fontMono }}>
                      {t.rows > 9999 ? `${(t.rows/1000).toFixed(0)}k` : t.rows}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer connection info */}
      <div style={{
        padding: '6px 10px',
        borderTop: `1px solid ${C.borderSubtle}`,
        fontSize: 10,
        fontFamily: C.fontMono,
        color: C.textDisabled,
        lineHeight: 1.4,
      }}>
        <div>postgres://gss@localhost:5432</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <span>v6.1.0</span>
          <span style={{ color: C.textMuted }}>·</span>
          <span>idle 2.4ms</span>
          <span style={{ marginLeft: 'auto', color: C.success }}>●</span>
        </div>
      </div>
    </div>
  );
};

// ── Detail pane ───────────────────────────────────────────────────
window.DetailPane = function DetailPane({ row, columns, table, onClose, position='right' }) {
  if (!row) {
    return (
      <div style={{
        flex: position === 'right' ? '0 0 360px' : '0 0 220px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderLeft: position === 'right' ? `1px solid ${C.borderSubtle}` : 'none',
        borderTop: position === 'bottom' ? `1px solid ${C.borderSubtle}` : 'none',
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
          <div style={{ marginTop: 4, color: C.textDisabled, fontSize: 10 }}>↑/↓ navigate · Space expand · Esc deselect</div>
        </div>
      </div>
    );
  }

  const widthStyle = position === 'right'
    ? { flex: '0 0 360px', borderLeft: `1px solid ${C.borderSubtle}` }
    : { flex: '0 0 240px', borderTop: `1px solid ${C.borderSubtle}` };

  return (
    <div style={{
      ...widthStyle,
      display: 'flex', flexDirection: 'column',
      backgroundColor: C.bgPanel,
      minHeight: 0,
      animation: 'detail-swap-anim 250ms cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${C.borderStrong}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          fontSize: 9.5,
          fontFamily: C.fontMono,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: C.active,
        }}>row inspector</span>
        <span style={{ color: C.textDisabled, fontSize: 10 }}>·</span>
        <span style={{ fontSize: 11, color: C.textPrimary, fontFamily: C.fontMono }}>{table.label}</span>
        <span style={{ color: C.textDisabled, fontSize: 10 }}>·</span>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: C.fontMono }}>#{(row.__idx + 1).toString().padStart(4,'0')}</span>
        <button onClick={onClose} style={{
          marginLeft: 'auto', background: 'transparent', border: 0,
          color: C.textDisabled, cursor: 'pointer', fontSize: 14, padding: '0 4px',
        }}>×</button>
      </div>

      {/* Field list */}
      <div style={{ overflow: 'auto', flex: 1, fontFamily: C.fontMono, fontSize: 11 }}>
        {columns.map(col => {
          const v = row[col.id];
          let valColor = C.textPrimary;
          let valText = v == null ? 'NULL' : String(v);
          if (v == null) valColor = C.textDisabled;
          if (col.type === 'tag' && v) valColor = window.toneColor(window.toneOf(v));
          if (col.type === 'frame' && v) valColor = window.frameColor(v);
          if (col.type === 'bool') valColor = v ? C.success : C.danger;
          if (col.type === 'float' && typeof v === 'number') valText = v.toFixed(6);

          return (
            <div key={col.id} style={{
              display: 'flex',
              padding: '6px 12px',
              borderBottom: `1px solid ${C.borderSubtle}`,
              gap: 10,
              alignItems: 'baseline',
            }}>
              <div style={{ flex: '0 0 110px', color: C.textMuted, fontSize: 10.5 }}>
                {col.label}
                {col.fk && <span style={{ marginLeft: 4, color: C.info, fontSize: 9 }}>FK</span>}
              </div>
              <div style={{ flex: 1, color: valColor, wordBreak: 'break-all' }}>
                {valText}
              </div>
              <div style={{ flex: '0 0 auto', color: C.textDisabled, fontSize: 9.5, textTransform: 'uppercase' }}>
                {col.type}
              </div>
            </div>
          );
        })}

        {/* Sparkline placeholder for telemetry */}
        {(table.id === 'eps_battery' || table.id === 'gnc_attitude' || table.id === 'parameters_cache') && (
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borderSubtle}` }}>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ◊ value · last 60 samples
            </div>
            <window.Sparkline seed={row.__idx} color={C.active} />
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{
        padding: '8px 12px',
        borderTop: `1px solid ${C.borderStrong}`,
        display: 'flex', gap: 6, flexWrap: 'wrap',
      }}>
        <button style={btnStyle()}>Copy JSON</button>
        <button style={btnStyle()}>Copy SQL</button>
        <button style={btnStyle('info')}>Open in RX panel</button>
      </div>
    </div>
  );
};

function btnStyle(tone) {
  const t = tone ? window.toneColor(tone) : C.textMuted;
  const f = tone ? window.toneFill(tone) : 'transparent';
  return {
    background: f,
    border: `1px solid ${tone ? t + '33' : C.borderSubtle}`,
    color: t,
    padding: '3px 8px',
    borderRadius: 3,
    fontSize: 10.5,
    fontFamily: C.fontMono,
    cursor: 'pointer',
  };
}

// ── Sparkline ─────────────────────────────────────────────────────
window.Sparkline = function Sparkline({ seed = 0, color = C.active, points = 60, height = 36 }) {
  const data = useMemo(() => {
    const r = (n) => {
      const x = Math.sin(seed * 9.3 + n * 1.7) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: points }, (_, i) =>
      0.4 + 0.4 * Math.sin(i / 4 + seed) + (r(i) - 0.5) * 0.25
    );
  }, [seed, points]);
  const min = Math.min(...data), max = Math.max(...data);
  const norm = data.map(v => (v - min) / (max - min || 1));

  const w = 320, h = height;
  const path = norm.map((v, i) => {
    const x = (i / (norm.length - 1)) * w;
    const y = h - v * h;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`spark-grad-${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={`url(#spark-grad-${seed})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" />
      {/* baseline */}
      <line x1="0" x2={w} y1={h - 0.5} y2={h - 0.5} stroke={C.borderSubtle} strokeWidth="1" />
    </svg>
  );
};

// ── Mini header bar (mimics GlobalHeader) ────────────────────────
window.MiniHeader = function MiniHeader({ activeTable }) {
  const [now] = useState(() => new Date());
  const utcTime = now.toISOString().slice(11, 19);
  const utcDate = now.toISOString().slice(0, 10);

  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center',
      height: 34, padding: '0 14px', flexShrink: 0,
      backgroundColor: C.bgApp,
      borderBottom: `1px solid ${C.success}33`,
    }}>
      {/* noise texture */}
      <svg style={{ width: 0, height: 0, position: 'absolute' }} aria-hidden>
        <filter id="db-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
        </filter>
      </svg>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', filter: 'url(#db-noise)', opacity: 0.015, mixBlendMode: 'overlay' }} />

      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 14, position: 'relative' }}>
        <div style={{
          width: 18, height: 18, borderRadius: 3,
          background: `linear-gradient(135deg, ${C.active} 0%, ${C.info} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: C.fontMono, fontSize: 10, fontWeight: 700, color: C.bgApp,
        }}>▦</div>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.02em', color: C.textPrimary }}>
          MAVERIC <span style={{ color: C.active }}>DB</span>
        </span>
        <span style={{ fontSize: 11, color: C.textDisabled }}>v6.1.0</span>
      </div>

      <span style={{ color: C.borderStrong, fontSize: 11 }}>|</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, fontFamily: C.fontMono, fontSize: 11 }}>
        <span style={{ color: C.textMuted, fontStyle: 'normal' }}>2026-05-07-000</span>
        <span style={{ color: C.textMuted }}>4h 12m</span>
        <span style={{ color: C.textDisabled }}>·</span>
        <span style={{ textTransform: 'uppercase', color: C.textMuted, fontSize: 10, letterSpacing: '0.04em' }}>OP</span>
        <span style={{ color: C.textSecondary }}>lcurry@SCFA-LAX</span>
      </div>

      {/* Right cluster */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontFamily: C.fontMono, fontSize: 11 }}>
        <span style={{ color: C.success, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.success, boxShadow: `0 0 6px ${C.success}` }} />
          5.4/s
        </span>
        <span style={{ color: C.borderStrong }}>|</span>
        <span style={{ color: C.textPrimary }}>2026-05-07 {utcTime} <span style={{ color: C.textDisabled }}>UTC</span></span>
      </div>
    </div>
  );
};

// ── Hint bar ──────────────────────────────────────────────────────
window.HintBar = function HintBar({ items }) {
  const def = [
    { k: 'Ctrl+K', d: 'Search' },
    { k: '↑↓', d: 'Navigate' },
    { k: 'Space', d: 'Expand' },
    { k: '/', d: 'Filter' },
    { k: 'Esc', d: 'Deselect' },
    { k: '?', d: 'Help' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 18, height: 24, padding: '0 14px', flexShrink: 0,
      borderTop: `1px solid ${C.borderSubtle}`,
      backgroundColor: C.bgApp,
    }}>
      {(items || def).map(h => (
        <span key={h.k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
          <kbd style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 16, minWidth: 16, padding: '0 4px',
            backgroundColor: C.bgPanelRaised,
            border: `1px solid ${C.borderSubtle}`,
            borderRadius: 3,
            fontFamily: C.fontMono, fontSize: 10,
            color: C.textSecondary,
          }}>{h.k}</kbd>
          <span style={{ color: C.textMuted, fontSize: 10.5 }}>{h.d}</span>
        </span>
      ))}
    </div>
  );
};

// ── Command palette (Ctrl+K) ──────────────────────────────────────
window.CommandPalette = function CommandPalette({ open, onClose, schemas, onPick }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  if (!open) return null;

  const items = schemas.flatMap(s => s.tables.map(t => ({ ...t, schema: s.name })));
  const filtered = items.filter(t => !q || t.label.toLowerCase().includes(q.toLowerCase()) || t.schema.toLowerCase().includes(q.toLowerCase()));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12%',
        backgroundColor: 'rgba(8,8,8,0.85)',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 480,
        backgroundColor: C.bgPanel,
        border: `1px solid ${C.borderStrong}`,
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borderSubtle}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: C.active, fontFamily: C.fontMono, fontSize: 12 }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="jump to table, run query, copy session…"
            style={{
              flex: 1, background: 'transparent', border: 0, outline: 'none',
              color: C.textPrimary, fontSize: 13, fontFamily: C.fontMono,
            }}
          />
          <kbd style={{
            backgroundColor: C.bgPanelRaised, border: `1px solid ${C.borderSubtle}`,
            color: C.textMuted, padding: '1px 5px', borderRadius: 3, fontSize: 10, fontFamily: C.fontMono,
          }}>Esc</kbd>
        </div>
        <div style={{ maxHeight: 320, overflow: 'auto', padding: 4 }}>
          {filtered.slice(0, 12).map(t => (
            <div
              key={t.id}
              onClick={() => { onPick(t.id); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 10px', borderRadius: 3,
                cursor: 'pointer', fontFamily: C.fontMono, fontSize: 12,
                color: C.textPrimary,
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = C.bgPanelRaised}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <span style={{ color: C.textDisabled, fontSize: 10 }}>▦</span>
              <span style={{ color: C.textMuted, fontSize: 10 }}>{t.schema}.</span>
              <span>{t.label}</span>
              <span style={{ marginLeft: 'auto', color: C.textDisabled, fontSize: 10 }}>{t.rows.toLocaleString()} rows</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 16, color: C.textDisabled, fontSize: 11, fontFamily: C.fontMono, textAlign: 'center' }}>
              no matching commands
            </div>
          )}
        </div>
        <div style={{ padding: '6px 10px', borderTop: `1px solid ${C.borderSubtle}`, display: 'flex', gap: 12, fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span style={{ marginLeft: 'auto' }}>{filtered.length} results</span>
        </div>
      </div>
    </div>
  );
};
