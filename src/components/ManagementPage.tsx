import { useMemo, useState } from 'react';
import { C } from '../lib/colors';
import type { AppSchema } from '../types';

type Phase = 'idle' | 'running' | 'done' | 'error';

interface ManagementPageProps {
  schema: AppSchema;
  onSchemaRefresh?: () => void;
  onDataRefresh?: () => void;
}

interface ReDecodeResult {
  passId: number;
  count: number;
  error?: string;
}

const mono = { fontFamily: C.fontMono };

function passIdsFromSchema(schema: AppSchema): number[] {
  const passGroup = schema.schemas.find((s) => s.name === 'passes');
  return (passGroup?.tables ?? [])
    .map((table) => /^pass_(\d+)$/.exec(table.id)?.[1])
    .filter((id): id is string => Boolean(id))
    .map(Number)
    .sort((a, b) => a - b);
}

function btnStyle(tone: 'normal' | 'danger' = 'normal', disabled = false) {
  const color = tone === 'danger' ? C.danger : C.textPrimary;
  return {
    padding: '7px 14px',
    fontSize: 11,
    ...mono,
    borderRadius: 3,
    border: `1px solid ${tone === 'danger' ? C.danger + '55' : C.borderStrong}`,
    backgroundColor: disabled ? C.bgPanelRaised : C.bgApp,
    color: disabled ? C.textDisabled : color,
    cursor: disabled ? 'not-allowed' : 'pointer',
  } as const;
}

function ResultList({ results }: { results: ReDecodeResult[] }) {
  if (results.length === 0) return null;
  return (
    <div style={{
      maxHeight: 170, overflow: 'auto',
      backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`,
      borderRadius: 3, padding: '7px 10px',
    }}>
      {results.map(r => (
        <div key={r.passId} style={{ fontSize: 10.5, ...mono, lineHeight: 1.7, color: r.error ? C.danger : C.textMuted }}>
          pass_{r.passId}: {r.error ? r.error : `${r.count.toLocaleString()} values`}
        </div>
      ))}
    </div>
  );
}

export function ManagementPage({ schema, onSchemaRefresh, onDataRefresh }: ManagementPageProps) {
  const passIds = useMemo(() => passIdsFromSchema(schema), [schema]);
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const [redecodePhase, setRedecodePhase] = useState<Phase>('idle');
  const [redecodeResults, setRedecodeResults] = useState<ReDecodeResult[]>([]);
  const [redecodeError, setRedecodeError] = useState('');

  const [valuesPhase, setValuesPhase] = useState<Phase>('idle');
  const [valuesResults, setValuesResults] = useState<ReDecodeResult[]>([]);
  const [valuesError, setValuesError] = useState('');

  const [backupPhase, setBackupPhase] = useState<Phase>('idle');
  const [backupError, setBackupError] = useState('');

  const unlock = async () => {
    setUnlockError('');
    try {
      const res = await fetch('/api/management/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setUnlockError(body.error ?? 'Unlock failed');
        return;
      }
      setUnlocked(true);
    } catch (err) {
      setUnlockError(String(err));
    }
  };

  const rebuildDecoded = async () => {
    if (!window.confirm('Rebuild decoded telemetry and satellite values for every pass?')) return;
    setRedecodePhase('running');
    setRedecodeResults([]);
    setRedecodeError('');
    try {
      const res = await fetch('/api/management/redecode-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json() as ReDecodeResult[] | { error?: string };
      if (!res.ok || !Array.isArray(data)) {
        setRedecodeError(Array.isArray(data) ? 'Rebuild failed' : data.error ?? 'Rebuild failed');
        setRedecodePhase('error');
        return;
      }
      setRedecodeResults(data);
      setRedecodePhase('done');
      onSchemaRefresh?.();
      onDataRefresh?.();
    } catch (err) {
      setRedecodeError(String(err));
      setRedecodePhase('error');
    }
  };

  const rebuildValues = async () => {
    if (passIds.length === 0) return;
    if (!window.confirm('Rebuild only satellite_values for every pass?')) return;
    setValuesPhase('running');
    setValuesResults([]);
    setValuesError('');
    try {
      const res = await fetch('/api/management/values/materialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, passIds }),
      });
      const data = await res.json() as Record<string, number> | { error?: string };
      if (!res.ok || 'error' in data) {
        const message = 'error' in data && typeof data.error === 'string' ? data.error : 'Rebuild failed';
        setValuesError(message);
        setValuesPhase('error');
        return;
      }
      setValuesResults(Object.entries(data).map(([passId, count]) => ({ passId: Number(passId), count })));
      setValuesPhase('done');
      onDataRefresh?.();
    } catch (err) {
      setValuesError(String(err));
      setValuesPhase('error');
    }
  };

  const downloadBackup = async () => {
    setBackupPhase('running');
    setBackupError('');
    try {
      const res = await fetch('/api/management/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setBackupError(body.error ?? `Backup failed (${res.status})`);
        setBackupPhase('error');
        return;
      }
      const blob = await res.blob();
      const disp = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="?([^"]+)"?/.exec(disp);
      const name = match?.[1] ?? `maveric-backup-${Date.now()}.tar.gz`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupPhase('done');
    } catch (err) {
      setBackupError(String(err));
      setBackupPhase('error');
    }
  };

  if (!unlocked) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{
          width: 360,
          backgroundColor: C.bgPanel,
          border: `1px solid ${C.borderSubtle}`,
          borderRadius: 4,
          padding: 22,
        }}>
          <div style={{ fontSize: 13, ...mono, color: C.textPrimary, marginBottom: 8 }}>Management Access</div>
          <div style={{ fontSize: 11, ...mono, color: C.textMuted, lineHeight: 1.5, marginBottom: 14 }}>
            Enter the management password to access database rebuild and migration tools.
          </div>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void unlock(); }}
            placeholder="management password"
            style={{
              width: '100%', boxSizing: 'border-box',
              backgroundColor: C.bgApp, color: C.textPrimary,
              border: `1px solid ${C.borderStrong}`, borderRadius: 3,
              padding: '7px 9px', ...mono, fontSize: 12,
              outline: 'none', marginBottom: 10,
            }}
          />
          {unlockError && <div style={{ color: C.danger, fontSize: 10.5, ...mono, marginBottom: 10 }}>{unlockError}</div>}
          <button
            onClick={() => void unlock()}
            disabled={!password}
            style={{ ...btnStyle('normal', !password), width: '100%' }}
          >
            Unlock Management
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 18 }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 16, ...mono, color: C.textPrimary }}>Management</div>
          <div style={{ fontSize: 11, ...mono, color: C.textMuted }}>
            {passIds.length.toLocaleString()} pass{passIds.length !== 1 ? 'es' : ''} available
          </div>
          <button onClick={() => setUnlocked(false)} style={{ ...btnStyle(), marginLeft: 'auto' }}>Lock</button>
        </div>

        <div style={{ backgroundColor: C.bgPanel, border: `1px solid ${C.borderSubtle}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.borderSubtle}`, fontSize: 10.5, ...mono, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Database rebuilds
          </div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 14, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 12, ...mono, color: C.textPrimary, marginBottom: 4 }}>Rebuild decoded telemetry</div>
              <div style={{ fontSize: 11, ...mono, color: C.textMuted, lineHeight: 1.5 }}>
                Clears and re-derives `decoded_telemetry` and `satellite_values` for every pass from raw event tables.
              </div>
            </div>
            <button onClick={() => void rebuildDecoded()} disabled={redecodePhase === 'running'} style={btnStyle('danger', redecodePhase === 'running')}>
              {redecodePhase === 'running' ? 'Rebuilding...' : 'Rebuild All'}
            </button>
            <div style={{ gridColumn: '1 / -1' }}>
              {redecodePhase === 'done' && (
                <div style={{ fontSize: 10.5, ...mono, color: C.success, marginBottom: 8 }}>
                  Done: {redecodeResults.length} pass{redecodeResults.length !== 1 ? 'es' : ''} processed.
                </div>
              )}
              {redecodePhase === 'error' && <div style={{ fontSize: 10.5, ...mono, color: C.danger, marginBottom: 8 }}>{redecodeError}</div>}
              <ResultList results={redecodeResults} />
            </div>
          </div>
        </div>

        <div style={{ backgroundColor: C.bgPanel, border: `1px solid ${C.borderSubtle}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.borderSubtle}`, fontSize: 10.5, ...mono, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Analysis table
          </div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 14, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 12, ...mono, color: C.textPrimary, marginBottom: 4 }}>Rebuild satellite values only</div>
              <div style={{ fontSize: 11, ...mono, color: C.textMuted, lineHeight: 1.5 }}>
                Rebuilds the canonical `satellite_values` analysis table without rewriting `decoded_telemetry`.
              </div>
            </div>
            <button onClick={() => void rebuildValues()} disabled={valuesPhase === 'running' || passIds.length === 0} style={btnStyle('normal', valuesPhase === 'running' || passIds.length === 0)}>
              {valuesPhase === 'running' ? 'Rebuilding...' : 'Rebuild Values'}
            </button>
            <div style={{ gridColumn: '1 / -1' }}>
              {valuesPhase === 'done' && (
                <div style={{ fontSize: 10.5, ...mono, color: C.success, marginBottom: 8 }}>
                  Done: {valuesResults.length} pass{valuesResults.length !== 1 ? 'es' : ''} processed.
                </div>
              )}
              {valuesPhase === 'error' && <div style={{ fontSize: 10.5, ...mono, color: C.danger, marginBottom: 8 }}>{valuesError}</div>}
              <ResultList results={valuesResults} />
            </div>
          </div>
        </div>

        <div style={{ backgroundColor: C.bgPanel, border: `1px solid ${C.borderSubtle}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.borderSubtle}`, fontSize: 10.5, ...mono, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Backups
          </div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 14, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 12, ...mono, color: C.textPrimary, marginBottom: 4 }}>Download full backup</div>
              <div style={{ fontSize: 11, ...mono, color: C.textMuted, lineHeight: 1.5 }}>
                Builds a single `.tar.gz` containing a `pg_dump` of the database plus the `assembled_files/` and `ingested_jsonl/` directories. Restore on the server with `scripts/restore.sh &lt;backup.tar.gz&gt;`.
              </div>
            </div>
            <button onClick={() => void downloadBackup()} disabled={backupPhase === 'running'} style={btnStyle('normal', backupPhase === 'running')}>
              {backupPhase === 'running' ? 'Building...' : 'Create & Download'}
            </button>
            <div style={{ gridColumn: '1 / -1' }}>
              {backupPhase === 'done' && (
                <div style={{ fontSize: 10.5, ...mono, color: C.success }}>Backup downloaded.</div>
              )}
              {backupPhase === 'error' && <div style={{ fontSize: 10.5, ...mono, color: C.danger }}>{backupError}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
