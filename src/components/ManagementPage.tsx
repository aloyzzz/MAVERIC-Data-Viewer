import { useCallback, useEffect, useMemo, useState } from 'react';
import { C } from '../lib/colors';
import type { AppSchema } from '../types';

type Phase = 'idle' | 'running' | 'done' | 'error';

type DeployRole = 'data' | 'web';

interface AppliedState {
  generation: number;
  sha: string;
  status: 'idle' | 'deploying' | 'ok' | 'error';
  message: string;
  at: string;
}

interface DeployStatus {
  requested: { generation: number; branch: string; at: string; by: string };
  applied: Record<DeployRole, AppliedState | null>;
}

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

  const [deleteFiles, setDeleteFiles] = useState(true);
  const [deletingPassId, setDeletingPassId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [clearPhase, setClearPhase] = useState<Phase>('idle');
  const [clearError, setClearError] = useState('');

  const [updatePhase, setUpdatePhase] = useState<Phase>('idle');
  const [updateError, setUpdateError] = useState('');
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);

  const refreshDeployStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/deploy/status');
      if (res.ok) setDeployStatus(await res.json() as DeployStatus);
    } catch { /* non-fatal */ }
  }, []);

  // Poll deploy status while unlocked so the per-host progress stays live.
  useEffect(() => {
    if (!unlocked) return;
    void refreshDeployStatus();
    const id = setInterval(() => { void refreshDeployStatus(); }, 5000);
    return () => clearInterval(id);
  }, [unlocked, refreshDeployStatus]);

  const triggerUpdate = async () => {
    if (!window.confirm('Pull the latest release, rebuild, and restart the data and web servers? Active sessions will briefly disconnect while each host restarts.')) return;
    setUpdatePhase('running');
    setUpdateError('');
    try {
      const res = await fetch('/api/management/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json() as DeployStatus | { error?: string };
      if (!res.ok || !('requested' in data)) {
        setUpdateError('error' in data && data.error ? data.error : 'Update request failed');
        setUpdatePhase('error');
        return;
      }
      setDeployStatus(data);
      setUpdatePhase('done');
      void refreshDeployStatus();
    } catch (err) {
      setUpdateError(String(err));
      setUpdatePhase('error');
    }
  };

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

  const deletePass = async (passId: number) => {
    if (!window.confirm(`Delete pass_${passId} and all its derived data${deleteFiles ? ', including stored files' : ''}? This cannot be undone.`)) return;
    setDeletingPassId(passId);
    setDeleteError('');
    try {
      const res = await fetch('/api/management/passes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, passIds: [passId], deleteFiles }),
      });
      const data = await res.json() as { deleted?: number[]; errors?: { passId: number; error: string }[]; error?: string };
      if (!res.ok || (data.errors && data.errors.length > 0)) {
        setDeleteError(data.error ?? data.errors?.[0]?.error ?? 'Delete failed');
        return;
      }
      onSchemaRefresh?.();
      onDataRefresh?.();
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeletingPassId(null);
    }
  };

  const clearDatabase = async () => {
    if (passIds.length === 0) return;
    if (!window.confirm(`Delete ALL ${passIds.length} pass${passIds.length !== 1 ? 'es' : ''} and every derived table${deleteFiles ? ', including stored files' : ''}? This wipes the database and cannot be undone.`)) return;
    if (!window.confirm('Are you absolutely sure? This is irreversible.')) return;
    setClearPhase('running');
    setClearError('');
    try {
      const res = await fetch('/api/management/clear-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, deleteFiles }),
      });
      const data = await res.json() as { ok?: boolean; deletedPasses?: number; error?: string };
      if (!res.ok || !data.ok) {
        setClearError(data.error ?? 'Clear failed');
        setClearPhase('error');
        return;
      }
      setClearPhase('done');
      onSchemaRefresh?.();
      onDataRefresh?.();
    } catch (err) {
      setClearError(String(err));
      setClearPhase('error');
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
            Software updates
          </div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 14, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 12, ...mono, color: C.textPrimary, marginBottom: 4 }}>Update &amp; restart servers</div>
              <div style={{ fontSize: 11, ...mono, color: C.textMuted, lineHeight: 1.5 }}>
                Requests the keep-alive supervisors on the data and web hosts to pull the latest
                {deployStatus?.requested.branch ? ` \`${deployStatus.requested.branch}\`` : ' release'} branch,
                rebuild, and restart. Each host applies the update on its next poll.
              </div>
            </div>
            <button onClick={() => void triggerUpdate()} disabled={updatePhase === 'running'} style={btnStyle('danger', updatePhase === 'running')}>
              {updatePhase === 'running' ? 'Requesting...' : 'Update & Restart'}
            </button>
            <div style={{ gridColumn: '1 / -1' }}>
              {updatePhase === 'done' && (
                <div style={{ fontSize: 10.5, ...mono, color: C.success, marginBottom: 8 }}>
                  Update requested (generation {deployStatus?.requested.generation}). Supervisors will apply it shortly.
                </div>
              )}
              {updatePhase === 'error' && <div style={{ fontSize: 10.5, ...mono, color: C.danger, marginBottom: 8 }}>{updateError}</div>}
              {deployStatus && (
                <div style={{
                  backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`,
                  borderRadius: 3, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  <div style={{ fontSize: 10, ...mono, color: C.textDisabled }}>
                    requested generation {deployStatus.requested.generation}
                    {deployStatus.requested.at ? ` · ${new Date(deployStatus.requested.at).toLocaleString()}` : ''}
                  </div>
                  {(['data', 'web'] as DeployRole[]).map((role) => {
                    const a = deployStatus.applied[role];
                    const behind = a ? a.generation < deployStatus.requested.generation : true;
                    const color =
                      !a ? C.textDisabled
                      : a.status === 'error' ? C.danger
                      : a.status === 'deploying' ? C.warning
                      : behind ? C.warning
                      : C.success;
                    const label =
                      !a ? 'no report yet'
                      : a.status === 'deploying' ? 'deploying...'
                      : a.status === 'error' ? `error: ${a.message}`
                      : behind ? `behind (gen ${a.generation})`
                      : `up to date (gen ${a.generation}${a.sha ? `, ${a.sha}` : ''})`;
                    return (
                      <div key={role} style={{ fontSize: 10.5, ...mono, color, display: 'flex', gap: 8 }}>
                        <span style={{ width: 42, color: C.textMuted }}>{role}</span>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
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

        <div style={{ backgroundColor: C.bgPanel, border: `1px solid ${C.danger}44`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.borderSubtle}`, fontSize: 10.5, ...mono, color: C.danger, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Danger zone
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, ...mono, color: C.textMuted, cursor: 'pointer' }}>
              <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
              Also delete stored files (`assembled_files/` and `ingested_jsonl/`) for removed passes
            </label>

            <div>
              <div style={{ fontSize: 12, ...mono, color: C.textPrimary, marginBottom: 4 }}>Delete individual passes</div>
              <div style={{ fontSize: 11, ...mono, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 }}>
                Removes the pass event table plus its `decoded_telemetry`, `satellite_values`, `pass_files` and cross-pass chunks.
              </div>
              {passIds.length === 0 ? (
                <div style={{ fontSize: 10.5, ...mono, color: C.textDisabled }}>No passes in database.</div>
              ) : (
                <div style={{
                  maxHeight: 200, overflow: 'auto',
                  backgroundColor: C.bgApp, border: `1px solid ${C.borderSubtle}`, borderRadius: 3,
                }}>
                  {passIds.map((id) => (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 10px', borderBottom: `1px solid ${C.borderSubtle}` }}>
                      <span style={{ fontSize: 11, ...mono, color: C.textPrimary }}>pass_{id}</span>
                      <button
                        onClick={() => void deletePass(id)}
                        disabled={deletingPassId !== null || clearPhase === 'running'}
                        style={btnStyle('danger', deletingPassId !== null || clearPhase === 'running')}
                      >
                        {deletingPassId === id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {deleteError && <div style={{ fontSize: 10.5, ...mono, color: C.danger, marginTop: 8 }}>{deleteError}</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 14, alignItems: 'start', borderTop: `1px solid ${C.borderSubtle}`, paddingTop: 14 }}>
              <div>
                <div style={{ fontSize: 12, ...mono, color: C.textPrimary, marginBottom: 4 }}>Clear entire database</div>
                <div style={{ fontSize: 11, ...mono, color: C.textMuted, lineHeight: 1.5 }}>
                  Deletes every pass and all derived tables, plus the cross-pass reassembly store. Irreversible. Take a backup first.
                </div>
              </div>
              <button
                onClick={() => void clearDatabase()}
                disabled={passIds.length === 0 || clearPhase === 'running' || deletingPassId !== null}
                style={btnStyle('danger', passIds.length === 0 || clearPhase === 'running' || deletingPassId !== null)}
              >
                {clearPhase === 'running' ? 'Clearing...' : 'Clear Database'}
              </button>
              <div style={{ gridColumn: '1 / -1' }}>
                {clearPhase === 'done' && <div style={{ fontSize: 10.5, ...mono, color: C.success }}>Database cleared.</div>}
                {clearPhase === 'error' && <div style={{ fontSize: 10.5, ...mono, color: C.danger }}>{clearError}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
