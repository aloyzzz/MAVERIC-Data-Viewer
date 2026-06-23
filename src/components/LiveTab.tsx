import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { C } from '../lib/colors';
import { useTableRows } from '../hooks/useApi';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PassRow {
  pass_id: number;
  session_id: string;
  pass_date: string;
  pass_time: string;
  mission_id: string;
  operator: string;
  station: string;
  start_ts_ms: number;
  end_ts_ms: number;
}

interface DecodedRow {
  pass_id: number;
  ts_ms:   number;
  cmd_id:  string;
  field:   string;
  value:   string;
  unit:    string;
}

interface SummaryRow {
  cmd_id: string;
  field:  string;
  unit:   string;
  count:  number;
}

interface Series { ts: number; value: number; passId: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const LINE_COLORS = [
  '#4ade80', '#22d3ee', '#f59e0b', '#60a5fa', '#f87171',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#e879f9',
];

const PASS_COLORS = [
  '#4ade80', '#22d3ee', '#f59e0b', '#60a5fa', '#f87171',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#e879f9',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Binary search for nearest point to a given timestamp (data must be sorted asc by ts).
function nearestPoint(data: Series[], ts: number): Series | null {
  if (data.length === 0) return null;
  let lo = 0, hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].ts < ts) lo = mid + 1; else hi = mid;
  }
  if (lo === 0) return data[0];
  if (lo >= data.length) return data[data.length - 1];
  return Math.abs(data[lo - 1].ts - ts) <= Math.abs(data[lo].ts - ts) ? data[lo - 1] : data[lo];
}

function fmtTooltipValue(v: number): string {
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.0001 && v !== 0)) return v.toExponential(4);
  return parseFloat(v.toPrecision(6)).toString();
}

function msToInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

function inputToMs(s: string): number {
  return new Date(s.length === 16 ? s + ':00Z' : s + 'Z').getTime();
}

function fmtY(v: number): string {
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(2);
  return parseFloat(v.toPrecision(4)).toString();
}

function fmtDate(d: string, t: string) {
  return `${d} ${t}`.trim() || '—';
}

// ── Mini SVG chart ────────────────────────────────────────────────────────────

interface HoverState {
  svgX: number;
  cursorTs: number;
  fracX: number;
}

function ParamChart({
  field, unit, series, passColorMap, startMs, endMs, showXAxis,
}: {
  field: string;
  unit: string;
  series: { passId: number; data: Series[] }[];
  passColorMap: Map<number, string>;
  startMs: number;
  endMs: number;
  showXAxis: boolean;
}) {
  const W = 1000;
  const PAD_L = 62; const PAD_R = 12; const PAD_T = 8;
  const PAD_B = showXAxis ? 22 : 5;
  const H = 78 + (showXAxis ? 16 : 0);
  const cW = W - PAD_L - PAD_R;
  const cH = H - PAD_T - PAD_B;
  const tRange = endMs - startMs || 1;

  const allVals = series.flatMap(s => s.data.map(d => d.value));
  const yMin = allVals.length ? Math.min(...allVals) : 0;
  const yMax = allVals.length ? Math.max(...allVals) : 1;
  const yPad = yMin === yMax ? Math.max(Math.abs(yMin) * 0.05, 0.001) : 0;
  const yLo = yMin - yPad, yHi = yMax + yPad;
  const yRange = yHi - yLo || 1;

  const px = (ts: number) => PAD_L + ((ts - startMs) / tRange) * cW;
  const py = (v: number)  => PAD_T + cH - ((v - yLo) / yRange) * cH;

  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const ms = startMs + (i / 4) * tRange;
    return { x: PAD_L + (i / 4) * cW, label: new Date(ms).toISOString().slice(11, 19) };
  });

  const [hover, setHover] = useState<HoverState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const svgX = fracX * W;
    if (svgX < PAD_L || svgX > W - PAD_R) { setHover(null); return; }
    const cursorTs = startMs + ((svgX - PAD_L) / cW) * tRange;
    setHover({ svgX, cursorTs, fracX });
  }, [startMs, tRange, cW]);

  // Nearest point per series at the hovered timestamp
  const hoverPoints = useMemo(() => {
    if (!hover) return [];
    return series.flatMap(s => {
      const pt = nearestPoint(s.data, hover.cursorTs);
      if (!pt) return [];
      return [{ passId: s.passId, ts: pt.ts, value: pt.value }];
    });
  }, [hover, series]);

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: H, display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* y gridlines */}
        {[0, 0.5, 1].map(p => {
          const y = PAD_T + (1 - p) * cH;
          return (
            <g key={p}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke={C.borderSubtle} strokeWidth="0.4" />
              <text x={PAD_L - 3} y={y + 2.5} textAnchor="end" fontSize="7" fill={C.textDisabled} fontFamily="monospace">
                {fmtY(yLo + p * yRange)}
              </text>
            </g>
          );
        })}

        {/* axes */}
        <line x1={PAD_L} y1={PAD_T}      x2={PAD_L}     y2={PAD_T + cH} stroke={C.borderStrong} strokeWidth="0.6" />
        <line x1={PAD_L} y1={PAD_T + cH} x2={W - PAD_R} y2={PAD_T + cH} stroke={C.borderStrong} strokeWidth="0.6" />

        {/* field label + unit */}
        <text x={PAD_L + 5} y={PAD_T + 10} fontSize="8.5" fill={C.textMuted} fontFamily="monospace">
          {field}{unit ? ` (${unit})` : ''}
        </text>

        {/* one polyline per pass */}
        {series.map(({ passId, data }) => {
          if (data.length === 0) return null;
          const color = passColorMap.get(passId) ?? C.active;
          const pts = data.map(d => `${px(d.ts).toFixed(1)},${py(d.value).toFixed(1)}`).join(' ');
          return <polyline key={passId} points={pts} fill="none" stroke={color} strokeWidth="1.4" />;
        })}

        {/* x-axis labels */}
        {showXAxis && xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 3} textAnchor="middle" fontSize="7" fill={C.textDisabled} fontFamily="monospace">
            {t.label}
          </text>
        ))}

        {/* Crosshair */}
        {hover && (
          <line
            x1={hover.svgX} x2={hover.svgX}
            y1={PAD_T} y2={PAD_T + cH}
            stroke="rgba(255,255,255,0.28)" strokeWidth="1" strokeDasharray="4 2"
          />
        )}

        {/* Snap dots at nearest data points */}
        {hover && hoverPoints.map(p => {
          const color = passColorMap.get(p.passId) ?? C.active;
          return (
            <circle
              key={p.passId}
              cx={px(p.ts).toFixed(1)} cy={py(p.value).toFixed(1)}
              r={3.5}
              fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth="1"
            />
          );
        })}
      </svg>

      {/* Tooltip */}
      {hover && hoverPoints.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 6,
          ...(hover.fracX < 0.65
            ? { left: `calc(${hover.fracX * 100}% + 10px)` }
            : { right: `calc(${(1 - hover.fracX) * 100}% + 10px)` }),
          backgroundColor: 'rgba(10,10,14,0.93)',
          border: `1px solid ${C.borderStrong}`,
          borderRadius: 4,
          padding: '5px 8px',
          fontFamily: C.fontMono,
          fontSize: 10,
          pointerEvents: 'none',
          zIndex: 10,
          minWidth: 130,
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}>
          <div style={{ color: C.textDisabled, fontSize: 9, marginBottom: 5 }}>
            {new Date(hoverPoints[0].ts).toISOString().slice(11, 23)} UTC
          </div>
          {hoverPoints.map(p => {
            const color = passColorMap.get(p.passId) ?? C.active;
            return (
              <div key={p.passId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                <span style={{ color: C.textPrimary, letterSpacing: '0.02em' }}>
                  {fmtTooltipValue(p.value)}
                </span>
                {unit && <span style={{ color: C.textDisabled }}>{unit}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function HistoryTab() {
  const { rows: rawPassRows } = useTableRows('passes', 10000);
  const passRows = rawPassRows as unknown as PassRow[];

  // All pass IDs in the DB
  const allPassIds = useMemo(() => passRows.map(r => Number(r.pass_id)), [passRows]);

  // Which passes are selected for display
  const [selectedPassIds, setSelectedPassIds] = useState<Set<number>>(new Set());

  // Materialization status: passId -> count of decoded rows
  const [decodeStatus, setDecodeStatus] = useState<Record<number, number>>({});
  const [materializing, setMaterializing] = useState<Set<number>>(new Set());

  // Available cmds + fields for selected passes
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  // Active command type
  const [activeCmd, setActiveCmd] = useState<string | null>(null);

  // Selected fields to plot
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  // Raw decoded data from server for activeCmd
  const [historyData, setHistoryData] = useState<DecodedRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Time range
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // Fetch decode status for all passes when pass list loads
  useEffect(() => {
    if (allPassIds.length === 0) return;
    fetch(`/api/history/status?passIds=${allPassIds.join(',')}`)
      .then(r => r.json() as Promise<Record<number, number>>)
      .then(setDecodeStatus)
      .catch(() => {});
  }, [allPassIds.join(',')]);

  // Fetch summary when selectedPassIds changes
  const selectedKey = [...selectedPassIds].sort().join(',');
  useEffect(() => {
    if (selectedPassIds.size === 0) { setSummary([]); setActiveCmd(null); return; }
    fetch(`/api/history/summary?passIds=${selectedKey}`)
      .then(r => r.json() as Promise<SummaryRow[]>)
      .then(rows => {
        setSummary(rows);
        // Auto-select first available cmd
        const cmds = [...new Set(rows.map(r => r.cmd_id))];
        setActiveCmd(prev => (prev && cmds.includes(prev) ? prev : cmds[0] ?? null));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Fetch data when selectedPassIds or activeCmd changes
  useEffect(() => {
    if (selectedPassIds.size === 0 || !activeCmd) { setHistoryData([]); return; }
    setDataLoading(true);
    fetch(`/api/history/data?passIds=${selectedKey}&cmd=${encodeURIComponent(activeCmd)}`)
      .then(r => r.json() as Promise<DecodedRow[]>)
      .then(rows => {
        setHistoryData(rows);
        setDataLoading(false);
        // Set time range from data if empty
        const times = rows.map(r => r.ts_ms).filter(t => t > 0);
        if (times.length > 0 && !rangeStart) {
          setRangeStart(msToInput(Math.min(...times)));
          setRangeEnd(msToInput(Math.max(...times)));
        }
      })
      .catch(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, activeCmd]);

  // Reset time range when cmd changes
  const prevCmd = useRef<string | null>(null);
  useEffect(() => {
    if (activeCmd !== prevCmd.current) {
      setRangeStart('');
      setRangeEnd('');
      prevCmd.current = activeCmd;
    }
  }, [activeCmd]);

  // Materialize a single pass
  const materialize = useCallback(async (passId: number) => {
    setMaterializing(prev => new Set([...prev, passId]));
    try {
      const r = await fetch('/api/history/materialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passId }),
      });
      const data = await r.json() as { count?: number; error?: string };
      if (!data.error) {
        setDecodeStatus(prev => ({ ...prev, [passId]: data.count ?? 0 }));
        // Re-fetch summary if this pass is selected
        if (selectedPassIds.has(passId)) {
          const sKey = [...selectedPassIds].sort().join(',');
          fetch(`/api/history/summary?passIds=${sKey}`)
            .then(res => res.json() as Promise<SummaryRow[]>)
            .then(setSummary)
            .catch(() => {});
        }
      }
    } finally {
      setMaterializing(prev => { const n = new Set(prev); n.delete(passId); return n; });
    }
  }, [selectedPassIds]);

  // Effective time range
  const effectiveRange = useMemo(() => {
    const times = historyData.map(r => r.ts_ms).filter(t => t > 0);
    const dataMin = times.length ? Math.min(...times) : 0;
    const dataMax = times.length ? Math.max(...times) : 0;
    const s = rangeStart ? inputToMs(rangeStart) : dataMin;
    const e = rangeEnd   ? inputToMs(rangeEnd)   : dataMax;
    return { start: s, end: e };
  }, [rangeStart, rangeEnd, historyData]);

  // Available cmds from summary
  const availCmds = useMemo(() => [...new Set(summary.map(r => r.cmd_id))].sort(), [summary]);

  // Available fields for active cmd
  const availFields = useMemo(
    () => summary.filter(r => r.cmd_id === activeCmd),
    [summary, activeCmd],
  );

  // Color per pass (deterministic by position in allPassIds)
  const passColorMap = useMemo(() => {
    const m = new Map<number, string>();
    passRows.forEach((p, i) => m.set(Number(p.pass_id), PASS_COLORS[i % PASS_COLORS.length]));
    return m;
  }, [passRows]);

  // Color per field
  const fieldColorMap = useMemo(() => {
    const m = new Map<string, string>();
    availFields.forEach((f, i) => m.set(f.field, LINE_COLORS[i % LINE_COLORS.length]));
    return m;
  }, [availFields]);

  // Build per-field series data, split by pass
  const seriesData = useMemo(() => {
    const filtered = historyData.filter(r =>
      r.ts_ms >= effectiveRange.start && r.ts_ms <= effectiveRange.end,
    );
    const map = new Map<string, Map<number, Series[]>>();
    for (const row of filtered) {
      if (!selectedFields.has(row.field)) continue;
      const v = parseFloat(row.value);
      if (isNaN(v)) continue;
      if (!map.has(row.field)) map.set(row.field, new Map());
      const byPass = map.get(row.field)!;
      if (!byPass.has(row.pass_id)) byPass.set(row.pass_id, []);
      byPass.get(row.pass_id)!.push({ ts: row.ts_ms, value: v, passId: row.pass_id });
    }
    return map;
  }, [historyData, selectedFields, effectiveRange]);

  const selectedFieldList = availFields.filter(f => selectedFields.has(f.field));

  const togglePass = useCallback((id: number) => {
    setSelectedPassIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleField = useCallback((field: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const hasData = historyData.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* Toolbar */}
      {hasData && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          padding: '6px 14px', borderBottom: `1px solid ${C.borderSubtle}`,
          backgroundColor: C.bgPanel,
        }}>
          <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            time range
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>from</span>
            <input type="datetime-local" value={rangeStart} onChange={e => setRangeStart(e.target.value)} style={dtInputStyle()} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>to</span>
            <input type="datetime-local" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} style={dtInputStyle()} />
          </div>
          <button
            onClick={() => {
              const times = historyData.map(r => r.ts_ms).filter(t => t > 0);
              if (times.length) {
                setRangeStart(msToInput(Math.min(...times)));
                setRangeEnd(msToInput(Math.max(...times)));
              }
            }}
            style={btnStyle('neutral')}
          >Reset</button>
          <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>UTC</span>
        </div>
      )}

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Left sidebar */}
        <div style={{
          width: 220, flexShrink: 0, borderRight: `1px solid ${C.borderSubtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          backgroundColor: C.bgPanel,
        }}>

          {/* Pass list */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px', borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              passes
            </span>
            <div style={{ display: 'flex', gap: 5 }}>
              <button onClick={() => setSelectedPassIds(new Set(allPassIds))} style={microBtnStyle()}>all</button>
              <button onClick={() => setSelectedPassIds(new Set())} style={microBtnStyle()}>none</button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {passRows.length === 0 ? (
              <div style={{ padding: '12px', fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
                no passes in database
              </div>
            ) : passRows.map(p => {
              const id = Number(p.pass_id);
              const checked = selectedPassIds.has(id);
              const color = passColorMap.get(id) ?? C.active;
              const cnt = decodeStatus[id];
              const isMat = materializing.has(id);
              return (
                <div key={id} style={{
                  borderBottom: `1px solid ${C.borderSubtle}`,
                  backgroundColor: checked ? `${color}0e` : 'transparent',
                }}>
                  <div
                    onClick={() => togglePass(id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px 4px', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = `${color}18`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                      backgroundColor: checked ? color : 'transparent',
                      border: `1.5px solid ${checked ? color : C.borderStrong}`,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 10.5, fontFamily: C.fontMono,
                        color: checked ? C.textPrimary : C.textMuted,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {p.session_id || `pass_${id}`}
                      </div>
                      <div style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled }}>
                        {fmtDate(p.pass_date, p.pass_time)} · {p.station || '—'}
                      </div>
                    </div>
                    {/* Decode status badge */}
                    {cnt != null && cnt > 0 ? (
                      <span style={{
                        fontSize: 8.5, fontFamily: C.fontMono, color: C.success,
                        backgroundColor: C.successFill, padding: '1px 4px', borderRadius: 2,
                        border: `1px solid ${C.success}44`, flexShrink: 0,
                      }}>{cnt}</span>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); void materialize(id); }}
                        disabled={isMat}
                        style={{
                          padding: '1px 5px', borderRadius: 2, cursor: isMat ? 'wait' : 'pointer',
                          fontSize: 8.5, fontFamily: C.fontMono, flexShrink: 0,
                          backgroundColor: C.bgApp, color: C.textDisabled,
                          border: `1px solid ${C.borderSubtle}`,
                        }}
                      >{isMat ? '…' : 'Decode'}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cmd + field selector */}
          {availCmds.length > 0 && (
            <>
              {/* Cmd tabs */}
              <div style={{
                padding: '5px 10px', borderTop: `1px solid ${C.borderStrong}`,
                borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0,
                display: 'flex', gap: 4, flexWrap: 'wrap', backgroundColor: C.bgApp,
              }}>
                {availCmds.map(cmd => (
                  <button
                    key={cmd}
                    onClick={() => { setActiveCmd(cmd); setSelectedFields(new Set()); }}
                    style={{
                      padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                      fontSize: 9.5, fontFamily: C.fontMono,
                      backgroundColor: cmd === activeCmd ? C.activeFill : 'transparent',
                      color: cmd === activeCmd ? C.active : C.textMuted,
                      border: `1px solid ${cmd === activeCmd ? `${C.active}44` : C.borderSubtle}`,
                    }}
                  >{cmd}</button>
                ))}
              </div>

              {/* Field header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 12px', borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0,
              }}>
                <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  fields
                </span>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button onClick={() => setSelectedFields(new Set(availFields.map(f => f.field)))} style={microBtnStyle()}>all</button>
                  <button onClick={() => setSelectedFields(new Set())} style={microBtnStyle()}>none</button>
                </div>
              </div>

              {/* Field checkboxes */}
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {availFields.map((f, i) => {
                  const checked = selectedFields.has(f.field);
                  const color = LINE_COLORS[i % LINE_COLORS.length];
                  return (
                    <div
                      key={f.field}
                      onClick={() => toggleField(f.field)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '3px 12px 3px 14px', cursor: 'pointer',
                        backgroundColor: checked ? `${color}10` : 'transparent',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = checked ? `${color}1e` : C.bgPanelRaised; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = checked ? `${color}10` : 'transparent'; }}
                    >
                      <div style={{
                        width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                        backgroundColor: checked ? color : 'transparent',
                        border: `1.5px solid ${checked ? color : C.borderStrong}`,
                      }} />
                      <span style={{
                        fontSize: 10.5, fontFamily: C.fontMono, flex: 1, minWidth: 0,
                        color: checked ? C.textPrimary : C.textMuted,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{f.field}</span>
                      {f.unit && (
                        <span style={{ fontSize: 8.5, fontFamily: C.fontMono, color: C.textDisabled, flexShrink: 0 }}>
                          {f.unit}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Chart area */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0, backgroundColor: C.bgApp }}>

          {/* Pass color legend (when >1 pass selected) */}
          {selectedPassIds.size > 1 && hasData && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '4px 14px',
              padding: '6px 14px', borderBottom: `1px solid ${C.borderSubtle}`,
              backgroundColor: C.bgPanel, flexShrink: 0,
            }}>
              {passRows.filter(p => selectedPassIds.has(Number(p.pass_id))).map(p => {
                const id = Number(p.pass_id);
                const color = passColorMap.get(id) ?? C.active;
                return (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
                    <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>
                      {p.session_id || `pass_${id}`} ({p.pass_date})
                    </span>
                  </span>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {selectedPassIds.size === 0 && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: 12, fontFamily: C.fontMono }}>
              select passes from the sidebar to begin
            </div>
          )}

          {selectedPassIds.size > 0 && !hasData && !dataLoading && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: 12, fontFamily: C.fontMono }}>
              {availCmds.length === 0
                ? 'no decoded telemetry — click Decode on the passes in the sidebar'
                : 'select fields to plot'}
            </div>
          )}

          {dataLoading && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: 12, fontFamily: C.fontMono }}>
              <span style={{ color: C.active }}>⟳</span>&nbsp;loading…
            </div>
          )}

          {!dataLoading && hasData && selectedFieldList.length === 0 && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: 12, fontFamily: C.fontMono }}>
              select fields from the sidebar to plot
            </div>
          )}

          {/* Charts — 2-column grid */}
          {!dataLoading && selectedFieldList.length > 0 && (
            <div style={{
              padding: '10px 12px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 4,
            }}>
              {selectedFieldList.map((f) => {
                const byPass = seriesData.get(f.field);
                const seriesArr = byPass
                  ? [...selectedPassIds].map(id => ({ passId: id, data: byPass.get(id) ?? [] }))
                  : [];
                const totalPts = seriesArr.reduce((s, x) => s + x.data.length, 0);
                return (
                  <div key={f.field} style={{
                    backgroundColor: C.bgPanel,
                    border: `1px solid ${C.borderSubtle}`,
                    borderRadius: 3, overflow: 'hidden',
                  }}>
                    {totalPts === 0 ? (
                      <div style={{
                        height: 78, display: 'flex', alignItems: 'center', padding: '0 14px',
                        fontFamily: C.fontMono, fontSize: 10, color: C.textDisabled,
                      }}>
                        {f.field}{f.unit ? ` (${f.unit})` : ''} — no numeric data in range
                      </div>
                    ) : (
                      <ParamChart
                        field={f.field}
                        unit={f.unit}
                        series={seriesArr}
                        passColorMap={passColorMap}
                        startMs={effectiveRange.start}
                        endMs={effectiveRange.end}
                        showXAxis={true}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────────────

function btnStyle(tone: 'active' | 'success' | 'danger' | 'info' | 'neutral'): React.CSSProperties {
  const colors: Record<string, [string, string]> = {
    active:  [C.active,   C.activeFill],
    success: [C.success,  C.successFill],
    danger:  [C.danger,   C.dangerFill],
    info:    [C.info,     C.infoFill],
    neutral: [C.neutral,  C.neutralFill],
  };
  const [fg, bg] = colors[tone] ?? colors.neutral;
  return {
    padding: '4px 12px', borderRadius: 3, cursor: 'pointer',
    fontSize: 11, fontFamily: C.fontMono, flexShrink: 0,
    backgroundColor: bg, color: fg,
    border: `1px solid ${fg}44`, outline: 'none',
  };
}

function microBtnStyle(): React.CSSProperties {
  return {
    padding: '2px 6px', borderRadius: 2, cursor: 'pointer',
    fontSize: 9, fontFamily: C.fontMono,
    backgroundColor: C.bgApp, color: C.textMuted,
    border: `1px solid ${C.borderSubtle}`, outline: 'none',
  };
}

function dtInputStyle(): React.CSSProperties {
  return {
    fontFamily: C.fontMono, fontSize: 11, color: C.textPrimary,
    backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`,
    borderRadius: 3, padding: '3px 6px', outline: 'none',
  };
}
