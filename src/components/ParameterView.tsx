import { useState, useMemo, CSSProperties } from 'react';
import { C } from '../lib/colors';
import { useTz, fmtIso } from '../lib/timezone';
import { useAllParameters } from '../hooks/useApi';
import type { ParameterRow } from '../hooks/useApi';
import { Sparkline } from './Sparkline';

function isNumeric(rows: ParameterRow[]) {
  return rows.some((r) => r.value !== '' && !isNaN(Number(r.value)));
}

function hasReading(r: ParameterRow) {
  return r.source !== 'catalog' && r.ts_ms > 0;
}

/* ─── sub-components ──────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '4px 10px',
      fontSize: 9, fontFamily: C.fontMono,
      textTransform: 'uppercase', letterSpacing: '0.12em',
      color: C.textDisabled,
      borderBottom: `1px solid ${C.borderSubtle}`,
      backgroundColor: C.bgApp,
      flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

interface NameRowProps {
  name: string;
  latest: string;
  unit: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function NameRow({ name, latest, unit, count, active, onClick }: NameRowProps) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '6px 10px',
        cursor: 'pointer',
        backgroundColor: active ? C.activeFill : 'transparent',
        borderLeft: `2px solid ${active ? C.active : 'transparent'}`,
        borderBottom: `1px solid ${C.borderSubtle}`,
      } as CSSProperties}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 11.5, fontFamily: C.fontMono,
          color: active ? C.active : C.textPrimary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </span>
        <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled, flexShrink: 0 }}>
          {count}×
        </span>
      </div>
      <div style={{
        fontSize: 10, fontFamily: C.fontMono,
        color: C.textMuted, marginTop: 2,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {latest !== '' ? latest : '—'}{unit ? ` ${unit}` : ''}
      </div>
    </div>
  );
}

/* ─── main component ──────────────────────────────────────────────────────── */

export function ParameterView() {
  const { tz } = useTz();
  const { rows: allRows, loading } = useAllParameters();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  /* unique names with metadata */
  const nameIndex = useMemo(() => {
    const map = new Map<string, {
      latest: string;
      unit: string;
      count: number;
      latestTs: number;
      source: string;
      domain: string;
      type: string;
    }>();
    for (const r of allRows) {
      const entry = map.get(r.name);
      const observed = hasReading(r);
      if (!entry) {
        map.set(r.name, {
          latest: observed ? r.value : '',
          unit: r.unit,
          count: observed ? 1 : 0,
          latestTs: observed ? r.ts_ms : 0,
          source: r.source ?? 'parameter',
          domain: r.domain ?? '',
          type: r.type ?? '',
        });
      } else if (observed && r.ts_ms > entry.latestTs) {
        map.set(r.name, {
          latest: r.value,
          unit: r.unit || entry.unit,
          count: entry.count + 1,
          latestTs: r.ts_ms,
          source: r.source ?? entry.source,
          domain: r.domain ?? entry.domain,
          type: r.type ?? entry.type,
        });
      } else if (observed) {
        entry.count += 1;
      } else {
        entry.unit ||= r.unit;
        entry.domain ||= r.domain ?? '';
        entry.type ||= r.type ?? '';
      }
    }
    return map;
  }, [allRows]);

  const filteredNames = useMemo(() => {
    const lc = search.toLowerCase();
    return Array.from(nameIndex.keys())
      .filter((n) => !lc || n.toLowerCase().includes(lc))
      .sort((a, b) => a.localeCompare(b));
  }, [nameIndex, search]);

  /* history for selected parameter */
  const history = useMemo(
    () => selected ? allRows.filter((r) => r.name === selected && hasReading(r)).sort((a, b) => a.ts_ms - b.ts_ms) : [],
    [allRows, selected],
  );

  const selectedMeta = selected ? nameIndex.get(selected) : null;

  const numeric = useMemo(() => isNumeric(history), [history]);

  const sparkData = useMemo(
    () => numeric ? history.map((r) => Number(r.value)).filter((v) => !isNaN(v)) : [],
    [history, numeric],
  );

  const stats = useMemo(() => {
    if (!history.length || !numeric) return null;
    const vals = history.map((r) => Number(r.value)).filter((v) => !isNaN(v));
    if (!vals.length) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min, max, avg };
  }, [history, numeric]);

  const passIds = useMemo(
    () => [...new Set(history.map((r) => r.pass_id))].sort((a, b) => a - b),
    [history],
  );

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── left: parameter list ─────────────────────────────────────────── */}
      <div style={{
        width: 240, flexShrink: 0,
        borderRight: `1px solid ${C.borderSubtle}`,
        display: 'flex', flexDirection: 'column',
        backgroundColor: C.bgPanel,
      }}>
        <div style={{ padding: '6px 8px', borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0 }}>
          <input
            placeholder="search parameters…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '4px 8px',
              backgroundColor: C.bgApp,
              border: `1px solid ${C.borderSubtle}`,
              borderRadius: 3,
              color: C.textPrimary,
              fontFamily: C.fontMono, fontSize: 11,
              outline: 'none',
            }}
          />
        </div>
        <SectionLabel>
          {loading ? 'loading…' : `${filteredNames.length} / ${nameIndex.size} known parameters`}
        </SectionLabel>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredNames.map((name) => {
            const meta = nameIndex.get(name)!;
            return (
              <NameRow
                key={name}
                name={name}
                latest={meta.latest}
                unit={meta.unit}
                count={meta.count}
                active={selected === name}
                onClick={() => setSelected(name)}
              />
            );
          })}
          {!loading && filteredNames.length === 0 && (
            <div style={{ padding: 16, fontFamily: C.fontMono, fontSize: 11, color: C.textDisabled, textAlign: 'center' }}>
              no parameters found
            </div>
          )}
        </div>
      </div>

      {/* ── right: detail ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: C.fontMono, fontSize: 12, color: C.textDisabled,
          }}>
            select a parameter
          </div>
        ) : (
          <>
            {/* header */}
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${C.borderSubtle}`,
              flexShrink: 0, backgroundColor: C.bgPanel,
            }}>
              <div style={{ fontSize: 14, fontFamily: C.fontMono, color: C.textPrimary }}>{selected}</div>
              <div style={{ fontSize: 10.5, fontFamily: C.fontMono, color: C.textMuted, marginTop: 3, display: 'flex', gap: 16 }}>
                <span>{history.length} readings</span>
                {passIds.length > 0 && <span>passes: {passIds.join(', ')}</span>}
                {selectedMeta?.domain && <span>domain: {selectedMeta.domain}</span>}
                {selectedMeta?.type && <span>type: {selectedMeta.type}</span>}
                {stats && (
                  <>
                    <span>min: {stats.min}</span>
                    <span>max: {stats.max}</span>
                    <span>avg: {stats.avg.toFixed(3)}</span>
                  </>
                )}
              </div>
            </div>

            {/* sparkline */}
            {numeric && sparkData.length > 1 && (
              <div style={{
                padding: '8px 14px', borderBottom: `1px solid ${C.borderSubtle}`,
                flexShrink: 0, backgroundColor: C.bgPanel,
              }}>
                <Sparkline data={sparkData} color={C.active} height={48} />
              </div>
            )}

            {/* table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {history.length === 0 ? (
                <div style={{
                  padding: 24,
                  fontFamily: C.fontMono,
                  fontSize: 11,
                  color: C.textDisabled,
                }}>
                  known in mission catalog, not observed in imported passes
                </div>
              ) : (
                <table style={{
                width: '100%', borderCollapse: 'collapse',
                fontFamily: C.fontMono, fontSize: 11,
              }}>
                <thead>
                  <tr style={{ backgroundColor: C.bgApp, position: 'sticky', top: 0 }}>
                    {['Timestamp', 'Value', 'Unit', 'Pass'].map((h) => (
                      <th key={h} style={{
                        padding: '5px 12px', textAlign: 'left',
                        fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em',
                        color: C.textDisabled,
                        borderBottom: `1px solid ${C.borderSubtle}`,
                        fontWeight: 400,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((r, i) => (
                    <tr
                      key={i}
                      style={{ borderBottom: `1px solid ${C.borderSubtle}` }}
                    >
                      <td style={{ padding: '4px 12px', color: C.textMuted }}>{r.ts_iso ? fmtIso(r.ts_iso, tz) : '—'}</td>
                      <td style={{ padding: '4px 12px', color: C.textPrimary }}>{r.value}</td>
                      <td style={{ padding: '4px 12px', color: C.textDisabled }}>{r.unit || '—'}</td>
                      <td style={{ padding: '4px 12px', color: C.textDisabled }}>{r.pass_id}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              )}
            </div>

            {/* status bar */}
            <div style={{
              padding: '4px 12px', borderTop: `1px solid ${C.borderSubtle}`,
              fontFamily: C.fontMono, fontSize: 10.5,
              color: C.textMuted, backgroundColor: C.bgApp, flexShrink: 0,
            }}>
              {history.length} readings · {passIds.length} pass{passIds.length !== 1 ? 'es' : ''}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
