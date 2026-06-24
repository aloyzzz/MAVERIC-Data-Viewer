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

// ── Free-form layout ──────────────────────────────────────────────────────────

interface Layout { x: number; y: number; w: number; h: number }

const SNAP_PX         = 8;
const CHART_GAP       = 8;
const CHART_PAD       = 10;
const CHART_DEFAULT_H = 180;
const CHART_MIN_W     = 200;
const CHART_MIN_H     = 80;

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

function snap(v: number): number { return Math.round(v / SNAP_PX) * SNAP_PX; }

function fmtCmd(cmd: string): string {
  if (cmd.startsWith('param:')) return cmd.slice(6) + ' (params)';
  return cmd;
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
  field, unit, series, passColorMap, fieldColor, startMs, endMs, showXAxis,
}: {
  field: string;
  unit: string;
  series: { passId: number; data: Series[] }[];
  passColorMap: Map<number, string>;
  fieldColor?: string;
  startMs: number;
  endMs: number;
  showXAxis: boolean;
}) {
  const PAD_L = 62; const PAD_R = 12; const PAD_T = 8;
  const PAD_B = showXAxis ? 22 : 5;

  // Track actual container pixel size so viewBox always matches — prevents text distortion.
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 140 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = dims.w;
  const H = dims.h;
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

  const resolveColor = (passId: number) =>
    series.length === 1 && fieldColor ? fieldColor : (passColorMap.get(passId) ?? C.active);

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
  }, [startMs, tRange, cW, W]);

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
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
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

        {/* one polyline per pass */}
        {series.map(({ passId, data }) => {
          if (data.length === 0) return null;
          const color = resolveColor(passId);
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
          const color = resolveColor(p.passId);
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
            const color = resolveColor(p.passId);
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

// ── Field row (sidebar) ───────────────────────────────────────────────────────

function FieldRow({ f, i, fieldColorMap, selectedFields, toggleField }: {
  f: SummaryRow;
  i: number;
  fieldColorMap: Map<string, string>;
  selectedFields: Set<string>;
  toggleField: (field: string, cmdId: string) => void;
}) {
  const checked = selectedFields.has(f.field);
  const color = fieldColorMap.get(f.field) ?? LINE_COLORS[i % LINE_COLORS.length];
  return (
    <div
      onClick={() => toggleField(f.field, f.cmd_id)}
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

  // Active command types (multi-select)
  const [activeCmds, setActiveCmds] = useState<Set<string>>(new Set());

  // Selected fields to plot — persisted per command so toggling cmds doesn't wipe selections
  const [fieldSelectionByCmd, setFieldSelectionByCmd] = useState<Map<string, Set<string>>>(new Map());

  // Raw decoded data per command
  const [historyDataByCmd, setHistoryDataByCmd] = useState<Map<string, DecodedRow[]>>(new Map());
  const [dataLoading, setDataLoading] = useState(false);

  // Time range
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // Field search
  const [fieldSearch, setFieldSearch] = useState('');

  // Free-form chart layout
  const [layoutMap, setLayoutMap] = useState<Map<string, Layout>>(new Map());
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ field: string; startMX: number; startMY: number; startX: number; startY: number } | null>(null);
  const resizeRef = useRef<{
    field: string; corner: 'tl' | 'tr' | 'bl' | 'br';
    startMX: number; startMY: number;
    startX: number; startY: number; startW: number; startH: number;
  } | null>(null);

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
    if (selectedPassIds.size === 0) { setSummary([]); setActiveCmds(new Set()); return; }
    fetch(`/api/history/summary?passIds=${selectedKey}`)
      .then(r => r.json() as Promise<SummaryRow[]>)
      .then(rows => {
        setSummary(rows);
        // Auto-select first available cmd if nothing is active
        const cmds = [...new Set(rows.map(r => r.cmd_id))];
        setActiveCmds(prev => prev.size === 0 && cmds.length > 0 ? new Set([cmds[0]]) : prev);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Fetch data for all active cmds when passes or active cmds change
  const activeCmdsKey = [...activeCmds].sort().join(',');
  useEffect(() => {
    if (selectedPassIds.size === 0 || activeCmds.size === 0) {
      setHistoryDataByCmd(new Map());
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    const paramCmds = [...activeCmds].filter(c => c.startsWith('param:'));
    const decodedCmds = [...activeCmds].filter(c => !c.startsWith('param:'));

    // Fetch all param categories in one request, then split by cmd_id
    const paramPromise: Promise<[string, DecodedRow[]][]> = paramCmds.length === 0
      ? Promise.resolve([])
      : fetch(`/api/history/params?passIds=${selectedKey}`)
          .then(r => r.json() as Promise<DecodedRow[]>)
          .then(rows => {
            const byCmd = new Map<string, DecodedRow[]>();
            for (const row of rows) {
              if (!byCmd.has(row.cmd_id)) byCmd.set(row.cmd_id, []);
              byCmd.get(row.cmd_id)!.push(row);
            }
            return [...byCmd.entries()];
          });

    const decodedPromises = decodedCmds.map(cmd =>
      fetch(`/api/history/data?passIds=${selectedKey}&cmd=${encodeURIComponent(cmd)}`)
        .then(r => r.json() as Promise<DecodedRow[]>)
        .then(rows => [cmd, rows] as [string, DecodedRow[]]),
    );

    Promise.all([paramPromise, Promise.all(decodedPromises)])
      .then(([paramResults, decodedResults]) => {
        const results: [string, DecodedRow[]][] = [...paramResults, ...decodedResults];
        const next = new Map(results);
        setHistoryDataByCmd(next);
        setDataLoading(false);
        const allTimes = results.flatMap(([, rows]) => rows.map(r => r.ts_ms)).filter(t => t > 0);
        if (allTimes.length > 0 && !rangeStart) {
          setRangeStart(msToInput(Math.min(...allTimes)));
          setRangeEnd(msToInput(Math.max(...allTimes)));
        }
      }).catch(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, activeCmdsKey]);

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

  // Combined history data across all active cmds
  const historyData = useMemo(
    () => [...historyDataByCmd.values()].flat(),
    [historyDataByCmd],
  );

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

  // Available fields across all active cmds
  const availFields = useMemo(
    () => summary.filter(r => activeCmds.has(r.cmd_id)),
    [summary, activeCmds],
  );

  // Color per pass (deterministic by position in allPassIds)
  const passColorMap = useMemo(() => {
    const m = new Map<number, string>();
    passRows.forEach((p, i) => m.set(Number(p.pass_id), PASS_COLORS[i % PASS_COLORS.length]));
    return m;
  }, [passRows]);

  // Color per field — keyed from the full summary list so indices never shift when
  // categories are toggled on/off.
  const fieldColorMap = useMemo(() => {
    const m = new Map<string, string>();
    summary.forEach((f, i) => m.set(f.field, LINE_COLORS[i % LINE_COLORS.length]));
    return m;
  }, [summary]);

  // Union of all selected fields across active cmds
  const selectedFields = useMemo(() => {
    const all = new Set<string>();
    activeCmds.forEach(cmd => {
      (fieldSelectionByCmd.get(cmd) ?? new Set<string>()).forEach(f => all.add(f));
    });
    return all;
  }, [fieldSelectionByCmd, activeCmds]);

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

  const selectedFieldList = availFields.filter(f => {
    const cmdFields = fieldSelectionByCmd.get(f.cmd_id) ?? new Set<string>();
    return cmdFields.has(f.field);
  });

  const togglePass = useCallback((id: number) => {
    setSelectedPassIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleCmd = useCallback((cmd: string) => {
    setActiveCmds(prev => {
      const next = new Set(prev);
      if (next.has(cmd)) next.delete(cmd); else next.add(cmd);
      return next;
    });
  }, []);

  const toggleField = useCallback((field: string, cmdId: string) => {
    setFieldSelectionByCmd(prev => {
      const cur = prev.get(cmdId) ?? new Set<string>();
      const next = new Set(cur);
      if (next.has(field)) next.delete(field); else next.add(field);
      return new Map(prev).set(cmdId, next);
    });
  }, []);

  // ── Layout init (assign default positions to newly-selected fields) ─────

  const fieldKey = selectedFieldList.map(f => f.field).join(',');
  useEffect(() => {
    const containerW = chartAreaRef.current?.clientWidth ?? 800;
    const colW = snap(Math.max(CHART_MIN_W, Math.floor((containerW - CHART_PAD * 2 - CHART_GAP) / 2)));
    setLayoutMap(prev => {
      const next = new Map(prev);
      let nextSlot = prev.size;
      let changed = false;
      selectedFieldList.forEach(f => {
        if (!next.has(f.field)) {
          const col = nextSlot % 2;
          const row = Math.floor(nextSlot / 2);
          next.set(f.field, {
            x: snap(CHART_PAD + col * (colW + CHART_GAP)),
            y: snap(CHART_PAD + row * (CHART_DEFAULT_H + CHART_GAP)),
            w: colW,
            h: CHART_DEFAULT_H,
          });
          nextSlot++;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey]);

  // ── Drag handler ─────────────────────────────────────────────────────────

  function onHeaderMouseDown(e: React.MouseEvent, field: string) {
    e.preventDefault();
    const layout = layoutMap.get(field);
    if (!layout) return;
    dragRef.current = { field, startMX: e.clientX, startMY: e.clientY, startX: layout.x, startY: layout.y };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const { startMX, startMY, startX, startY, field: f } = dragRef.current;
      const newX = Math.max(0, snap(startX + ev.clientX - startMX));
      const newY = Math.max(0, snap(startY + ev.clientY - startMY));
      setLayoutMap(prev => {
        const cur = prev.get(f);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(f, { ...cur, x: newX, y: newY });
        return next;
      });
    }

    function onUp() {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Resize handler ────────────────────────────────────────────────────────

  function onResizeMouseDown(e: React.MouseEvent, field: string, corner: 'tl' | 'tr' | 'bl' | 'br') {
    e.preventDefault();
    e.stopPropagation();
    const layout = layoutMap.get(field);
    if (!layout) return;
    const cursorMap = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' };
    resizeRef.current = {
      field, corner,
      startMX: e.clientX, startMY: e.clientY,
      startX: layout.x, startY: layout.y, startW: layout.w, startH: layout.h,
    };
    document.body.style.cursor = cursorMap[corner];
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      if (!resizeRef.current) return;
      const { startMX, startMY, startX, startY, startW, startH, field: f, corner: c } = resizeRef.current;
      const dx = ev.clientX - startMX;
      const dy = ev.clientY - startMY;
      let newX = startX, newY = startY;
      let newW = startW, newH = startH;

      if (c === 'br') {
        newW = Math.max(CHART_MIN_W, snap(startW + dx));
        newH = Math.max(CHART_MIN_H, snap(startH + dy));
      } else if (c === 'bl') {
        newW = Math.max(CHART_MIN_W, snap(startW - dx));
        newX = Math.max(0, snap(startX + startW - newW));
        newH = Math.max(CHART_MIN_H, snap(startH + dy));
      } else if (c === 'tr') {
        newW = Math.max(CHART_MIN_W, snap(startW + dx));
        newH = Math.max(CHART_MIN_H, snap(startH - dy));
        newY = Math.max(0, snap(startY + startH - newH));
      } else {
        newW = Math.max(CHART_MIN_W, snap(startW - dx));
        newX = Math.max(0, snap(startX + startW - newW));
        newH = Math.max(CHART_MIN_H, snap(startH - dy));
        newY = Math.max(0, snap(startY + startH - newH));
      }

      setLayoutMap(prev => {
        const cur = prev.get(f);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(f, { x: newX, y: newY, w: newW, h: newH });
        return next;
      });
    }

    function onUp() {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Canvas height ─────────────────────────────────────────────────────────

  const canvasH = useMemo(() => {
    let h = 300;
    layoutMap.forEach(l => { h = Math.max(h, l.y + l.h + CHART_PAD); });
    return h;
  }, [layoutMap]);

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
              {/* Cmd toggles (multi-select) */}
              <div style={{
                padding: '5px 10px', borderTop: `1px solid ${C.borderStrong}`,
                borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0,
                display: 'flex', gap: 4, flexWrap: 'wrap', backgroundColor: C.bgApp,
              }}>
                {availCmds.map(cmd => {
                  const on = activeCmds.has(cmd);
                  return (
                    <button
                      key={cmd}
                      onClick={() => toggleCmd(cmd)}
                      style={{
                        padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                        fontSize: 9.5, fontFamily: C.fontMono,
                        backgroundColor: on ? C.activeFill : 'transparent',
                        color: on ? C.active : C.textMuted,
                        border: `1px solid ${on ? `${C.active}44` : C.borderSubtle}`,
                      }}
                    >{fmtCmd(cmd)}</button>
                  );
                })}
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
                  <button onClick={() => {
                    setFieldSelectionByCmd(prev => {
                      const next = new Map(prev);
                      activeCmds.forEach(cmd => {
                        next.set(cmd, new Set(availFields.filter(f => f.cmd_id === cmd).map(f => f.field)));
                      });
                      return next;
                    });
                  }} style={microBtnStyle()}>all</button>
                  <button onClick={() => {
                    setFieldSelectionByCmd(prev => {
                      const next = new Map(prev);
                      activeCmds.forEach(cmd => next.set(cmd, new Set()));
                      return next;
                    });
                  }} style={microBtnStyle()}>none</button>
                </div>
              </div>

              {/* Field search */}
              <div style={{ padding: '4px 10px', borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0 }}>
                <input
                  type="text"
                  placeholder="search fields…"
                  value={fieldSearch}
                  onChange={e => setFieldSearch(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    fontFamily: C.fontMono, fontSize: 10.5, color: C.textPrimary,
                    backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`,
                    borderRadius: 3, padding: '3px 7px', outline: 'none',
                  }}
                />
              </div>

              {/* Field checkboxes — grouped by cmd when multiple active */}
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {(() => {
                  const q = fieldSearch.trim().toLowerCase();
                  const filtered = q
                    ? availFields.filter(f => f.field.toLowerCase().includes(q))
                    : availFields;
                  if (filtered.length === 0) return (
                    <div style={{ padding: '10px 14px', fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
                      no matches
                    </div>
                  );
                  if (activeCmds.size > 1 && !q) {
                    return [...activeCmds].sort().map(cmd => {
                      const cmdFields = filtered.filter(f => f.cmd_id === cmd);
                      if (cmdFields.length === 0) return null;
                      return (
                        <div key={cmd}>
                          <div style={{
                            padding: '3px 12px', fontSize: 8.5, fontFamily: C.fontMono,
                            color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.08em',
                            backgroundColor: C.bgApp, borderBottom: `1px solid ${C.borderSubtle}`,
                          }}>{fmtCmd(cmd)}</div>
                          {cmdFields.map((f, i) => <FieldRow key={f.cmd_id + ':' + f.field} f={f} i={i} fieldColorMap={fieldColorMap} selectedFields={selectedFields} toggleField={toggleField} />)}
                        </div>
                      );
                    });
                  }
                  return filtered.map((f, i) => (
                    <FieldRow key={f.cmd_id + ':' + f.field} f={f} i={i} fieldColorMap={fieldColorMap} selectedFields={selectedFields} toggleField={toggleField} />
                  ));
                })()}
              </div>
            </>
          )}
        </div>

        {/* Chart area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>

          {/* Always-visible selected fields strip */}
          {availCmds.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px',
              padding: '5px 12px', borderBottom: `1px solid ${C.borderSubtle}`,
              backgroundColor: C.bgPanel, flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0, marginRight: 2 }}>
                plotting
              </span>
              {selectedFields.size === 0 ? (
                <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
                  no fields selected — pick from sidebar
                </span>
              ) : (
                [...selectedFields].map(field => {
                  const color = fieldColorMap.get(field) ?? C.active;
                  const info = availFields.find(f => f.field === field);
                  return (
                    <span
                      key={field}
                      onClick={() => info && toggleField(field, info.cmd_id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                        backgroundColor: `${color}18`,
                        border: `1px solid ${color}55`,
                        fontSize: 10.5, fontFamily: C.fontMono, color,
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                      {field}{info?.unit ? ` (${info.unit})` : ''}
                      <span style={{ opacity: 0.45, fontSize: 10, marginLeft: 1 }}>×</span>
                    </span>
                  );
                })
              )}
            </div>
          )}

          {/* Scrollable content */}
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
                  : activeCmds.size === 0
                  ? 'select a telemetry category from the sidebar'
                  : 'select fields to plot'}
              </div>
            )}

            {/* Full-screen spinner only when there are no charts to show yet */}
            {dataLoading && selectedFieldList.length === 0 && (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: 12, fontFamily: C.fontMono }}>
                <span style={{ color: C.active }}>⟳</span>&nbsp;loading…
              </div>
            )}

            {!dataLoading && hasData && selectedFieldList.length === 0 && (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: 12, fontFamily: C.fontMono }}>
                select fields from the sidebar to plot
              </div>
            )}

            {/* Charts — keep mounted during loading so cards/ResizeObservers don't reset */}
            {selectedFieldList.length > 0 && (
              <div ref={chartAreaRef} style={{ position: 'relative', height: canvasH }}>
                {/* Inline loading badge — doesn't unmount the canvas */}
                {dataLoading && (
                  <div style={{
                    position: 'absolute', top: 8, right: 12, zIndex: 20,
                    display: 'flex', alignItems: 'center', gap: 5,
                    backgroundColor: 'rgba(10,10,14,0.82)',
                    border: `1px solid ${C.borderSubtle}`,
                    borderRadius: 4, padding: '3px 8px',
                    fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled,
                  }}>
                    <span style={{ color: C.active }}>⟳</span> loading…
                  </div>
                )}
                {selectedFieldList.map((f) => {
                  const layout = layoutMap.get(f.field);
                  if (!layout) return null;
                  const byPass = seriesData.get(f.field);
                  const seriesArr = byPass
                    ? [...selectedPassIds].map(id => ({ passId: id, data: byPass.get(id) ?? [] }))
                    : [];
                  const totalPts = seriesArr.reduce((s, x) => s + x.data.length, 0);
                  const fieldColor = fieldColorMap.get(f.field) ?? C.active;
                  return (
                    <div
                      key={f.field}
                      style={{
                        position: 'absolute',
                        left: layout.x, top: layout.y,
                        width: layout.w, height: layout.h,
                        backgroundColor: C.bgPanel,
                        border: `1px solid ${C.borderSubtle}`,
                        borderRadius: 4,
                        overflow: 'hidden',
                        display: 'flex', flexDirection: 'column',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Header — drag handle */}
                      <div
                        style={{
                          padding: '5px 10px',
                          borderBottom: `1px solid ${C.borderSubtle}`,
                          display: 'flex', alignItems: 'center', gap: 7,
                          backgroundColor: `${fieldColor}0d`,
                          cursor: 'grab', flexShrink: 0, userSelect: 'none',
                        }}
                        onMouseDown={(e) => onHeaderMouseDown(e, f.field)}
                      >
                        <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: fieldColor, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontFamily: C.fontMono, color: C.textPrimary }}>
                          {f.field}
                        </span>
                        {f.unit && (
                          <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
                            {f.unit}
                          </span>
                        )}
                        <div style={{ flex: 1 }} />
                        {totalPts === 0 && (
                          <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>
                            no numeric data in range
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: C.textDisabled, opacity: 0.4, marginLeft: 6 }}>⠿</span>
                      </div>

                      {/* Chart body — fills remaining height */}
                      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                        {totalPts > 0 && (
                          <ParamChart
                            field={f.field}
                            unit={f.unit}
                            series={seriesArr}
                            passColorMap={passColorMap}
                            fieldColor={fieldColor}
                            startMs={effectiveRange.start}
                            endMs={effectiveRange.end}
                            showXAxis={true}
                          />
                        )}
                        {totalPts === 0 && <div style={{ height: '100%' }} />}
                      </div>

                      {/* Corner resize handles */}
                      {([
                        { corner: 'tl', top: 0,    left: 0,   right: undefined, bottom: undefined, borderRadius: '4px 0 0 0', cursor: 'nw-resize', borderTop: true,  borderLeft: true,  borderRight: false, borderBottom: false },
                        { corner: 'tr', top: 0,    left: undefined, right: 0,   bottom: undefined, borderRadius: '0 4px 0 0', cursor: 'ne-resize', borderTop: true,  borderLeft: false, borderRight: true,  borderBottom: false },
                        { corner: 'bl', top: undefined, left: 0,   right: undefined, bottom: 0,   borderRadius: '0 0 0 4px', cursor: 'sw-resize', borderTop: false, borderLeft: true,  borderRight: false, borderBottom: true  },
                        { corner: 'br', top: undefined, left: undefined, right: 0, bottom: 0,     borderRadius: '0 0 4px 0', cursor: 'se-resize', borderTop: false, borderLeft: false, borderRight: true,  borderBottom: true  },
                      ] as const).map(({ corner, top, left, right, bottom, borderRadius, cursor, borderTop: bT, borderLeft: bL, borderRight: bR, borderBottom: bB }) => (
                        <div
                          key={corner}
                          style={{
                            position: 'absolute', top, left, right, bottom,
                            width: 14, height: 14, cursor, zIndex: 2, opacity: 0.55,
                            borderTop:    bT ? `3px solid ${C.borderStrong}` : undefined,
                            borderLeft:   bL ? `3px solid ${C.borderStrong}` : undefined,
                            borderRight:  bR ? `3px solid ${C.borderStrong}` : undefined,
                            borderBottom: bB ? `3px solid ${C.borderStrong}` : undefined,
                            borderRadius,
                          }}
                          onMouseDown={(e) => onResizeMouseDown(e, f.field, corner)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
