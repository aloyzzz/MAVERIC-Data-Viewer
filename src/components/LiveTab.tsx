import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { C } from '../lib/colors';
import { useTz, fmtMs as tzFmtMs, fmtMsTime, msToInput as tzMsToInput, inputToMs as tzInputToMs } from '../lib/timezone';
import { useTableRows, useAllParameters } from '../hooks/useApi';

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
interface HoverState { svgX: number; cursorTs: number; fracX: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const LINE_COLORS = [
  '#4ade80', '#22d3ee', '#f59e0b', '#60a5fa', '#f87171',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#e879f9',
];

const PASS_COLORS = LINE_COLORS;

const DOMAIN_ORDER = ['spacecraft', 'gnc', 'eps', 'imaging', 'hk', 'ppm', 'cfg', 'params', 'other'];

const CHART_GAP    = 8;
const CHART_PAD    = 10;
const GRID_CHART_H = 220;
const SOURCE_MIN_VISIBLE = 6;
const SOURCE_SIGNIFICANT_FRACTION = 0.05;
const FILE_SIGNAL_FIELDS = new Set([
  'filename', 'chunk_idx', 'chunk_len', 'chunk_data',
  'num_chunks', 'thumb_filename', 'thumb_num_chunks',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// msToInput and inputToMs are timezone-aware; call the module-level helpers with tz from context
function fmtY(v: number): string {
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(2);
  return parseFloat(v.toPrecision(4)).toString();
}
function fmtDate(d: string, t: string) { return `${d} ${t}`.trim() || '—'; }
function fmtTzRange(minMs: number, maxMs: number, tz: import('../lib/timezone').Tz): string {
  if (!minMs) return '';
  return `${tzFmtMs(minMs, tz).slice(0, 16)} → ${tzFmtMs(maxMs, tz).slice(0, 16)} ${tz}`;
}

function fmtCmd(cmd: string): string {
  return cmd.startsWith('param:') ? cmd.slice(6) + ' · params' : cmd;
}

function signalKey(cmdId: string, field: string): string {
  return `${cmdId}::${field}`;
}

function fieldDomain(cmdId: string, field: string, domainMap: Map<string, string>): string {
  if (cmdId.startsWith('param:')) return domainMap.get(field) ?? 'params';
  if (cmdId === 'eps_hk') return 'eps';
  if (cmdId === 'mag_tlm') return 'gnc';
  if (cmdId.includes('img') || cmdId.includes('cam')) return 'imaging';
  if (cmdId.includes('ppm')) return 'ppm';
  if (cmdId.includes('cfg')) return 'cfg';
  if (cmdId === 'tlm_beacon') {
    if (field.startsWith('eps_')) return 'eps';
    if (['rate_x','rate_y','rate_z','mag_x','mag_y','mag_z','mtq_x','mtq_y','mtq_z','gnc_mode','adcs_tmp'].includes(field)) return 'gnc';
    return 'spacecraft';
  }
  return 'other';
}

function isLikelyNumericSignal(f: SummaryRow): boolean {
  if (f.unit) return true;
  return /^(rate_|mag_|mtq_|eps_|gnc_|v_|i_|p_|d_mag_|mag\d_|mag_timestamp|temp|adcs_tmp|t_die|ts_adc|reg\.|chunk_idx|chunk_len|num_chunks|thumb_num_chunks)/i.test(f.field);
}

function isFileSignal(f: SummaryRow): boolean {
  return f.cmd_id.endsWith('_get_chunks') || FILE_SIGNAL_FIELDS.has(f.field);
}

// ── ParamChart ─────────────────────────────────────────────────────────────────

function ParamChart({
  field, unit, series, passColorMap, fieldColor, startMs, endMs, showXAxis,
}: {
  field: string; unit: string;
  series: { passId: number; data: Series[] }[];
  passColorMap: Map<number, string>;
  fieldColor?: string;
  startMs: number; endMs: number; showXAxis: boolean;
}) {
  const { tz } = useTz();
  const PAD_L = 62; const PAD_R = 12; const PAD_T = 8;
  const PAD_B = showXAxis ? 22 : 5;

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

  const W = dims.w; const H = dims.h;
  const cW = W - PAD_L - PAD_R; const cH = H - PAD_T - PAD_B;
  const tRange = endMs - startMs || 1;

  const allVals = series.flatMap(s => s.data.map(d => d.value));
  const yMin = allVals.length ? Math.min(...allVals) : 0;
  const yMax = allVals.length ? Math.max(...allVals) : 1;
  const yPad = yMin === yMax ? Math.max(Math.abs(yMin) * 0.05, 0.001) : 0;
  const yLo = yMin - yPad; const yHi = yMax + yPad; const yRange = yHi - yLo || 1;

  const px = (ts: number) => PAD_L + ((ts - startMs) / tRange) * cW;
  const py = (v: number)  => PAD_T + cH - ((v - yLo) / yRange) * cH;

  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const ms = startMs + (i / 4) * tRange;
    return { x: PAD_L + (i / 4) * cW, label: fmtMsTime(ms, tz) };
  });

  const resolveLineColor = () =>
    fieldColor ?? C.active;
  const resolvePointColor = (passId: number) =>
    passColorMap.get(passId) ?? fieldColor ?? C.active;

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

  const hoverPoints = useMemo(() => {
    if (!hover) return [];
    return series.flatMap(s => {
      const pt = nearestPoint(s.data, hover.cursorTs);
      if (!pt) return [];
      return [{ passId: pt.passId, ts: pt.ts, value: pt.value }];
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
        <line x1={PAD_L} y1={PAD_T}      x2={PAD_L}     y2={PAD_T + cH} stroke={C.borderStrong} strokeWidth="0.6" />
        <line x1={PAD_L} y1={PAD_T + cH} x2={W - PAD_R} y2={PAD_T + cH} stroke={C.borderStrong} strokeWidth="0.6" />
        {series.map(({ passId, data }) => {
          if (data.length === 0) return null;
          const pts = data.map(d => `${px(d.ts).toFixed(1)},${py(d.value).toFixed(1)}`).join(' ');
          if (data.length === 1) {
            return <circle key={passId} cx={px(data[0].ts).toFixed(1)} cy={py(data[0].value).toFixed(1)}
              r={2.5} fill={resolveLineColor()} />;
          }
          return <polyline key={passId} points={pts} fill="none" stroke={resolveLineColor()} strokeWidth="1.4" />;
        })}
        {showXAxis && xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 3} textAnchor="middle" fontSize="7" fill={C.textDisabled} fontFamily="monospace">
            {t.label}
          </text>
        ))}
        {hover && (
          <line x1={hover.svgX} x2={hover.svgX} y1={PAD_T} y2={PAD_T + cH}
            stroke="rgba(255,255,255,0.28)" strokeWidth="1" strokeDasharray="4 2" />
        )}
        {hover && hoverPoints.map(p => (
          <circle key={p.passId}
            cx={px(p.ts).toFixed(1)} cy={py(p.value).toFixed(1)}
            r={3.5} fill={resolvePointColor(p.passId)} stroke="rgba(0,0,0,0.5)" strokeWidth="1" />
        ))}
      </svg>
      {hover && hoverPoints.length > 0 && (
        <div style={{
          position: 'absolute', top: 6,
          ...(hover.fracX < 0.65
            ? { left: `calc(${hover.fracX * 100}% + 10px)` }
            : { right: `calc(${(1 - hover.fracX) * 100}% + 10px)` }),
          backgroundColor: 'rgba(10,10,14,0.93)',
          border: `1px solid ${C.borderStrong}`,
          borderRadius: 4, padding: '5px 8px',
          fontFamily: C.fontMono, fontSize: 10,
          pointerEvents: 'none', zIndex: 10, minWidth: 130,
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
        }}>
          <div style={{ color: C.textDisabled, fontSize: 9, marginBottom: 5 }}>
            {fmtMsTime(hoverPoints[0].ts, tz)} {tz}
          </div>
          {hoverPoints.map(p => (
            <div key={p.passId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: resolvePointColor(p.passId), flexShrink: 0 }} />
              <span style={{ color: C.textPrimary, letterSpacing: '0.02em' }}>{fmtTooltipValue(p.value)}</span>
              {unit && <span style={{ color: C.textDisabled }}>{unit}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FieldRow ──────────────────────────────────────────────────────────────────

function FieldRow({ f, i, fieldColorMap, selectedFields, toggleField }: {
  f: SummaryRow; i: number;
  fieldColorMap: Map<string, string>;
  selectedFields: Set<string>;
  toggleField: (field: string, cmdId: string) => void;
}) {
  const key = signalKey(f.cmd_id, f.field);
  const checked = selectedFields.has(key);
  const color = fieldColorMap.get(key) ?? LINE_COLORS[i % LINE_COLORS.length];
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
      <span style={{ fontSize: 8.5, fontFamily: C.fontMono, color: C.textDisabled, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
        {fmtCmd(f.cmd_id)}
      </span>
      {f.unit && (
        <span style={{ fontSize: 8.5, fontFamily: C.fontMono, color: C.textDisabled, flexShrink: 0 }}>
          {f.unit}
        </span>
      )}
    </div>
  );
}

// ── ChartCard ─────────────────────────────────────────────────────────────────

const CHART_MIN_H = 80;

function ChartCard({
  f, fieldKey, fieldColor, fieldColorMap, seriesData, selectedPassIds, passColorMap, effectiveRange,
  height, onResizeMouseDown,
}: {
  f: SummaryRow;
  fieldKey: string;
  fieldColor: string;
  fieldColorMap: Map<string, string>;
  seriesData: Map<string, Map<number, Series[]>>;
  selectedPassIds: Set<number>;
  passColorMap: Map<number, string>;
  effectiveRange: { start: number; end: number };
  height: number;
  onResizeMouseDown: (e: React.MouseEvent, field: string) => void;
}) {
  const byPass = seriesData.get(fieldKey);
  // Merge all pass data into one time-sorted series so sparse fields (e.g. one
  // eps_hk reading per pass) render as a single continuous line rather than N
  // disconnected per-pass segments. passId is preserved per data point for hover.
  const seriesArr: { passId: number; data: Series[] }[] = byPass ? (() => {
    const merged = [...selectedPassIds]
      .flatMap(id => byPass.get(id) ?? [])
      .sort((a, b) => a.ts - b.ts);
    return merged.length ? [{ passId: -1, data: merged }] : [];
  })() : [];
  const totalPts = seriesArr.reduce((s, x) => s + x.data.length, 0);

  return (
    <div style={{
      backgroundColor: C.bgPanel, border: `1px solid ${C.borderSubtle}`,
      borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      height, boxSizing: 'border-box', position: 'relative',
    }}>
      <div style={{
        padding: '5px 10px',
        borderBottom: `1px solid ${C.borderSubtle}`,
        display: 'flex', alignItems: 'center', gap: 7,
        backgroundColor: `${fieldColor}0d`,
        flexShrink: 0, userSelect: 'none',
      }}>
        <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: fieldColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontFamily: C.fontMono, color: C.textPrimary }}>{f.field}</span>
        {f.unit && <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>{f.unit}</span>}
        <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled }}>{fmtCmd(f.cmd_id)}</span>
        <div style={{ flex: 1 }} />
        {totalPts === 0 && (
          <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>no numeric data in range</span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {totalPts > 0 && (
          <ParamChart
            field={f.field} unit={f.unit} series={seriesArr}
            passColorMap={passColorMap} fieldColor={fieldColorMap.get(fieldKey) ?? C.active}
            startMs={effectiveRange.start} endMs={effectiveRange.end} showXAxis={true}
          />
        )}
      </div>
      {/* Bottom resize handle */}
      <div
        onMouseDown={e => onResizeMouseDown(e, fieldKey)}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 6, cursor: 'ns-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{ width: 24, height: 2, borderRadius: 1, backgroundColor: C.borderStrong, opacity: 0.5 }} />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function HistoryTab({ dataRefreshKey = 0 }: { dataRefreshKey?: number }) {
  const { tz } = useTz();
  const { rows: rawPassRows } = useTableRows('passes', 10000);
  const passRows = rawPassRows as unknown as PassRow[];
  const { rows: allParamRows } = useAllParameters();

  const allPassIds = useMemo(() => passRows.map(r => Number(r.pass_id)), [passRows]);

  // Density filters for Signals tab
  const [densityFilter, setDensityFilter] = useState<Set<string>>(new Set(['numeric', 'hideFile']));
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [passListExpanded, setPassListExpanded] = useState(false);
  // Collapse the left control panel (pass scope + signals) into a thin rail
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Expand selected-fields strip
  const [showAllSelected, setShowAllSelected] = useState(false);
  // Expand low-volume source categories
  const [showAllSources, setShowAllSources] = useState(false);

  const [selectedPassIds, setSelectedPassIds] = useState<Set<number>>(new Set());
  const [decodeStatus, setDecodeStatus]       = useState<Record<number, number>>({});
  const [materializing, setMaterializing]     = useState<Set<number>>(new Set());
  const [summary, setSummary]                 = useState<SummaryRow[]>([]);
  const [activeCmds, setActiveCmds]           = useState<Set<string>>(new Set());
  const [fieldSelectionByCmd, setFieldSelectionByCmd] = useState<Map<string, Set<string>>>(new Map());
  const [historyDataByCmd, setHistoryDataByCmd]       = useState<Map<string, DecodedRow[]>>(new Map());
  const [dataLoading, setDataLoading]         = useState(false);
  const [rangeStart, setRangeStart]           = useState('');
  const [rangeEnd, setRangeEnd]               = useState('');
  const [fieldSearch, setFieldSearch]         = useState('');
  const [cardHeights, setCardHeights]         = useState<Map<string, number>>(new Map());
  const resizeRef = useRef<{ field: string; startMY: number; startH: number } | null>(null);

  // Domain map from catalog
  const paramDomainMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of allParamRows) {
      if (r.domain) m.set(r.name, r.domain);
    }
    return m;
  }, [allParamRows]);

  // ── Data effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (allPassIds.length === 0) return;
    fetch(`/api/history/status?passIds=${allPassIds.join(',')}`)
      .then(r => r.json() as Promise<Record<number, number>>)
      .then(setDecodeStatus)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPassIds.join(',')]);

  const selectedKey = [...selectedPassIds].sort().join(',');
  useEffect(() => {
    if (selectedPassIds.size === 0) { setSummary([]); setActiveCmds(new Set()); return; }
    fetch(`/api/history/summary?passIds=${selectedKey}`)
      .then(r => r.json() as Promise<SummaryRow[]>)
      .then(rows => {
        setSummary(rows);
        const cmds = [...new Set(rows.map(r => r.cmd_id))];
        setActiveCmds(prev => prev.size === 0 && cmds.length > 0 ? new Set(cmds) : prev);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, dataRefreshKey]);

  const activeCmdsKey = [...activeCmds].sort().join(',');
  useEffect(() => {
    if (selectedPassIds.size === 0 || activeCmds.size === 0) {
      setHistoryDataByCmd(new Map());
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    const paramCmds   = [...activeCmds].filter(c => c.startsWith('param:'));
    const decodedCmds = [...activeCmds].filter(c => !c.startsWith('param:'));

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
          setRangeStart(tzMsToInput(Math.min(...allTimes), tz));
          setRangeEnd(tzMsToInput(Math.max(...allTimes), tz));
        }
      }).catch(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, activeCmdsKey, dataRefreshKey]);

  // ── Materialize ─────────────────────────────────────────────────────────────

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

  const decodableSelected = useMemo(
    () => [...selectedPassIds].filter(id => !(decodeStatus[id] > 0)),
    [selectedPassIds, decodeStatus],
  );

  const decodeSelected = useCallback(() => {
    decodableSelected.forEach(id => { void materialize(id); });
  }, [decodableSelected, materialize]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const historyData = useMemo(() => [...historyDataByCmd.values()].flat(), [historyDataByCmd]);

  const effectiveRange = useMemo(() => {
    const times = historyData.map(r => r.ts_ms).filter(t => t > 0);
    const dataMin = times.length ? Math.min(...times) : 0;
    const dataMax = times.length ? Math.max(...times) : 0;
    const s = rangeStart ? tzInputToMs(rangeStart, tz) : dataMin;
    const e = rangeEnd   ? tzInputToMs(rangeEnd,   tz) : dataMax;
    return { start: s, end: e };
  }, [rangeStart, rangeEnd, historyData]);

  const availCmds = useMemo(() => [...new Set(summary.map(r => r.cmd_id))].sort(), [summary]);

  const sourceItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of summary) {
      counts.set(row.cmd_id, (counts.get(row.cmd_id) ?? 0) + Number(row.count || 0));
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    return availCmds
      .map(cmd => {
        const count = counts.get(cmd) ?? 0;
        return {
          cmd,
          count,
          significant: total === 0 || count / total >= SOURCE_SIGNIFICANT_FRACTION,
        };
      })
      .sort((a, b) => b.count - a.count || fmtCmd(a.cmd).localeCompare(fmtCmd(b.cmd)));
  }, [availCmds, summary]);

  const visibleSourceItems = useMemo(() => {
    if (showAllSources) return sourceItems;
    return sourceItems.filter((item, i) =>
      i < SOURCE_MIN_VISIBLE || item.significant || activeCmds.has(item.cmd),
    );
  }, [sourceItems, showAllSources, activeCmds]);

  const hiddenSourceCount = sourceItems.length - visibleSourceItems.length;

  const availFields = useMemo(
    () => summary.filter(r => activeCmds.has(r.cmd_id)),
    [summary, activeCmds],
  );

  const passColorMap = useMemo(() => {
    const m = new Map<number, string>();
    passRows.forEach((p, i) => m.set(Number(p.pass_id), PASS_COLORS[i % PASS_COLORS.length]));
    return m;
  }, [passRows]);

  const fieldColorMap = useMemo(() => {
    const m = new Map<string, string>();
    summary.forEach((f, i) => m.set(signalKey(f.cmd_id, f.field), LINE_COLORS[i % LINE_COLORS.length]));
    return m;
  }, [summary]);

  const selectedFields = useMemo(() => {
    const all = new Set<string>();
    activeCmds.forEach(cmd => {
      (fieldSelectionByCmd.get(cmd) ?? new Set<string>()).forEach(f => all.add(signalKey(cmd, f)));
    });
    return all;
  }, [fieldSelectionByCmd, activeCmds]);

  const selectedFieldList = availFields.filter(f => {
    const cmdFields = fieldSelectionByCmd.get(f.cmd_id) ?? new Set<string>();
    return cmdFields.has(f.field);
  });

  const seriesData = useMemo(() => {
    const filtered = historyData.filter(r =>
      r.ts_ms >= effectiveRange.start && r.ts_ms <= effectiveRange.end,
    );
    const map = new Map<string, Map<number, Series[]>>();
    for (const row of filtered) {
      const key = signalKey(row.cmd_id, row.field);
      if (!selectedFields.has(key)) continue;
      const v = parseFloat(row.value);
      if (isNaN(v)) continue;
      if (!map.has(key)) map.set(key, new Map());
      const byPass = map.get(key)!;
      if (!byPass.has(row.pass_id)) byPass.set(row.pass_id, []);
      byPass.get(row.pass_id)!.push({ ts: row.ts_ms, value: v, passId: row.pass_id });
    }
    return map;
  }, [historyData, selectedFields, effectiveRange]);

  // Fields where every loaded reading has the same value (constant / insignificant)
  const constantFields = useMemo(() => {
    const valsByField = new Map<string, Set<string>>();
    for (const rows of historyDataByCmd.values()) {
      for (const r of rows) {
        const key = signalKey(r.cmd_id, r.field);
        if (!valsByField.has(key)) valsByField.set(key, new Set());
        valsByField.get(key)!.add(r.value);
      }
    }
    const s = new Set<string>();
    for (const [field, vals] of valsByField) {
      if (vals.size <= 1) s.add(field);
    }
    return s;
  }, [historyDataByCmd]);

  // Fields grouped by domain for the Signals panel
  const fieldsByDomain = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    let shown = q
      ? availFields.filter(f =>
          f.field.toLowerCase().includes(q) ||
          f.cmd_id.toLowerCase().includes(q) ||
          fieldDomain(f.cmd_id, f.field, paramDomainMap).includes(q),
        )
      : [...availFields];
    if (densityFilter.has('withUnit'))  shown = shown.filter(f => f.unit !== '');
    if (densityFilter.has('catalog'))   shown = shown.filter(f => paramDomainMap.has(f.field));
    if (densityFilter.has('numeric'))   shown = shown.filter(isLikelyNumericSignal);
    if (densityFilter.has('hideFile'))  shown = shown.filter(f => !isFileSignal(f));
    if (densityFilter.has('changing'))  shown = shown.filter(f => !constantFields.has(signalKey(f.cmd_id, f.field)));
    if (domainFilter !== 'all') shown = shown.filter(f => fieldDomain(f.cmd_id, f.field, paramDomainMap) === domainFilter);

    const groups = new Map<string, SummaryRow[]>();
    for (const f of shown) {
      const domain = fieldDomain(f.cmd_id, f.field, paramDomainMap);
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain)!.push(f);
    }
    // Return in canonical order
    const ordered = new Map<string, SummaryRow[]>();
    for (const d of DOMAIN_ORDER) if (groups.has(d)) ordered.set(d, groups.get(d)!);
    for (const [d, fs] of groups) if (!ordered.has(d)) ordered.set(d, fs);
    return ordered;
  }, [availFields, fieldSearch, densityFilter, domainFilter, paramDomainMap, constantFields]);

  const availableDomains = useMemo(() => {
    const s = new Set<string>();
    for (const f of availFields) s.add(fieldDomain(f.cmd_id, f.field, paramDomainMap));
    return DOMAIN_ORDER.filter(d => s.has(d)).concat([...s].filter(d => !DOMAIN_ORDER.includes(d)));
  }, [availFields, paramDomainMap]);

  // Summary bar stats
  const summaryMinTs = useMemo(() => {
    const t = historyData.map(r => r.ts_ms).filter(t => t > 0);
    return t.length ? Math.min(...t) : 0;
  }, [historyData]);
  const summaryMaxTs = useMemo(() => {
    const t = historyData.map(r => r.ts_ms).filter(t => t > 0);
    return t.length ? Math.max(...t) : 0;
  }, [historyData]);

  const hasData = historyData.length > 0;

  // ── Card resize (grid mode) ───────────────────────────────────────────────────

  const onResizeMouseDown = useCallback((e: React.MouseEvent, field: string) => {
    e.preventDefault();
    const startH = cardHeights.get(field) ?? GRID_CHART_H;
    resizeRef.current = { field, startMY: e.clientY, startH };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    function onMove(ev: MouseEvent) {
      if (!resizeRef.current) return;
      const { startMY, startH: h0, field: f } = resizeRef.current;
      const newH = Math.max(CHART_MIN_H, Math.round(h0 + ev.clientY - startMY));
      setCardHeights(prev => new Map(prev).set(f, newH));
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
  }, [cardHeights]);

  // ── Toggle helpers ────────────────────────────────────────────────────────────

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

  const toggleDensity = (key: string) => {
    setDensityFilter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const SELECTED_CAP = 8;
  const visibleSelected = showAllSelected ? selectedFieldList : selectedFieldList.slice(0, SELECTED_CAP);
  const hiddenCount = selectedFieldList.length - SELECTED_CAP;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* ── Summary bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
        padding: '5px 14px', borderBottom: `1px solid ${C.borderSubtle}`,
        backgroundColor: C.bgPanel,
        fontFamily: C.fontMono, fontSize: 10.5, color: C.textMuted,
      }}>
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? 'collapse control panel' : 'expand control panel'}
          style={microBtnStyle(sidebarOpen)}
        >
          {sidebarOpen ? '◀ panel' : 'panel ▶'}
        </button>
        <span>
          <span style={{ color: selectedPassIds.size > 0 ? C.textPrimary : C.textDisabled }}>
            {selectedPassIds.size}
          </span> {selectedPassIds.size === 1 ? 'pass' : 'passes'} selected
        </span>
        {availFields.length > 0 && (
          <>
            <span style={{ color: C.borderStrong }}>·</span>
            <span>{availFields.length} fields</span>
          </>
        )}
        {selectedFields.size > 0 && (
          <>
            <span style={{ color: C.borderStrong }}>·</span>
            <span style={{ color: C.active }}>{selectedFields.size} plotted</span>
          </>
        )}
        {summaryMinTs > 0 && (
          <>
            <span style={{ color: C.borderStrong }}>·</span>
            <span style={{ color: C.textDisabled }}>{fmtTzRange(summaryMinTs, summaryMaxTs, tz)}</span>
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {dataLoading && (
            <span style={{ color: C.active, fontSize: 10 }}>⟳ loading…</span>
          )}
          {hasData && (
            <button
              onClick={() => {
                const times = historyData.map(r => r.ts_ms).filter(t => t > 0);
                if (times.length) {
                  setRangeStart(tzMsToInput(Math.min(...times), tz));
                  setRangeEnd(tzMsToInput(Math.max(...times), tz));
                }
              }}
              style={microBtnStyle(false)}
            >Reset range</button>
          )}
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* ── Left sidebar (collapsed rail) ─────────────────────────────────── */}
        {!sidebarOpen && (
          <div style={{
            width: 34, flexShrink: 0, borderRight: `1px solid ${C.borderSubtle}`,
            backgroundColor: C.bgPanel,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            padding: '8px 0',
          }}>
            <button
              onClick={() => setSidebarOpen(true)}
              title="expand control panel"
              style={{
                background: 'transparent', border: `1px solid ${C.borderSubtle}`,
                color: C.active, cursor: 'pointer', borderRadius: 3,
                width: 22, height: 22, fontSize: 12, lineHeight: 1,
              }}
            >▶</button>
            <span style={{
              writingMode: 'vertical-rl',
              fontSize: 9.5, fontFamily: C.fontMono, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: C.textMuted,
            }}>
              pass scope · signals{selectedFields.size > 0 ? ` · ${selectedFields.size} plotted` : ''}
            </span>
          </div>
        )}

        {/* ── Left sidebar ─────────────────────────────────────────────────── */}
        {sidebarOpen && (
        <div style={{
          width: 280, flexShrink: 0, borderRight: `1px solid ${C.borderSubtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          backgroundColor: C.bgPanel,
        }}>
          <div style={{ borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0 }}>
            <div style={{ padding: '7px 10px 5px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                pass scope
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: C.fontMono, color: C.textMuted }}>
                {selectedPassIds.size}/{passRows.length}
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                title="minimize control panel"
                style={{
                  background: 'transparent', border: 0, color: C.textDisabled,
                  cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1,
                }}
              >◀</button>
            </div>
            <div style={{ padding: '0 10px 7px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              <button onClick={() => setSelectedPassIds(new Set(allPassIds))} style={microBtnStyle(false)}>all</button>
              <button onClick={() => setSelectedPassIds(new Set())} style={microBtnStyle(false)}>none</button>
              <button
                onClick={() => {
                  const latest = [...passRows].sort((a, b) => Number(b.start_ts_ms || 0) - Number(a.start_ts_ms || 0))[0];
                  if (latest) setSelectedPassIds(new Set([Number(latest.pass_id)]));
                }}
                style={microBtnStyle(false)}
              >latest</button>
              <button
                onClick={() => setSelectedPassIds(new Set(allPassIds.filter(id => !selectedPassIds.has(id))))}
                style={microBtnStyle(false)}
              >invert</button>
              <button onClick={() => setPassListExpanded(v => !v)} style={microBtnStyle(passListExpanded)}>
                {passListExpanded ? 'hide list' : 'list'}
              </button>
              {decodableSelected.length > 0 && (
                <button
                  onClick={decodeSelected}
                  disabled={materializing.size > 0}
                  style={{
                    padding: '2px 7px', borderRadius: 3, cursor: materializing.size > 0 ? 'wait' : 'pointer',
                    fontSize: 9, fontFamily: C.fontMono,
                    backgroundColor: C.activeFill, color: C.active,
                    border: `1px solid ${C.active}44`, outline: 'none',
                  }}
                >
                  decode {decodableSelected.length}
                </button>
              )}
            </div>
            {passListExpanded && (
              <div style={{ maxHeight: 210, overflow: 'auto', borderTop: `1px solid ${C.borderSubtle}` }}>
                {passRows.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled, textAlign: 'center' }}>
                    no passes in database
                  </div>
                ) : passRows.map(p => {
                  const id      = Number(p.pass_id);
                  const checked = selectedPassIds.has(id);
                  const color   = passColorMap.get(id) ?? C.active;
                  const cnt     = decodeStatus[id];
                  const isMat   = materializing.has(id);
                  const badge =
                    isMat         ? <span style={badgeStyle(C.active, C.activeFill)}>…</span>
                    : cnt > 0     ? <span style={badgeStyle(C.success, C.successFill)}>{cnt}</span>
                    : cnt === 0   ? <span style={badgeStyle(C.textDisabled, C.bgApp)}>empty</span>
                    : /* pending */ <button
                        onClick={e => { e.stopPropagation(); void materialize(id); }}
                        style={{ padding: '1px 5px', borderRadius: 2, cursor: 'pointer', fontSize: 8.5, fontFamily: C.fontMono, flexShrink: 0, backgroundColor: C.bgApp, color: C.textDisabled, border: `1px solid ${C.borderSubtle}` }}
                      >Decode</button>;

                  return (
                    <div key={id} style={{ borderBottom: `1px solid ${C.borderSubtle}`, backgroundColor: checked ? `${color}0e` : 'transparent' }}>
                      <div
                        onClick={() => togglePass(id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px 4px', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = `${color}18`; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, backgroundColor: checked ? color : 'transparent', border: `1.5px solid ${checked ? color : C.borderStrong}` }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10.5, fontFamily: C.fontMono, color: checked ? C.textPrimary : C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.session_id || `pass_${id}`}
                          </div>
                          <div style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled }}>
                            {fmtDate(p.pass_date, p.pass_time)} · {p.station || '—'}
                          </div>
                        </div>
                        {badge}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Signals panel ────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {availCmds.length === 0 ? (
              <div style={{ padding: 16, fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled, textAlign: 'center', marginTop: 20 }}>
                {selectedPassIds.size === 0
                  ? 'Select passes to see available signals'
                  : 'No decoded signals. Use decode from pass scope.'}
              </div>
            ) : (
              <>
                <div style={{ padding: '7px 10px 5px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.borderSubtle}` }}>
                  <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    signals
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: C.fontMono, color: C.textMuted }}>
                    {availFields.length} shown
                  </span>
                </div>
                <div style={{ padding: '5px 8px', borderBottom: `1px solid ${C.borderSubtle}`, display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
                  {([['numeric', 'numeric'], ['hideFile', 'hide files'], ['changing', 'changing'], ['withUnit', 'with unit'], ['catalog', 'catalog']] as [string, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => toggleDensity(key)} style={microBtnStyle(densityFilter.has(key))}>
                      {label}
                    </button>
                  ))}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button onClick={() => {
                      setFieldSelectionByCmd(prev => {
                        const next = new Map(prev);
                        for (const fields of fieldsByDomain.values()) {
                          for (const f of fields) {
                            const cur = next.get(f.cmd_id) ?? new Set<string>();
                            cur.add(f.field);
                            next.set(f.cmd_id, cur);
                          }
                        }
                        return next;
                      });
                    }} style={microBtnStyle(false)}>all</button>
                    <button onClick={() => {
                      setFieldSelectionByCmd(prev => {
                        const next = new Map(prev);
                        activeCmds.forEach(cmd => next.set(cmd, new Set()));
                        return next;
                      });
                    }} style={microBtnStyle(false)}>none</button>
                  </div>
                </div>
                {availableDomains.length > 0 && (
                  <div style={{ padding: '5px 8px', borderBottom: `1px solid ${C.borderSubtle}`, display: 'flex', gap: 4, overflowX: 'auto', flexShrink: 0 }}>
                    <button onClick={() => setDomainFilter('all')} style={microBtnStyle(domainFilter === 'all')}>all</button>
                    {availableDomains.map(domain => (
                      <button key={domain} onClick={() => setDomainFilter(domain)} style={microBtnStyle(domainFilter === domain)}>
                        {domain}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ padding: '4px 8px', borderBottom: `1px solid ${C.borderSubtle}`, flexShrink: 0 }}>
                  <input
                    type="text" placeholder="search signal or source..."
                    value={fieldSearch} onChange={e => setFieldSearch(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', fontFamily: C.fontMono, fontSize: 10.5, color: C.textPrimary, backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`, borderRadius: 3, padding: '3px 7px', outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                  {fieldsByDomain.size === 0 ? (
                    <div style={{ padding: '10px 14px', fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>no matches</div>
                  ) : [...fieldsByDomain.entries()].map(([domain, fields]) => (
                    <div key={domain}>
                      <div style={{
                        padding: '3px 12px', fontSize: 8.5, fontFamily: C.fontMono,
                        color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em',
                        backgroundColor: C.bgApp, borderBottom: `1px solid ${C.borderSubtle}`,
                        display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span>{domain}</span>
                        <span style={{ opacity: 0.6 }}>{fields.length}</span>
                      </div>
                      {fields.map((f, i) => (
                        <FieldRow key={signalKey(f.cmd_id, f.field)} f={f} i={i} fieldColorMap={fieldColorMap} selectedFields={selectedFields} toggleField={toggleField} />
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        )}

        {/* ── Chart area ──────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>

          {/* Cmd toolbar */}
          {availCmds.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 6px',
              padding: '5px 12px', borderBottom: `1px solid ${C.borderSubtle}`,
              backgroundColor: C.bgPanel, flexShrink: 0,
            }}>
              <span style={{ fontSize: 9, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>
                source filters
              </span>
              {visibleSourceItems.map(item => {
                const on = activeCmds.has(item.cmd);
                return (
                  <button key={item.cmd} onClick={() => toggleCmd(item.cmd)} style={{
                    padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                    fontSize: 9.5, fontFamily: C.fontMono,
                    backgroundColor: on ? C.activeFill : 'transparent',
                    color: on ? C.active : C.textMuted,
                    border: `1px solid ${on ? `${C.active}44` : C.borderSubtle}`,
                    outline: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    <span>{fmtCmd(item.cmd)}</span>
                    <span style={{ opacity: on ? 0.75 : 0.55, fontSize: 8.5 }}>{item.count.toLocaleString()}</span>
                  </button>
                );
              })}
              {hiddenSourceCount > 0 && (
                <button onClick={() => setShowAllSources(true)} style={microBtnStyle(false)}>
                  +{hiddenSourceCount} more
                </button>
              )}
              {showAllSources && sourceItems.length > SOURCE_MIN_VISIBLE && (
                <button onClick={() => setShowAllSources(false)} style={microBtnStyle(false)}>
                  collapse
                </button>
              )}
            </div>
          )}

          {/* Time range bar */}
          {hasData && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              padding: '5px 12px', borderBottom: `1px solid ${C.borderSubtle}`,
              backgroundColor: C.bgPanel,
            }}>
              <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.1em' }}>range</span>
              <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>from</span>
              <input type="datetime-local" value={rangeStart} onChange={e => setRangeStart(e.target.value)} style={dtInputStyle()} />
              <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>to</span>
              <input type="datetime-local" value={rangeEnd}   onChange={e => setRangeEnd(e.target.value)}   style={dtInputStyle()} />
              <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>{tz}</span>
            </div>
          )}

          {/* Selected fields strip */}
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
                  no signals selected. Pick from the left panel.
                </span>
              ) : (
                <>
                  {visibleSelected.map(f => {
                    const key = signalKey(f.cmd_id, f.field);
                    const color = fieldColorMap.get(key) ?? C.active;
                    return (
                      <span key={key} onClick={() => toggleField(f.field, f.cmd_id)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 7px', borderRadius: 3, cursor: 'pointer',
                        backgroundColor: `${color}18`, border: `1px solid ${color}55`,
                        fontSize: 10.5, fontFamily: C.fontMono, color, userSelect: 'none',
                      }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                        {f.field}{f.unit ? ` (${f.unit})` : ''}<span style={{ opacity: 0.55 }}>{fmtCmd(f.cmd_id)}</span>
                        <span style={{ opacity: 0.45, fontSize: 10, marginLeft: 1 }}>×</span>
                      </span>
                    );
                  })}
                  {!showAllSelected && hiddenCount > 0 && (
                    <button onClick={() => setShowAllSelected(true)} style={microBtnStyle(false)}>
                      +{hiddenCount} more
                    </button>
                  )}
                  {showAllSelected && hiddenCount > 0 && (
                    <button onClick={() => setShowAllSelected(false)} style={microBtnStyle(false)}>
                      collapse
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Scrollable chart content */}
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0, backgroundColor: C.bgApp }}>

            {/* Pass legend */}
            {selectedPassIds.size > 1 && hasData && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '6px 14px', borderBottom: `1px solid ${C.borderSubtle}`, backgroundColor: C.bgPanel, flexShrink: 0 }}>
                {passRows.filter(p => selectedPassIds.has(Number(p.pass_id))).map(p => {
                  const id = Number(p.pass_id);
                  const color = passColorMap.get(id) ?? C.active;
                  return (
                    <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color }} />
                      <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>
                        {p.session_id || `pass_${id}`} ({p.pass_date})
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Empty states */}
            {selectedPassIds.size === 0 && (
              <EmptyState>Select passes from Pass scope to begin</EmptyState>
            )}
            {selectedPassIds.size > 0 && !hasData && !dataLoading && availCmds.length === 0 && (
              <EmptyState>No decoded signals. Use decode from Pass scope.</EmptyState>
            )}
            {selectedPassIds.size > 0 && !hasData && !dataLoading && availCmds.length > 0 && activeCmds.size === 0 && (
              <EmptyState>Select a signal source from the toolbar above</EmptyState>
            )}
            {!dataLoading && hasData && selectedFieldList.length === 0 && (
              <EmptyState>Select signals from the left panel to plot</EmptyState>
            )}
            {dataLoading && selectedFieldList.length === 0 && (
              <EmptyState><span style={{ color: C.active }}>⟳</span> loading…</EmptyState>
            )}

            {/* Charts */}
            {selectedFieldList.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: CHART_GAP,
                padding: CHART_PAD,
                alignContent: 'start',
              }}>
                {selectedFieldList.map(f => {
                  const key = signalKey(f.cmd_id, f.field);
                  return (
                  <ChartCard
                    key={key} f={f} fieldKey={key}
                    fieldColor={fieldColorMap.get(key) ?? C.active}
                    fieldColorMap={fieldColorMap}
                    seriesData={seriesData}
                    selectedPassIds={selectedPassIds}
                    passColorMap={passColorMap}
                    effectiveRange={effectiveRange}
                    height={cardHeights.get(key) ?? GRID_CHART_H}
                    onResizeMouseDown={onResizeMouseDown}
                  />
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

// ── Tiny helpers ───────────────────────────────────────────────────────────────

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontSize: 12, fontFamily: C.fontMono }}>
      {children}
    </div>
  );
}

function badgeStyle(color: string, bg: string): React.CSSProperties {
  return { fontSize: 8.5, fontFamily: C.fontMono, color, backgroundColor: bg, padding: '1px 4px', borderRadius: 2, border: `1px solid ${color}44`, flexShrink: 0 };
}

function microBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '2px 7px', borderRadius: 2, cursor: 'pointer',
    fontSize: 9, fontFamily: C.fontMono, outline: 'none',
    backgroundColor: active ? C.activeFill : C.bgApp,
    color: active ? C.active : C.textMuted,
    border: `1px solid ${active ? `${C.active}44` : C.borderSubtle}`,
  };
}

function dtInputStyle(): React.CSSProperties {
  return {
    fontFamily: C.fontMono, fontSize: 11, color: C.textPrimary,
    backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`,
    borderRadius: 3, padding: '3px 6px', outline: 'none',
  };
}
