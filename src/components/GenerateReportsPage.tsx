import { useState, useEffect, useRef, useMemo } from 'react';
import { C } from '../lib/colors';
import { useTz, fmtMs as tzFmtMs, fmtIso as tzFmtIso, type Tz } from '../lib/timezone';
import type { AppSchema } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PassMeta {
  pass_id: number;
  session_id: string;
  pass_date: string;
  pass_time: string;
  mission_id: string;
  operator: string;
  station: string;
  start_ts_ms: number | null;
  end_ts_ms: number | null;
  source_file: string;
}

interface ReportCommand {
  event_id: string;
  ts_iso: string;
  cmd_id: string;
  outcome: string | null;
  elapsed_ms: number | null;
}

interface ReportWarning {
  event_id: string | null;
  ts_iso: string;
  source: 'RX' | 'TX' | 'ALARM';
  label: string;
  detail: string;
  severity: string | null;
}

interface PassReport {
  meta: PassMeta;
  commands: ReportCommand[];
  warnings: ReportWarning[];
}

interface AssembledFile {
  filename: string;
  totalBytes: number;
  chunkCount: number;
}

interface PassOption {
  passId: number;
  label: string;
  desc: string;
}

// ── Combined event row ─────────────────────────────────────────────────────────

type CombinedRow =
  | { kind: 'cmd'; ts_iso: string; cmd_id: string; outcome: string | null; elapsed_ms: number | null; event_id: string }
  | { kind: 'err'; ts_iso: string; source: 'RX' | 'TX' | 'ALARM'; label: string; severity: string | null; detail: string; event_id: string | null };

function buildCombined(commands: ReportCommand[], warnings: ReportWarning[]): CombinedRow[] {
  const rows: CombinedRow[] = [
    ...commands.map((c): CombinedRow => ({
      kind: 'cmd', ts_iso: c.ts_iso, cmd_id: c.cmd_id,
      outcome: c.outcome, elapsed_ms: c.elapsed_ms, event_id: c.event_id,
    })),
    ...warnings.map((w): CombinedRow => ({
      kind: 'err', ts_iso: w.ts_iso, source: w.source,
      label: w.label, severity: w.severity, detail: w.detail, event_id: w.event_id,
    })),
  ];
  rows.sort((a, b) => a.ts_iso < b.ts_iso ? -1 : a.ts_iso > b.ts_iso ? 1 : 0);
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: number | null, tz: Tz): string {
  if (!ts) return '';
  return tzFmtMs(ts, tz);
}

function fmtIso(iso: string, tz: Tz): string {
  return tzFmtIso(iso, tz);
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function sourceColor(source: string): string {
  if (source === 'RX') return C.info;
  if (source === 'TX') return C.warning;
  return C.danger;
}

function outcomeColor(s: string | null): string {
  if (!s) return C.textMuted;
  const u = s.toUpperCase();
  if (u === 'SUCCESS' || u === 'COMPLETE' || u === 'COMPLETED' || u === 'ACK') return C.success;
  if (u === 'CRITICAL' || u === 'FAIL' || u === 'NACK' || u === 'TIMEOUT') return C.danger;
  return C.warning;
}

// ── Print styles (injected into head once) ────────────────────────────────────

const PRINT_STYLE_ID = 'maveric-report-print-style';

function injectPrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
@media print {
  body > * { display: none !important; }
  #maveric-report-printable { display: block !important; }
}
@media screen {
  #maveric-report-printable { display: none; }
}
`;
  document.head.appendChild(style);
}

// ── Report print document ─────────────────────────────────────────────────────

function buildPrintHtml(
  report: PassReport,
  combined: CombinedRow[],
  files: AssembledFile[],
  form: FormState,
  tz: Tz,
): string {
  const { meta } = report;

  const eventRows = combined.map((row, i) => {
    const bg = i % 2 === 0 ? '#f8f8f8' : 'white';
    if (row.kind === 'cmd') {
      const outcomeStr = row.outcome || '—';
      const outcomeColor = ['SUCCESS','COMPLETE','COMPLETED','ACK'].includes((row.outcome ?? '').toUpperCase())
        ? '#1a7a40' : ['FAIL','NACK','TIMEOUT','CRITICAL'].includes((row.outcome ?? '').toUpperCase())
        ? '#c00' : '#a65000';
      return `<tr style="background:${bg}">
        <td style="padding:2px 5px;border:1px solid #ccc">${fmtIso(row.ts_iso, tz)}</td>
        <td style="padding:2px 5px;border:1px solid #ccc;font-weight:700;color:#1a4fa8">CMD</td>
        <td style="padding:2px 5px;border:1px solid #ccc;font-weight:600">${row.cmd_id || '—'}</td>
        <td style="padding:2px 5px;border:1px solid #ccc;font-weight:600;color:${outcomeColor}">${outcomeStr}</td>
        <td style="padding:2px 5px;border:1px solid #ccc;text-align:right">${row.elapsed_ms != null ? row.elapsed_ms + ' ms' : '—'}</td>
      </tr>`;
    }
    const srcColor = row.source === 'RX' ? '#1a6fa8' : row.source === 'TX' ? '#a65000' : '#c00';
    const isFail = ['FAIL','NACK','TIMEOUT','CRITICAL'].includes((row.severity ?? '').toUpperCase());
    return `<tr style="background:${bg}">
      <td style="padding:2px 5px;border:1px solid #ccc">${fmtIso(row.ts_iso, tz)}</td>
      <td style="padding:2px 5px;border:1px solid #ccc;font-weight:700;color:${srcColor}">${row.source}</td>
      <td style="padding:2px 5px;border:1px solid #ccc">${row.label || '—'}</td>
      <td style="padding:2px 5px;border:1px solid #ccc;font-weight:600;color:${isFail ? '#c00' : '#a65000'}">${row.severity || '—'}</td>
      <td style="padding:2px 5px;border:1px solid #ccc">${row.detail || '—'}</td>
    </tr>`;
  }).join('');

  const fileRows = files.map((f, i) =>
    `<tr style="background:${i % 2 === 0 ? '#f8f8f8' : 'white'}">
      <td style="padding:2px 5px;border:1px solid #ccc;font-family:monospace">${f.filename}</td>
      <td style="padding:2px 5px;border:1px solid #ccc;text-align:right">${fmtBytes(f.totalBytes)}</td>
      <td style="padding:2px 5px;border:1px solid #ccc;text-align:right">${f.chunkCount}</td>
    </tr>`,
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MAVERIC Pass Report — Pass ${meta.pass_id}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9pt; color: #111; background: white; padding: 18mm 16mm; }
  h1 { font-size: 14pt; font-weight: 700; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 10px; }
  h2 { font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 12px 0 4px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
  .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 14px; margin-bottom: 8px; }
  .meta-item label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em; color: #666; display: block; }
  .meta-item span { font-size: 9pt; font-weight: 600; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
  .blank-box { border: 1px solid #aaa; border-radius: 3px; padding: 4px 7px; min-height: 22px; }
  .blank-box label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.04em; color: #666; display: block; margin-bottom: 2px; }
  .blank-box .val { font-size: 9pt; min-height: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  thead th { background: #222; color: white; padding: 3px 5px; text-align: left; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.04em; }
  .empty-note { color: #888; font-style: italic; padding: 5px; font-size: 8pt; }
  .footer { margin-top: 10px; font-size: 7pt; color: #888; text-align: right; border-top: 1px solid #ddd; padding-top: 4px; }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>
<h1>MAVERIC Pass Report</h1>

<div class="meta-grid">
  <div class="meta-item"><label>Pass ID</label><span>${meta.pass_id}</span></div>
  <div class="meta-item"><label>Session</label><span>${meta.session_id || '—'}</span></div>
  <div class="meta-item"><label>Mission</label><span>${meta.mission_id || '—'}</span></div>
  <div class="meta-item"><label>Station</label><span>${meta.station || '—'}</span></div>
  <div class="meta-item"><label>Operator</label><span>${meta.operator || '—'}</span></div>
  <div class="meta-item"><label>Date</label><span>${meta.pass_date || '—'}</span></div>
  <div class="meta-item"><label>Time</label><span>${meta.pass_time || '—'}</span></div>
  <div class="meta-item"><label>Source File</label><span style="font-size:7pt">${meta.source_file || '—'}</span></div>
</div>

<h2>Pass Timing</h2>
<div class="field-row">
  <div class="blank-box"><label>Pass Start Time (${tz})</label><div class="val">${form.passStartTime || fmtTs(meta.start_ts_ms, tz)}&nbsp;</div></div>
  <div class="blank-box"><label>Pass End Time (${tz})</label><div class="val">${form.passEndTime || fmtTs(meta.end_ts_ms, tz)}&nbsp;</div></div>
</div>

<h2>Commands &amp; Errors (${combined.length})</h2>
${combined.length === 0
  ? '<div class="empty-note">No events recorded for this pass.</div>'
  : `<table>
  <thead><tr><th>Timestamp</th><th>Type</th><th>Command / Label</th><th>Outcome / Severity</th><th>Detail / Elapsed</th></tr></thead>
  <tbody>${eventRows}</tbody>
</table>`}

<h2>Downlinked Files (${files.length})</h2>
${files.length === 0
  ? '<div class="empty-note">No assembled files for this pass.</div>'
  : `<table>
  <thead><tr><th>Filename</th><th style="text-align:right">Size</th><th style="text-align:right">Chunks</th></tr></thead>
  <tbody>${fileRows}</tbody>
</table>`}

<div class="footer">Generated by MAVERIC Data Viewer &middot; ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC</div>
</body>
</html>`;
}

// ── Form state ─────────────────────────────────────────────────────────────────

interface FormState {
  passStartTime: string;
  passEndTime: string;
}

// ── Main component ─────────────────────────────────────────────────────────────

interface GenerateReportsPageProps {
  schema: AppSchema;
}

export function GenerateReportsPage({ schema }: GenerateReportsPageProps) {
  const allPasses: PassOption[] = schema.schemas
    .flatMap((s) => s.tables)
    .filter((t) => /^pass_\d+$/.test(t.id))
    .map((t) => ({
      passId: parseInt(t.id.slice(5), 10),
      label: t.label,
      desc: t.desc,
    }))
    .sort((a, b) => b.passId - a.passId);

  const { tz } = useTz();
  const [selectedPassId, setSelectedPassId] = useState<number | null>(
    allPasses.length > 0 ? allPasses[0].passId : null,
  );
  const [report, setReport] = useState<PassReport | null>(null);
  const [files, setFiles] = useState<AssembledFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ passStartTime: '', passEndTime: '' });
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => { injectPrintStyles(); }, []);

  useEffect(() => {
    if (!selectedPassId) return;
    setLoading(true);
    setReport(null);
    setFiles([]);
    setError(null);
    setForm({ passStartTime: '', passEndTime: '' });

    const tableId = `pass_${selectedPassId}`;
    Promise.all([
      fetch(`/api/report/${selectedPassId}`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<PassReport>; }),
      fetch(`/api/tables/${tableId}/assemble-files`, { method: 'POST' })
        .then((r) => r.json() as Promise<{ files?: AssembledFile[] }>)
        .then((d) => d.files ?? [])
        .catch(() => [] as AssembledFile[]),
    ]).then(([reportData, fileData]) => {
      setReport(reportData);
      setFiles(fileData);
      setLoading(false);
    }).catch((e: unknown) => { setError(String(e)); setLoading(false); });
  }, [selectedPassId]);

  const combined = useMemo(
    () => report ? buildCombined(report.commands, report.warnings) : [],
    [report],
  );

  function handlePrint() {
    if (!report) return;
    const html = buildPrintHtml(report, combined, files, form, tz);
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none';
    document.body.appendChild(iframe);
    printFrameRef.current = iframe;
    iframe.contentDocument!.open();
    iframe.contentDocument!.write(html);
    iframe.contentDocument!.close();
    iframe.onload = () => {
      iframe.contentWindow!.focus();
      iframe.contentWindow!.print();
      setTimeout(() => { document.body.removeChild(iframe); printFrameRef.current = null; }, 2000);
    };
  }

  const inputStyle = {
    backgroundColor: C.bgPanelRaised,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 3,
    color: C.textPrimary,
    fontFamily: C.fontMono,
    fontSize: 11,
    padding: '4px 8px',
    outline: 'none',
    width: '100%',
  };

  const labelStyle = {
    fontSize: 10,
    color: C.textMuted,
    fontFamily: C.fontMono,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    display: 'block',
    marginBottom: 4,
  };

  const sectionHeadStyle = {
    fontSize: 9.5,
    fontFamily: C.fontMono,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: C.textMuted,
    borderBottom: `1px solid ${C.borderSubtle}`,
    paddingBottom: 6,
    marginBottom: 10,
  };

  const thStyle = {
    padding: '5px 10px', textAlign: 'left' as const,
    fontFamily: C.fontMono, fontSize: 9.5,
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    color: C.textMuted, borderBottom: `1px solid ${C.borderSubtle}`,
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 16px', flexShrink: 0,
        borderBottom: `1px solid ${C.borderSubtle}`,
        backgroundColor: C.bgPanel,
      }}>
        <span style={{ fontFamily: C.fontMono, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>Pass</span>
        <select
          value={selectedPassId ?? ''}
          onChange={(e) => setSelectedPassId(Number(e.target.value))}
          style={{ ...inputStyle, width: 320, cursor: 'pointer' }}
        >
          {allPasses.length === 0 && <option value="">No passes</option>}
          {allPasses.map((p) => (
            <option key={p.passId} value={p.passId}>{p.label} — {p.desc}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={handlePrint}
            disabled={!report}
            style={{
              padding: '5px 14px', fontSize: 11,
              fontFamily: C.fontMono,
              backgroundColor: report ? C.active : C.bgPanelRaised,
              color: report ? C.bgApp : C.textDisabled,
              border: `1px solid ${report ? C.active : C.borderSubtle}`,
              borderRadius: 3, cursor: report ? 'pointer' : 'not-allowed',
            }}
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Main content — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', minHeight: 0 }}>
        {loading && (
          <div style={{ color: C.textMuted, fontFamily: C.fontMono, fontSize: 12, padding: 20 }}>
            Loading pass data...
          </div>
        )}

        {error && (
          <div style={{ color: C.danger, fontFamily: C.fontMono, fontSize: 12, padding: 20 }}>{error}</div>
        )}

        {report && (
          <div style={{ maxWidth: 960 }}>
            {/* Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: 20,
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
                  MAVERIC Pass Report
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, fontFamily: C.fontMono }}>
                  Pass {report.meta.pass_id} &middot; {report.meta.session_id || '—'} &middot; {report.meta.station || '—'}
                </div>
              </div>
              <div style={{ fontSize: 10, fontFamily: C.fontMono, color: C.textDisabled, textAlign: 'right' }}>
                <div>{report.meta.mission_id || '—'}</div>
                <div>{report.meta.pass_date} {report.meta.pass_time}</div>
                <div>Operator: {report.meta.operator || '—'}</div>
              </div>
            </div>

            {/* Pass timing */}
            <div style={{ marginBottom: 18 }}>
              <div style={sectionHeadStyle}>Pass Timing</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Pass Start Time (UTC)</label>
                  <input
                    type="text"
                    placeholder={fmtTs(report.meta.start_ts_ms, tz) || `e.g. 2025-03-12 14:30:00 ${tz}`}
                    value={form.passStartTime}
                    onChange={(e) => setForm((f) => ({ ...f, passStartTime: e.target.value }))}
                    style={inputStyle}
                  />
                  {report.meta.start_ts_ms && !form.passStartTime && (
                    <div style={{ fontSize: 10, color: C.textDisabled, fontFamily: C.fontMono, marginTop: 3 }}>
                      Recorded: {fmtTs(report.meta.start_ts_ms, tz)}
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Pass End Time (UTC)</label>
                  <input
                    type="text"
                    placeholder={fmtTs(report.meta.end_ts_ms, tz) || `e.g. 2025-03-12 14:45:00 ${tz}`}
                    value={form.passEndTime}
                    onChange={(e) => setForm((f) => ({ ...f, passEndTime: e.target.value }))}
                    style={inputStyle}
                  />
                  {report.meta.end_ts_ms && !form.passEndTime && (
                    <div style={{ fontSize: 10, color: C.textDisabled, fontFamily: C.fontMono, marginTop: 3 }}>
                      Recorded: {fmtTs(report.meta.end_ts_ms, tz)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Combined events table */}
            <div style={{ marginBottom: 18 }}>
              <div style={sectionHeadStyle}>
                Commands &amp; Errors
                <span style={{ marginLeft: 8, color: C.textDisabled }}>({combined.length})</span>
              </div>
              {combined.length === 0 ? (
                <div style={{ fontSize: 11, color: C.textDisabled, fontFamily: C.fontMono, fontStyle: 'italic' }}>
                  No events recorded for this pass.
                </div>
              ) : (
                <div style={{ border: `1px solid ${C.borderSubtle}`, borderRadius: 3, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ backgroundColor: C.bgPanelRaised }}>
                        <th style={thStyle}>Timestamp</th>
                        <th style={thStyle}>Type</th>
                        <th style={thStyle}>Command / Label</th>
                        <th style={thStyle}>Outcome / Severity</th>
                        <th style={thStyle}>Detail / Elapsed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {combined.map((row, i) => {
                        const rowBg = i % 2 === 0 ? 'transparent' : `${C.bgPanelRaised}55`;
                        if (row.kind === 'cmd') {
                          return (
                            <tr key={`cmd-${row.event_id}`} style={{ backgroundColor: rowBg }}>
                              <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textMuted }}>
                                {fmtIso(row.ts_iso, tz)}
                              </td>
                              <td style={{ padding: '4px 10px', fontFamily: C.fontMono, fontWeight: 700, color: C.active }}>
                                CMD
                              </td>
                              <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textPrimary, fontWeight: 600 }}>
                                {row.cmd_id || '—'}
                              </td>
                              <td style={{ padding: '4px 10px', fontFamily: C.fontMono, fontWeight: 600 }}>
                                <span style={{ color: outcomeColor(row.outcome) }}>{row.outcome || '—'}</span>
                              </td>
                              <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textMuted }}>
                                {row.elapsed_ms != null ? `${row.elapsed_ms} ms` : '—'}
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={`err-${row.event_id}-${i}`} style={{ backgroundColor: rowBg }}>
                            <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textMuted }}>
                              {fmtIso(row.ts_iso, tz)}
                            </td>
                            <td style={{ padding: '4px 10px', fontFamily: C.fontMono, fontWeight: 700 }}>
                              <span style={{ color: sourceColor(row.source) }}>{row.source}</span>
                            </td>
                            <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textPrimary }}>
                              {row.label || '—'}
                            </td>
                            <td style={{ padding: '4px 10px', fontFamily: C.fontMono, fontWeight: 600 }}>
                              <span style={{ color: outcomeColor(row.severity) }}>{row.severity || '—'}</span>
                            </td>
                            <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textSecondary, fontSize: 10.5 }}>
                              {row.detail || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Downlinked files */}
            <div style={{ marginBottom: 18 }}>
              <div style={sectionHeadStyle}>
                Downlinked Files
                <span style={{ marginLeft: 8, color: C.textDisabled }}>({files.length})</span>
              </div>
              {files.length === 0 ? (
                <div style={{ fontSize: 11, color: C.textDisabled, fontFamily: C.fontMono, fontStyle: 'italic' }}>
                  No assembled files for this pass.
                </div>
              ) : (
                <div style={{ border: `1px solid ${C.borderSubtle}`, borderRadius: 3, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ backgroundColor: C.bgPanelRaised }}>
                        <th style={thStyle}>Filename</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Size</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Chunks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f, i) => (
                        <tr key={f.filename} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : `${C.bgPanelRaised}55` }}>
                          <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textPrimary }}>
                            {f.filename}
                          </td>
                          <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textMuted, textAlign: 'right' }}>
                            {fmtBytes(f.totalBytes)}
                          </td>
                          <td style={{ padding: '4px 10px', fontFamily: C.fontMono, color: C.textMuted, textAlign: 'right' }}>
                            {f.chunkCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer note */}
            <div style={{
              fontSize: 10, color: C.textDisabled, fontFamily: C.fontMono,
              borderTop: `1px solid ${C.borderSubtle}`, paddingTop: 10,
            }}>
              Use "Print / Save as PDF" to export. In the print dialog, select "Save as PDF" and set layout to Portrait, A4 or Letter.
            </div>
          </div>
        )}

        {!loading && !error && !report && allPasses.length === 0 && (
          <div style={{ color: C.textMuted, fontFamily: C.fontMono, fontSize: 12, padding: 20 }}>
            No passes found. Ingest a pass file first.
          </div>
        )}
      </div>
    </div>
  );
}
