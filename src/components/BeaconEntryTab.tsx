import { useState, useRef } from 'react';
import { C } from '../lib/colors';
import { useTableRows } from '../hooks/useApi';
import type { AppSchema } from '../types';

interface BeaconField { field: string; value: string; unit: string; }
interface BeaconPreview {
  lineIndex: number;
  hex: string;
  cmdId: string | null;
  fields: BeaconField[];
  error: string | null;
}

type Step = 'input' | 'verify' | 'done';

const inputStyle = {
  backgroundColor: C.bgApp,
  color: C.textPrimary,
  border: `1px solid ${C.borderStrong}`,
  borderRadius: 3,
  padding: '6px 8px',
  fontFamily: C.fontMono,
  fontSize: 11,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
};

const btnBase = {
  border: `1px solid ${C.borderSubtle}`,
  borderRadius: 3,
  padding: '5px 14px',
  fontFamily: C.fontMono,
  fontSize: 11,
  cursor: 'pointer',
  background: 'transparent',
} as const;

interface Props { schema: AppSchema; }

export function BeaconEntryTab({ schema }: Props) {
  const [step, setStep] = useState<Step>('input');
  const [hexText, setHexText] = useState('');
  const [previews, setPreviews] = useState<BeaconPreview[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [selectedPassId, setSelectedPassId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [insertedCount, setInsertedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Get pass list for the selector
  const { rows: passRows } = useTableRows('passes', 10000);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setHexText((ev.target?.result as string) ?? '');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handlePreview = async () => {
    const lines = hexText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { setError('No hex data entered.'); return; }
    setError('');
    setLoading(true);
    try {
      const resp = await fetch('/api/beacons/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hexLines: lines }),
      });
      const data = await resp.json() as BeaconPreview[] | { error: string };
      if (!resp.ok) { setError((data as { error: string }).error); setLoading(false); return; }
      setPreviews(data as BeaconPreview[]);
      setExpandedIdx(null);
      setStep('verify');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleInsert = async () => {
    if (selectedPassId === '') { setError('Select a pass first.'); return; }
    const validHexLines = previews.filter(p => !p.error).map(p => p.hex);
    if (validHexLines.length === 0) { setError('No valid beacons to insert.'); return; }
    setError('');
    setLoading(true);
    try {
      const resp = await fetch('/api/beacons/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hexLines: validHexLines, passId: selectedPassId }),
      });
      const data = await resp.json() as { count?: number; error?: string };
      if (!resp.ok) { setError(data.error ?? 'Insert failed'); setLoading(false); return; }
      setInsertedCount(data.count ?? 0);
      setStep('done');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep('input');
    setHexText('');
    setPreviews([]);
    setExpandedIdx(null);
    setSelectedPassId('');
    setError('');
    setInsertedCount(0);
  };

  const validCount = previews.filter(p => !p.error).length;
  const errorCount = previews.filter(p => p.error).length;

  return (
    <div style={{
      flex: 1, minHeight: 0, overflow: 'auto',
      padding: 24, fontFamily: C.fontMono, fontSize: 12,
      color: C.textPrimary,
    }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          {(['input', 'verify', 'done'] as Step[]).map((s, i) => {
            const active = step === s;
            const done = (['input', 'verify', 'done'] as Step[]).indexOf(step) > i;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <div style={{ width: 24, height: 1, backgroundColor: C.borderSubtle }} />}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  color: active ? C.active : done ? C.success : C.textDisabled,
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 10,
                    border: `1px solid ${active ? C.active : done ? C.success : C.borderSubtle}`,
                    backgroundColor: active ? C.activeFill : done ? C.successFill : 'transparent',
                  }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 11 }}>
                    {s === 'input' ? 'Enter hex' : s === 'verify' ? 'Verify' : 'Done'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Step 1: Input */}
        {step === 'input' && (
          <div>
            <div style={{ marginBottom: 16, color: C.textMuted, fontSize: 11, lineHeight: 1.7 }}>
              Paste one or more beacon hex strings (one per line), or upload a text file.
              Each line should be the raw inner frame hex as stored in <span style={{ color: C.active }}>inner_hex</span>.
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <span style={{ color: C.textMuted, fontSize: 10.5 }}>Load from file</span>
              <button onClick={() => fileRef.current?.click()} style={{ ...btnBase, color: C.info }}>
                Choose file
              </button>
              <input ref={fileRef} type="file" accept=".txt,.hex,.bin" style={{ display: 'none' }} onChange={handleFileChange} />
              {hexText && (
                <span style={{ color: C.textDisabled, fontSize: 10.5 }}>
                  {hexText.split('\n').filter(l => l.trim()).length} line(s) loaded
                </span>
              )}
            </div>

            <textarea
              value={hexText}
              onChange={(e) => setHexText(e.target.value)}
              placeholder={'90060000030600050a69746c6d5f626561636f6e00...\n90060000030600050a69746c6d5f626561636f6e00...'}
              rows={12}
              style={{
                ...inputStyle,
                resize: 'vertical',
                fontSize: 10.5,
                lineHeight: 1.6,
              }}
            />

            {error && <div style={{ color: C.danger, marginTop: 8, fontSize: 11 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={handlePreview}
                disabled={loading || !hexText.trim()}
                style={{
                  ...btnBase, color: C.active,
                  borderColor: C.active + '44',
                  backgroundColor: C.activeFill,
                  opacity: (loading || !hexText.trim()) ? 0.5 : 1,
                }}
              >
                {loading ? 'Parsing...' : 'Preview beacons'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Verify */}
        {step === 'verify' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ color: C.success }}>{validCount} valid beacon{validCount !== 1 ? 's' : ''}</span>
              {errorCount > 0 && (
                <span style={{ color: C.danger }}>{errorCount} parse error{errorCount !== 1 ? 's' : ''} (will be skipped)</span>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              {previews.map((p, i) => {
                const expanded = expandedIdx === i;
                return (
                  <div key={i} style={{
                    border: `1px solid ${p.error ? C.danger + '44' : C.borderSubtle}`,
                    borderRadius: 4, marginBottom: 6, overflow: 'hidden',
                  }}>
                    <div
                      onClick={() => setExpandedIdx(expanded ? null : i)}
                      style={{
                        padding: '7px 12px', cursor: 'pointer',
                        backgroundColor: p.error ? C.dangerFill : C.bgPanelRaised,
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}
                    >
                      <span style={{ color: C.textDisabled, fontSize: 10 }}>#{i + 1}</span>
                      {p.cmdId && (
                        <span style={{
                          color: C.active, fontSize: 10,
                          border: `1px solid ${C.active}33`,
                          backgroundColor: C.activeFill,
                          borderRadius: 3, padding: '0 5px',
                        }}>{p.cmdId}</span>
                      )}
                      {p.error
                        ? <span style={{ color: C.danger, fontSize: 10.5 }}>{p.error}</span>
                        : <span style={{ color: C.textMuted, fontSize: 10, fontFamily: C.fontMono }}>{p.hex.slice(0, 40)}...</span>
                      }
                      <span style={{ marginLeft: 'auto', color: C.textDisabled, fontSize: 10 }}>
                        {p.error ? '' : `${p.fields.length} fields`} {expanded ? '▲' : '▼'}
                      </span>
                    </div>

                    {expanded && !p.error && (
                      <div style={{ padding: '8px 0', backgroundColor: C.bgPanel }}>
                        <div style={{ padding: '0 12px 6px', color: C.textDisabled, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          Decoded fields
                        </div>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(140px,1fr) minmax(80px,1fr) 60px',
                          maxHeight: 280, overflowY: 'auto',
                        }}>
                          <div style={{ padding: '3px 12px', color: C.textDisabled, fontSize: 9.5, borderBottom: `1px solid ${C.borderSubtle}` }}>FIELD</div>
                          <div style={{ padding: '3px 12px', color: C.textDisabled, fontSize: 9.5, borderBottom: `1px solid ${C.borderSubtle}` }}>VALUE</div>
                          <div style={{ padding: '3px 12px', color: C.textDisabled, fontSize: 9.5, borderBottom: `1px solid ${C.borderSubtle}` }}>UNIT</div>
                          {p.fields.map((f, fi) => (
                            <>
                              <div key={`f${fi}`} style={{ padding: '3px 12px', color: C.textMuted, fontSize: 10.5, borderBottom: `1px solid ${C.borderSubtle}` }}>{f.field}</div>
                              <div key={`v${fi}`} style={{ padding: '3px 12px', color: C.textPrimary, fontSize: 10.5, borderBottom: `1px solid ${C.borderSubtle}` }}>{f.value}</div>
                              <div key={`u${fi}`} style={{ padding: '3px 12px', color: C.textDisabled, fontSize: 10, borderBottom: `1px solid ${C.borderSubtle}` }}>{f.unit}</div>
                            </>
                          ))}
                        </div>
                        <div style={{ padding: '8px 12px 4px', color: C.textDisabled, fontSize: 9.5 }}>
                          hex: <span style={{ color: C.textMuted, wordBreak: 'break-all' }}>{p.hex}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pass selector */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: C.textMuted, fontSize: 10.5, marginBottom: 6 }}>Insert into pass</div>
              <select
                value={selectedPassId}
                onChange={(e) => setSelectedPassId(e.target.value === '' ? '' : Number(e.target.value))}
                style={{ ...inputStyle, width: 'auto', minWidth: 260 }}
              >
                <option value="">-- select a pass --</option>
                {passRows.map((r) => (
                  <option key={String(r['pass_id'])} value={String(r['pass_id'])}>
                    Pass {String(r['pass_id'])}
                    {r['pass_date'] ? ` | ${String(r['pass_date'])}` : ''}
                    {r['source_file'] ? ` | ${String(r['source_file'])}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {error && <div style={{ color: C.danger, marginBottom: 10, fontSize: 11 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={reset} style={{ ...btnBase, color: C.textMuted }}>
                Back
              </button>
              <button
                onClick={handleInsert}
                disabled={loading || validCount === 0 || selectedPassId === ''}
                style={{
                  ...btnBase, color: C.success,
                  borderColor: C.success + '44',
                  backgroundColor: C.successFill,
                  opacity: (loading || validCount === 0 || selectedPassId === '') ? 0.5 : 1,
                }}
              >
                {loading ? 'Inserting...' : `Insert ${validCount} beacon${validCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 32, color: C.success, marginBottom: 16 }}>✓</div>
            <div style={{ color: C.textPrimary, fontSize: 14, marginBottom: 8 }}>
              {insertedCount} beacon{insertedCount !== 1 ? 's' : ''} inserted into pass {selectedPassId}
            </div>
            <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 24 }}>
              Decoded telemetry has been re-materialized. View the data in the History tab.
            </div>
            <button onClick={reset} style={{ ...btnBase, color: C.active, borderColor: C.active + '44', backgroundColor: C.activeFill }}>
              Enter more beacons
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
