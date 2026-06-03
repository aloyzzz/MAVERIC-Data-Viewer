import { useState, useRef, useCallback, CSSProperties } from 'react';
import { C } from '../lib/colors';

/* ─── types ──────────────────────────────────────────────────────────────── */

interface IngestResult {
  passId: number;
  sessionId: string;
  counts: Record<string, number>;
  skipped: number;
  warnings: string[];
}

type Phase = 'idle' | 'ready' | 'ingesting' | 'done' | 'error';

/* ─── shared styles ──────────────────────────────────────────────────────── */

const mono: CSSProperties = { fontFamily: C.fontMono };

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9.5, ...mono, textTransform: 'uppercase',
      letterSpacing: '0.1em', color: C.textDisabled, marginBottom: 4,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      padding: '6px 16px', fontSize: 9.5, ...mono,
      letterSpacing: '0.1em', textTransform: 'uppercase',
      color: C.textDisabled, backgroundColor: C.bgApp,
      borderBottom: `1px solid ${C.borderSubtle}`,
      borderTop: `1px solid ${C.borderSubtle}`,
    }}>
      {label}
    </div>
  );
}

const EVENT_KIND_LABELS: Record<string, string> = {
  rx_packet:    'RX Packets',
  tx_command:   'TX Commands',
  parameter:    'Parameters',
  alarm:        'Alarms',
  cmd_verifier: 'CMD Verifiers',
  radio:        'Radio Events',
};

/* ─── main component ─────────────────────────────────────────────────────── */

export function IngestPage() {
  const [phase, setPhase]       = useState<Phase>('idle');
  const [file, setFile]         = useState<File | null>(null);
  const [preview, setPreview]   = useState<{ lines: number; kinds: Record<string, number> } | null>(null);
  const [result, setResult]     = useState<IngestResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* parse a quick preview of the file without sending it yet */
  const parsePreview = useCallback((f: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter((l) => l.trim());
      const kinds: Record<string, number> = {};
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          const k = String(obj['event_kind'] ?? 'unknown');
          kinds[k] = (kinds[k] ?? 0) + 1;
        } catch { /* skip */ }
      }
      setPreview({ lines: lines.length, kinds });
    };
    reader.readAsText(f);
  }, []);

  const acceptFile = useCallback((f: File) => {
    setFile(f);
    setPhase('ready');
    setResult(null);
    setError(null);
    setPreview(null);
    parsePreview(f);
  }, [parsePreview]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }, [acceptFile]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
  };

  const handleIngest = async () => {
    if (!file) return;
    setPhase('ingesting');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/ingest', { method: 'POST', body: form });
      const data = await res.json() as IngestResult | { error: string };
      if ('error' in data) {
        setError(data.error);
        setPhase('error');
      } else {
        setResult(data);
        setPhase('done');
      }
    } catch (err) {
      setError(String(err));
      setPhase('error');
    }
  };

  const handleReset = () => {
    setPhase('idle');
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const totalPreview = preview ? Object.values(preview.kinds).reduce((a, b) => a + b, 0) : 0;
  const totalResult  = result  ? Object.values(result.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 860 }}>

        {/* ── title bar ── */}
        <div style={{
          padding: '8px 16px',
          backgroundColor: C.bgPanel,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 4,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 9.5, ...mono, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.textMuted }}>
            ingest
          </span>
          <span style={{ fontSize: 15, ...mono, color: C.textPrimary }}>Database Ingestion</span>
          <span style={{ fontSize: 11, color: C.textDisabled, ...mono }}>
            Import a .jsonl pass file into ground_station.db
          </span>
        </div>

        {/* ── drop zone ── */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${dragging ? C.active : phase === 'ready' || phase === 'done' ? C.success + '88' : C.borderStrong}`,
            borderRadius: 6,
            padding: '32px 24px',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10,
            backgroundColor: dragging ? C.activeFill : C.bgPanel,
            cursor: phase === 'ingesting' ? 'default' : 'pointer',
            transition: 'border-color 0.15s, background-color 0.15s',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".jsonl,.ndjson"
            style={{ display: 'none' }}
            onChange={onInputChange}
            disabled={phase === 'ingesting'}
          />
          <div style={{ fontSize: 28, opacity: 0.35 }}>
            {phase === 'done' ? '✓' : phase === 'error' ? '⚠' : '⇪'}
          </div>
          {phase === 'idle' && (
            <>
              <div style={{ fontSize: 13, ...mono, color: C.textPrimary }}>
                Drop a .jsonl file here or click to browse
              </div>
              <div style={{ fontSize: 10.5, ...mono, color: C.textDisabled }}>
                Supports MAVERIC ground station session exports (.jsonl)
              </div>
            </>
          )}
          {(phase === 'ready' || phase === 'ingesting') && file && (
            <>
              <div style={{ fontSize: 13, ...mono, color: C.textPrimary }}>{file.name}</div>
              <div style={{ fontSize: 10.5, ...mono, color: C.textDisabled }}>
                {(file.size / 1024).toFixed(1)} KB
                {preview && ` · ${preview.lines.toLocaleString()} lines · ${totalPreview.toLocaleString()} events`}
              </div>
            </>
          )}
          {phase === 'done' && result && (
            <div style={{ fontSize: 13, ...mono, color: C.success }}>
              Ingested {totalResult.toLocaleString()} events → pass_id {result.passId}
            </div>
          )}
          {phase === 'error' && (
            <div style={{ fontSize: 13, ...mono, color: C.danger }}>{error}</div>
          )}
        </div>

        {/* ── preview breakdown ── */}
        {preview && (phase === 'ready' || phase === 'ingesting') && (
          <div style={{
            backgroundColor: C.bgPanel,
            border: `1px solid ${C.borderSubtle}`,
            borderRadius: 4, overflow: 'hidden',
          }}>
            <SectionHeader label="file preview" />
            <div style={{ padding: '10px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {Object.entries(preview.kinds).map(([kind, n]) => (
                <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Label>{EVENT_KIND_LABELS[kind] ?? kind}</Label>
                  <span style={{ fontSize: 20, ...mono, color: C.active, lineHeight: 1 }}>
                    {n.toLocaleString()}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Label>total lines</Label>
                <span style={{ fontSize: 20, ...mono, color: C.textPrimary, lineHeight: 1 }}>
                  {preview.lines.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── result breakdown ── */}
        {phase === 'done' && result && (
          <div style={{
            backgroundColor: C.bgPanel,
            border: `1px solid ${C.success}55`,
            borderRadius: 4, overflow: 'hidden',
          }}>
            <SectionHeader label="ingest result" />
            <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Label>pass id</Label>
                  <span style={{ fontSize: 20, ...mono, color: C.active, lineHeight: 1 }}>{result.passId}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Label>session</Label>
                  <span style={{ fontSize: 11, ...mono, color: C.textSecondary }}>{result.sessionId}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Label>skipped</Label>
                  <span style={{ fontSize: 20, ...mono, color: result.skipped > 0 ? C.warning : C.textDisabled, lineHeight: 1 }}>
                    {result.skipped}
                  </span>
                </div>
              </div>

              <div style={{ height: 1, backgroundColor: C.borderSubtle }} />

              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {Object.entries(result.counts).map(([kind, n]) => (
                  <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Label>{EVENT_KIND_LABELS[kind] ?? kind}</Label>
                    <span style={{ fontSize: 18, ...mono, color: C.success, lineHeight: 1 }}>
                      {n.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              {result.warnings.length > 0 && (
                <>
                  <div style={{ height: 1, backgroundColor: C.borderSubtle }} />
                  <div>
                    <Label>warnings ({result.warnings.length})</Label>
                    <div style={{
                      marginTop: 6, maxHeight: 120, overflow: 'auto',
                      backgroundColor: C.bgApp, border: `1px solid ${C.warning}44`,
                      borderRadius: 3, padding: '6px 10px',
                    }}>
                      {result.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 10, ...mono, color: C.warning, lineHeight: 1.6 }}>{w}</div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── action bar ── */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(phase === 'ready' || phase === 'ingesting') && (
            <button
              onClick={handleIngest}
              disabled={phase === 'ingesting'}
              style={{
                padding: '8px 28px', fontSize: 12.5, ...mono,
                fontWeight: 700, borderRadius: 4, border: 'none',
                backgroundColor: phase === 'ingesting' ? C.bgPanelRaised : C.active,
                color: phase === 'ingesting' ? C.textDisabled : C.bgApp,
                cursor: phase === 'ingesting' ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (phase !== 'ingesting') (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ''; }}
            >
              {phase === 'ingesting' ? '⟳ ingesting…' : '↑ Ingest into Database'}
            </button>
          )}

          {(phase === 'ready' || phase === 'done' || phase === 'error') && (
            <button
              onClick={handleReset}
              style={{
                padding: '8px 16px', fontSize: 11, ...mono,
                borderRadius: 4,
                backgroundColor: C.bgPanelRaised, color: C.textMuted,
                border: `1px solid ${C.borderSubtle}`, cursor: 'pointer',
              }}
            >
              {phase === 'done' ? '+ Ingest Another' : '✕ Clear'}
            </button>
          )}

          {phase === 'ingesting' && (
            <span style={{ fontSize: 10.5, ...mono, color: C.textDisabled }}>
              Processing {preview?.lines.toLocaleString()} lines…
            </span>
          )}

          {phase === 'done' && (
            <span style={{ fontSize: 10.5, ...mono, color: C.success }}>
              ● Database updated — refresh the Dashboard to see the new pass
            </span>
          )}
        </div>

      </div>
    </div>
  );
}
