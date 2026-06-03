import { useMemo, CSSProperties } from 'react';
import { C, toneColor, toneFill, toneOf } from '../lib/colors';
import type { AppSchema } from '../types';
import { useTableRows } from '../hooks/useApi';

/* ─── types ──────────────────────────────────────────────────────────────── */

interface DashboardProps {
  schema: AppSchema;
  onNavigate?: (tab: string, tableId?: string) => void;
}

/* ─── tiny shared helpers ────────────────────────────────────────────────── */

function fmt(n: number) { return n.toLocaleString(); }

function fmtMs(ms: number) {
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function fmtDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function fmtTimeOfDay(ms: number) {
  return new Date(ms).toISOString().slice(11, 19) + ' UTC';
}

/* ─── sub-components ─────────────────────────────────────────────────────── */

function PanelHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{
      padding: '7px 14px', borderBottom: `1px solid ${C.borderSubtle}`,
      display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0,
    }}>
      <span style={{
        fontSize: 9.5, fontFamily: C.fontMono, textTransform: 'uppercase',
        letterSpacing: '0.12em', color: C.textMuted,
      }}>
        {label}
      </span>
      {sub && (
        <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Panel({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      backgroundColor: C.bgPanel, border: `1px solid ${C.borderSubtle}`,
      borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...style,
    }}>
      {children}
    </div>
  );
}

function StatCard({
  label, value, sub, tone, unit,
}: {
  label: string; value: string; sub?: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'active' | 'neutral';
  unit?: string;
}) {
  const color = tone ? toneColor(tone) : C.textPrimary;
  const fill  = tone ? toneFill(tone)  : 'transparent';
  return (
    <div style={{
      flex: 1, padding: '12px 16px',
      border: `1px solid ${C.borderSubtle}`,
      borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 6,
      borderLeft: tone ? `3px solid ${color}` : `1px solid ${C.borderSubtle}`,
      backgroundColor: tone ? fill : C.bgPanel,
    } as CSSProperties}>
      <span style={{
        fontSize: 9.5, fontFamily: C.fontMono, textTransform: 'uppercase',
        letterSpacing: '0.1em', color: C.textDisabled,
      }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 26, fontFamily: C.fontMono, color, lineHeight: 1, fontWeight: 600 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 11, fontFamily: C.fontMono, color: C.textMuted }}>{unit}</span>
        )}
      </div>
      {sub && (
        <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textMuted }}>{sub}</span>
      )}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone?: string }) {
  const t = toneOf(tone ?? label);
  return (
    <span style={{
      fontSize: 9.5, fontFamily: C.fontMono, padding: '2px 7px', borderRadius: 3,
      backgroundColor: toneFill(t), color: toneColor(t),
      border: `1px solid ${toneColor(t)}33`,
    }}>
      {label}
    </span>
  );
}

/* ─── activity timeline chart (real data) ───────────────────────────────── */

function ActivityChart({
  rxBins, txBins, alarmBins, bins, startMs, binMs,
}: {
  rxBins: number[]; txBins: number[]; alarmBins: number[];
  bins: number; startMs: number; binMs: number;
}) {
  const W = 800; const H = 90; const PAD_L = 28; const PAD_B = 18;
  const chartW = W - PAD_L;
  const chartH = H - PAD_B;

  const maxRx    = Math.max(...rxBins, 1);
  const maxAny   = Math.max(...rxBins, ...txBins, ...alarmBins, 1);

  // rx area path
  const rxPath = rxBins.map((v, i) => {
    const x = PAD_L + (i / bins) * chartW;
    const y = H - PAD_B - (v / maxAny) * chartH;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  // tx tick markers
  const txTicks = txBins.flatMap((v, i) => {
    if (v === 0) return [];
    const x = PAD_L + ((i + 0.5) / bins) * chartW;
    const h = Math.min((v / maxAny) * chartH, chartH);
    return [{ x, h, v }];
  });

  // alarm tick markers
  const alarmTicks = alarmBins.flatMap((v, i) => {
    if (v === 0) return [];
    const x = PAD_L + ((i + 0.5) / bins) * chartW;
    const h = Math.min((v / maxAny) * chartH, chartH);
    return [{ x, h, v }];
  });

  // x-axis time labels (6 ticks)
  const xLabels = Array.from({ length: 7 }, (_, i) => {
    const ms = startMs + (i / 6) * bins * binMs;
    return { x: PAD_L + (i / 6) * chartW, label: fmtTimeOfDay(ms) };
  });

  // y-axis gridlines (3 levels)
  const yGrids = [0.25, 0.5, 0.75, 1].map((p) => ({
    y: H - PAD_B - p * chartH,
    label: Math.round(p * maxAny),
  }));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: H, display: 'block' }}
    >
      <defs>
        <linearGradient id="rx-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.success} stopOpacity="0.22" />
          <stop offset="100%" stopColor={C.success} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* grid */}
      {yGrids.map((g) => (
        <g key={g.y}>
          <line x1={PAD_L} x2={W} y1={g.y} y2={g.y} stroke={C.borderSubtle} strokeWidth="0.5" />
          <text x={PAD_L - 4} y={g.y + 3.5} textAnchor="end" fontSize="7" fill={C.textDisabled} fontFamily="monospace">
            {g.label}
          </text>
        </g>
      ))}

      {/* rx area */}
      <path
        d={`${rxPath} L ${W} ${H - PAD_B} L ${PAD_L} ${H - PAD_B} Z`}
        fill="url(#rx-fill)"
      />
      <path d={rxPath} fill="none" stroke={C.success} strokeWidth="1.2" />

      {/* tx ticks */}
      {txTicks.map((t, i) => (
        <line
          key={i}
          x1={t.x} x2={t.x}
          y1={H - PAD_B} y2={H - PAD_B - t.h}
          stroke={C.active} strokeWidth="2" opacity="0.7"
        />
      ))}

      {/* alarm ticks */}
      {alarmTicks.map((t, i) => (
        <line
          key={i}
          x1={t.x} x2={t.x}
          y1={H - PAD_B} y2={H - PAD_B - Math.min(t.h, chartH)}
          stroke={C.warning} strokeWidth="2" opacity="0.8"
        />
      ))}

      {/* x axis */}
      <line x1={PAD_L} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke={C.borderStrong} strokeWidth="0.8" />

      {/* x labels */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H - 4} textAnchor="middle" fontSize="6.5" fill={C.textDisabled} fontFamily="monospace">
          {l.label.slice(0, 8)}
        </text>
      ))}
    </svg>
  );
}

/* ─── main dashboard ─────────────────────────────────────────────────────── */

export function Dashboard({ schema, onNavigate }: DashboardProps) {
  const { rows: passRows,     loading: lPass  } = useTableRows('passes');
  const { rows: rxRows,       loading: lRx    } = useTableRows('event_rx_packet');
  const { rows: txRows,       loading: lTx    } = useTableRows('event_tx_command');
  const { rows: paramRows,    loading: lParam } = useTableRows('event_parameter');
  const { rows: alarmRows,    loading: lAlarm } = useTableRows('event_alarm');
  const { rows: verifierRows, loading: lVerif } = useTableRows('event_cmd_verifier');
  const { rows: radioRows                      } = useTableRows('event_radio');

  const loading = lPass || lRx || lTx || lParam || lAlarm || lVerif;

  /* ── pass metadata ── */
  const pass = passRows[0];

  const duration = useMemo(() => {
    if (!pass) return null;
    const start = Number(pass['start_ts_ms']);
    const end   = Number(pass['end_ts_ms']);
    if (isNaN(start) || isNaN(end)) return null;
    return { ms: end - start, start, end };
  }, [pass]);

  /* ── activity timeline ── */
  const BINS = 60;

  const timeline = useMemo(() => {
    if (!duration || duration.ms <= 0) return null;
    const binMs = duration.ms / BINS;
    const rx    = new Array(BINS).fill(0);
    const tx    = new Array(BINS).fill(0);
    const alarm = new Array(BINS).fill(0);

    const bin = (ts: number) =>
      Math.min(BINS - 1, Math.max(0, Math.floor((ts - duration.start) / binMs)));

    rxRows.forEach((r)    => { rx[bin(Number(r['ts_ms']))]++; });
    txRows.forEach((r)    => { tx[bin(Number(r['ts_ms']))]++; });
    alarmRows.forEach((r) => { alarm[bin(Number(r['ts_ms']))]++; });

    return { rx, tx, alarm, binMs };
  }, [duration, rxRows, txRows, alarmRows]);

  /* ── alarm breakdown ── */
  const alarmStats = useMemo(() => {
    const bySev: Record<string, number>   = {};
    const byState: Record<string, number> = {};
    alarmRows.forEach((r) => {
      const sev   = String(r['alarm_severity'] ?? '—');
      const state = String(r['alarm_state']    ?? '—');
      bySev[sev]     = (bySev[sev]     ?? 0) + 1;
      byState[state] = (byState[state] ?? 0) + 1;
    });
    return { bySev, byState };
  }, [alarmRows]);

  /* ── command verifier ── */
  const cmdStats = useMemo(() => {
    const byOutcome: Record<string, number> = {};
    verifierRows.forEach((r) => {
      const o = String(r['outcome'] ?? '—');
      byOutcome[o] = (byOutcome[o] ?? 0) + 1;
    });
    const total   = verifierRows.length;
    const success = byOutcome['SUCCESS'] ?? 0;
    const rate    = total > 0 ? Math.round((success / total) * 100) : 0;
    // avg elapsed for successful cmds
    const elapsed = verifierRows
      .filter((r) => r['outcome'] === 'SUCCESS')
      .map((r) => Number(r['elapsed_ms']))
      .filter((n) => !isNaN(n));
    const avgElapsed = elapsed.length > 0
      ? (elapsed.reduce((a, b) => a + b, 0) / elapsed.length).toFixed(0)
      : '—';
    return { byOutcome, total, success, rate, avgElapsed };
  }, [verifierRows]);

  /* ── parameter snapshot (latest value per unique name) ── */
  const paramSnapshot = useMemo(() => {
    const map = new Map<string, { value: unknown; unit: unknown; ts: number }>();
    paramRows.forEach((r) => {
      const name = String(r['name'] ?? '');
      const ts   = Number(r['ts_ms']);
      const prev = map.get(name);
      if (!prev || ts > prev.ts) {
        map.set(name, { value: r['value'], unit: r['unit'], ts });
      }
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { value, unit }]) => ({ name, value, unit }));
  }, [paramRows]);

  /* ── unique parameter count ── */
  const uniqueParams = useMemo(() => {
    const s = new Set<string>();
    paramRows.forEach((r) => { if (r['name']) s.add(String(r['name'])); });
    return s.size;
  }, [paramRows]);

  /* ── frame type breakdown ── */
  const frameBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    rxRows.forEach((r) => {
      const ft = String(r['frame_type'] ?? 'UNKNOWN');
      m[ft] = (m[ft] ?? 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rxRows]);

  /* ── duplicate packet count ── */
  const duplicateCount = useMemo(
    () => rxRows.filter((r) => r['duplicate'] === 1 || r['duplicate'] === true).length,
    [rxRows],
  );

  /* ── radio lifecycle ── */
  const radioEvents = useMemo(
    () => radioRows.sort((a, b) => Number(a['ts_ms']) - Number(b['ts_ms'])),
    [radioRows],
  );

  /* ── recent events feed ── */
  const recentEvents = useMemo(() => {
    type Ev = { ts: number; kind: string; label: string; detail: string; tone: string };
    const events: Ev[] = [];

    rxRows.forEach((r) => events.push({
      ts: Number(r['ts_ms']), kind: 'RX',
      label: String(r['frame_type'] ?? 'PKT'),
      detail: `${r['size']} B${r['duplicate'] ? ' · dup' : ''}`,
      tone: 'success',
    }));
    txRows.forEach((r) => events.push({
      ts: Number(r['ts_ms']), kind: 'TX',
      label: String(r['frame_label'] ?? r['frame_type'] ?? 'CMD'),
      detail: '',
      tone: 'info',
    }));
    alarmRows.forEach((r) => events.push({
      ts: Number(r['ts_ms']), kind: 'ALARM',
      label: String(r['alarm_state'] ?? ''),
      detail: String(r['alarm_severity'] ?? ''),
      tone: String(r['alarm_severity']) === 'critical' ? 'danger'
          : String(r['alarm_severity']) === 'warning'  ? 'warning'
          : 'neutral',
    }));

    return events.sort((a, b) => b.ts - a.ts).slice(0, 24);
  }, [rxRows, txRows, alarmRows]);

  /* ── loading skeleton ── */
  if (loading && !pass) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: C.textDisabled, fontFamily: C.fontMono, fontSize: 11, gap: 8,
      }}>
        <span style={{ color: C.active }}>⟳</span> loading pass data…
      </div>
    );
  }

  /* ── render ──────────────────────────────────────────────────────────────*/
  return (
    <div style={{
      flex: 1, overflow: 'auto', padding: 12,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>

      {/* ── PASS BANNER ─────────────────────────────────────────────────── */}
      <Panel>
        <div style={{
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 0,
          flexWrap: 'wrap',
        }}>
          {/* Left: identity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 9, fontFamily: C.fontMono, textTransform: 'uppercase',
                letterSpacing: '0.12em', color: C.textDisabled,
              }}>
                pass
              </span>
              <span style={{
                padding: '1px 8px', borderRadius: 3, fontSize: 10.5,
                fontFamily: C.fontMono, fontWeight: 700,
                backgroundColor: C.activeFill, color: C.active,
                border: `1px solid ${C.active}44`,
              }}>
                ● LIVE TAIL
              </span>
            </div>
            <span style={{ fontSize: 20, fontFamily: C.fontMono, color: C.textPrimary, letterSpacing: '0.04em' }}>
              {pass ? String(pass['session_id'] ?? `PASS-${pass['pass_id']}`) : '—'}
            </span>
          </div>

          <div style={{ width: 1, height: 44, backgroundColor: C.borderSubtle, margin: '0 24px' }} />

          {/* Meta fields */}
          {[
            { k: 'date',     v: pass ? String(pass['pass_date'] ?? '—') : '—' },
            { k: 'operator', v: pass ? String(pass['operator']  ?? '—') : '—' },
            { k: 'station',  v: pass ? String(pass['station']   ?? '—') : '—' },
            { k: 'duration', v: duration ? fmtDuration(duration.ms) : '—' },
            { k: 'start',    v: duration ? fmtTimeOfDay(duration.start) : '—' },
            { k: 'end',      v: duration ? fmtTimeOfDay(duration.end)   : '—' },
          ].map(({ k, v }) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3, marginRight: 28 }}>
              <span style={{ fontSize: 9, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textDisabled }}>
                {k}
              </span>
              <span style={{ fontSize: 12.5, fontFamily: C.fontMono, color: C.textPrimary }}>
                {v}
              </span>
            </div>
          ))}

          {/* Radio events */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {radioEvents.map((r, i) => (
              <span key={i} style={{
                fontSize: 9.5, fontFamily: C.fontMono, padding: '2px 7px', borderRadius: 3,
                backgroundColor: C.bgApp, border: `1px solid ${C.borderStrong}`,
                color: C.textMuted,
              }}>
                {String(r['radio_action'])} → {String(r['radio_state'])}
              </span>
            ))}
          </div>
        </div>
      </Panel>

      {/* ── STAT CARDS ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10 }}>
        <StatCard
          label="RX Packets"
          value={fmt(rxRows.length)}
          sub={`${duplicateCount} duplicates · ${frameBreakdown.map(([t, n]) => `${t}:${n}`).slice(0, 3).join(' · ')}`}
          tone="success"
        />
        <StatCard
          label="TX Commands"
          value={fmt(txRows.length)}
          sub={`${cmdStats.rate}% verification pass rate`}
          tone="info"
        />
        <StatCard
          label="Telemetry Points"
          value={fmt(paramRows.length)}
          sub={`${uniqueParams} unique parameters`}
          tone="active"
        />
        <StatCard
          label="Alarm Events"
          value={fmt(alarmRows.length)}
          sub={Object.entries(alarmStats.byState).map(([s, n]) => `${s}: ${n}`).join(' · ')}
          tone={alarmRows.some((r) => String(r['alarm_severity']) === 'critical') ? 'danger' : 'warning'}
        />
        <StatCard
          label="Pass Duration"
          value={duration ? `${Math.floor(duration.ms / 60000)}` : '—'}
          unit="min"
          sub={duration ? fmtDuration(duration.ms) : '—'}
          tone="neutral"
        />
      </div>

      {/* ── MIDDLE ROW ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, minHeight: 0 }}>

        {/* ── LEFT: timeline + events feed ── */}
        <div style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>

          {/* Activity Timeline */}
          <Panel>
            <PanelHeader
              label="Activity Timeline"
              sub={`${BINS}-bucket view · ${duration ? fmtDuration(duration.ms) : ''} pass`}
            />
            <div style={{ padding: '8px 12px 4px' }}>
              {/* legend */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
                {[
                  { color: C.success, label: `RX packets (${rxRows.length})` },
                  { color: C.active,  label: `TX commands (${txRows.length})` },
                  { color: C.warning, label: `Alarms (${alarmRows.length})` },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 12, height: 2, backgroundColor: color, borderRadius: 1 }} />
                    <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled }}>{label}</span>
                  </div>
                ))}
              </div>

              {timeline ? (
                <ActivityChart
                  rxBins={timeline.rx}
                  txBins={timeline.tx}
                  alarmBins={timeline.alarm}
                  bins={BINS}
                  startMs={duration!.start}
                  binMs={timeline.binMs}
                />
              ) : (
                <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textDisabled, fontFamily: C.fontMono, fontSize: 11 }}>
                  no timing data
                </div>
              )}
            </div>
          </Panel>

          {/* Recent Events Feed */}
          <Panel style={{ flex: 1, minHeight: 200 }}>
            <PanelHeader label="Event Feed" sub="most recent 24 events across all tables" />
            <div style={{ flex: 1, overflow: 'auto' }}>
              {recentEvents.map((ev, i) => {
                const tone = toneOf(ev.tone);
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '5px 14px',
                      borderBottom: `1px solid ${C.borderSubtle}`,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanelRaised; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                  >
                    {/* kind badge */}
                    <span style={{
                      width: 42, fontSize: 8.5, fontFamily: C.fontMono, textAlign: 'center',
                      padding: '2px 0', borderRadius: 2, flexShrink: 0,
                      backgroundColor: toneFill(tone), color: toneColor(tone),
                      border: `1px solid ${toneColor(tone)}33`,
                    }}>
                      {ev.kind}
                    </span>

                    {/* timestamp */}
                    <span style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, flexShrink: 0, width: 80 }}>
                      {fmtTimeOfDay(ev.ts)}
                    </span>

                    {/* label */}
                    <span style={{ fontSize: 11, fontFamily: C.fontMono, color: C.textSecondary }}>
                      {ev.label}
                    </span>

                    {/* detail */}
                    {ev.detail && (
                      <span style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
                        {ev.detail}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* ── RIGHT: stats panels ── */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220 }}>

          {/* Alarm Breakdown */}
          <Panel>
            <PanelHeader label="Alarm Breakdown" />
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* by severity */}
              <div>
                <div style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  by severity
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(alarmStats.bySev)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sev, n]) => {
                      const tone = toneOf(sev);
                      const pct  = alarmRows.length > 0 ? (n / alarmRows.length) * 100 : 0;
                      return (
                        <div key={sev} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10.5, fontFamily: C.fontMono, color: toneColor(tone) }}>{sev}</span>
                            <span style={{ fontSize: 10.5, fontFamily: C.fontMono, color: C.textMuted }}>{n}</span>
                          </div>
                          <div style={{ height: 3, backgroundColor: C.bgApp, borderRadius: 2 }}>
                            <div style={{
                              height: '100%', width: `${pct}%`,
                              backgroundColor: toneColor(tone), borderRadius: 2,
                              transition: 'width 0.3s',
                            }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* divider */}
              <div style={{ height: 1, backgroundColor: C.borderSubtle }} />

              {/* by state */}
              <div>
                <div style={{ fontSize: 9.5, fontFamily: C.fontMono, color: C.textDisabled, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  by state
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {Object.entries(alarmStats.byState).map(([state, n]) => (
                    <div key={state} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: 18, fontFamily: C.fontMono, color: C.textPrimary, lineHeight: 1 }}>{n}</span>
                      <Badge label={state} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          {/* Command Verifier */}
          <Panel>
            <PanelHeader label="Command Verification" />
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* pass rate donut (simple) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <svg viewBox="0 0 60 60" width={60} height={60}>
                  {/* track */}
                  <circle cx="30" cy="30" r="24" fill="none" stroke={C.bgApp} strokeWidth="8" />
                  {/* success arc */}
                  <circle
                    cx="30" cy="30" r="24"
                    fill="none"
                    stroke={cmdStats.rate >= 90 ? C.success : cmdStats.rate >= 70 ? C.warning : C.danger}
                    strokeWidth="8"
                    strokeDasharray={`${(cmdStats.rate / 100) * (2 * Math.PI * 24)} ${2 * Math.PI * 24}`}
                    strokeDashoffset={2 * Math.PI * 24 * 0.25}
                    strokeLinecap="round"
                  />
                  <text x="30" y="34" textAnchor="middle" fontSize="13" fontWeight="700"
                    fill={cmdStats.rate >= 90 ? C.success : cmdStats.rate >= 70 ? C.warning : C.danger}
                    fontFamily="monospace"
                  >
                    {cmdStats.rate}%
                  </text>
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, fontFamily: C.fontMono, color: C.textPrimary }}>
                    {cmdStats.success} / {cmdStats.total} verified
                  </div>
                  <div style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled }}>
                    avg {cmdStats.avgElapsed} ms round-trip
                  </div>
                </div>
              </div>

              {/* outcome breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {Object.entries(cmdStats.byOutcome)
                  .sort((a, b) => b[1] - a[1])
                  .map(([outcome, n]) => {
                    const tone = toneOf(outcome);
                    const pct  = cmdStats.total > 0 ? (n / cmdStats.total) * 100 : 0;
                    return (
                      <div key={outcome} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 62, fontSize: 9.5, fontFamily: C.fontMono, color: toneColor(tone) }}>{outcome}</span>
                        <div style={{ flex: 1, height: 4, backgroundColor: C.bgApp, borderRadius: 2 }}>
                          <div style={{
                            height: '100%', width: `${pct}%`,
                            backgroundColor: toneColor(tone), borderRadius: 2,
                          }} />
                        </div>
                        <span style={{ width: 22, textAlign: 'right', fontSize: 10, fontFamily: C.fontMono, color: C.textMuted }}>{n}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </Panel>

          {/* Frame Type Breakdown */}
          <Panel>
            <PanelHeader label="RX Frame Types" sub={`${rxRows.length} packets`} />
            <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {frameBreakdown.map(([type, n]) => {
                const pct = rxRows.length > 0 ? (n / rxRows.length) * 100 : 0;
                const color = type.includes('AX') ? C.frameAx25 : type.includes('GOLAY') ? C.frameGolay : C.textMuted;
                return (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 86, fontSize: 9.5, fontFamily: C.fontMono, color,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {type}
                    </span>
                    <div style={{ flex: 1, height: 4, backgroundColor: C.bgApp, borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 2 }} />
                    </div>
                    <span style={{ width: 28, textAlign: 'right', fontSize: 10, fontFamily: C.fontMono, color: C.textMuted }}>{n}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── PARAMETER SNAPSHOT ──────────────────────────────────────────── */}
      <Panel>
        <PanelHeader
          label="Telemetry Parameter Snapshot"
          sub={`latest value per parameter · ${uniqueParams} unique · ${fmt(paramRows.length)} total readings`}
        />
        <div style={{ overflow: 'auto', maxHeight: 260 }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontSize: 11, fontFamily: C.fontMono,
          }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr style={{ backgroundColor: C.bgApp }}>
                {['Parameter', 'Latest Value', 'Unit', 'ISO Timestamp'].map((h) => (
                  <th key={h} style={{
                    padding: '5px 14px', textAlign: 'left',
                    borderBottom: `1px solid ${C.borderStrong}`,
                    fontSize: 9.5, color: C.textMuted, fontWeight: 'normal',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paramSnapshot.map(({ name, value, unit }, i) => {
                // Try to colour numeric values by magnitude change from neighbouring rows
                const numVal = parseFloat(String(value));
                return (
                  <tr
                    key={name}
                    style={{ borderBottom: `1px solid ${C.borderSubtle}`, backgroundColor: i % 2 === 0 ? 'transparent' : C.bgApp + '80' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.bgPanelRaised; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = i % 2 === 0 ? 'transparent' : C.bgApp + '80'; }}
                  >
                    <td style={{ padding: '4px 14px', color: C.textSecondary }}>{name}</td>
                    <td style={{
                      padding: '4px 14px',
                      color: !isNaN(numVal) ? C.active : C.textPrimary,
                      textAlign: 'right',
                    }}>
                      {String(value ?? '—')}
                    </td>
                    <td style={{ padding: '4px 14px', color: C.textDisabled }}>{String(unit ?? '')}</td>
                    <td style={{ padding: '4px 14px', color: C.textDisabled }}>
                      {/* we don't have iso in this row from the snapshot, just show param name */}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── STATUS BAR ──────────────────────────────────────────────────── */}
      <div style={{
        padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: C.fontMono, fontSize: 10, color: C.textDisabled,
        borderTop: `1px solid ${C.borderSubtle}`,
      }}>
        <span>ground_station.db</span>
        <span>·</span>
        <span>{fmt(rxRows.length + txRows.length + paramRows.length + alarmRows.length + verifierRows.length + radioRows.length)} total events</span>
        <span>·</span>
        {loading
          ? <span style={{ color: C.active }}>⟳ loading…</span>
          : <span style={{ color: C.success }}>● all tables loaded</span>
        }
        <span style={{ marginLeft: 'auto' }}>
          {pass ? `pass_id: ${pass['pass_id']}` : ''}
        </span>
      </div>
    </div>
  );
}
