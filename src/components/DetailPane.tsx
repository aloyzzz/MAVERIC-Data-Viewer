import { useState } from 'react';
import { C, toneOf, toneColor, frameColor } from '../lib/colors';
import type { ColumnDef, Row, TableMeta } from '../types';
import { Sparkline } from './Sparkline';

interface DetailPaneProps {
  row: Row | null;
  columns: ColumnDef[];
  table: TableMeta;
  onClose: () => void;
  onPassDeleted?: () => void;
  position?: 'right' | 'bottom';
}

// Sparkline demo only shown for pass event tables (pattern pass_<id>)
function isPassTable(id: string) { return /^pass_\d+$/.test(id); }

function btnStyle(tone?: string) {
  const clr = tone ? toneColor(tone as Parameters<typeof toneColor>[0]) : C.textMuted;
  return {
    background: 'transparent',
    border: `1px solid ${tone ? clr + '33' : C.borderSubtle}`,
    color: clr,
    padding: '3px 8px',
    borderRadius: 3,
    fontSize: 10.5,
    fontFamily: C.fontMono,
    cursor: 'pointer',
  } as const;
}

export function DetailPane({ row, columns, table, onClose, onPassDeleted, position = 'right' }: DetailPaneProps) {
  const sizeStyle = position === 'right'
    ? { flex: '0 0 360px', borderLeft: `1px solid ${C.borderSubtle}` }
    : { flex: '0 0 240px', borderTop: `1px solid ${C.borderSubtle}` };

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Collapsed rail: a thin strip with an expand control, only for the side pane.
  if (collapsed && position === 'right') {
    return (
      <div style={{
        flex: '0 0 34px',
        borderLeft: `1px solid ${C.borderSubtle}`,
        backgroundColor: C.bgPanel,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        padding: '8px 0',
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="expand row inspector"
          style={{
            background: 'transparent', border: `1px solid ${C.borderSubtle}`,
            color: C.active, cursor: 'pointer', borderRadius: 3,
            width: 22, height: 22, fontSize: 12, lineHeight: 1,
          }}
        >◀</button>
        <span style={{
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontSize: 9.5, fontFamily: C.fontMono, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: row ? C.active : C.textDisabled,
        }}>
          row inspector{row ? ` · #${(row.__idx + 1).toString().padStart(4, '0')}` : ''}
        </span>
      </div>
    );
  }

  if (!row) {
    return (
      <div style={{
        ...sizeStyle,
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: C.bgPanel,
        color: C.textDisabled,
        fontFamily: C.fontMono,
        fontSize: 11,
        textAlign: 'center',
        padding: 20,
      }}>
        {position === 'right' && (
          <button onClick={() => setCollapsed(true)} title="minimize inspector" style={{
            position: 'absolute', top: 8, right: 8,
            background: 'transparent', border: 0,
            color: C.textDisabled, cursor: 'pointer', fontSize: 13, padding: '0 4px',
          }}>▶</button>
        )}
        <div>
          <div style={{ marginBottom: 8, fontSize: 28, opacity: 0.3 }}>▦</div>
          <div>select a row to inspect</div>
          <div style={{ marginTop: 4, color: C.textDisabled, fontSize: 10 }}>click any row · Esc to deselect</div>
        </div>
      </div>
    );
  }

  const handleCopyJson = () => {
    const { __idx, ...data } = row;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  const handleDeletePass = async () => {
    if (deletePassId == null) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const resp = await fetch(`/api/passes/${deletePassId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput, deleteFiles }),
      });
      if (!resp.ok) {
        const body = await resp.json() as { error?: string };
        setDeleteError(body.error ?? 'Delete failed');
        setDeleting(false);
        return;
      }
      setShowDeleteModal(false);
      onClose();
      onPassDeleted?.();
    } catch (e) {
      setDeleteError(String(e));
      setDeleting(false);
    }
  };

  const isPassesTable = table.id === 'passes';
  const passEventMatch = /^pass_(\d+)$/.exec(table.id);
  const deletePassId: number | null = isPassesTable
    ? (row['pass_id'] != null ? Number(row['pass_id']) : null)
    : passEventMatch ? Number(passEventMatch[1]) : null;
  const showDeleteBtn = deletePassId != null;

  return (
    <div style={{
      ...sizeStyle,
      display: 'flex', flexDirection: 'column',
      backgroundColor: C.bgPanel,
      minHeight: 0,
      animation: 'detail-swap-anim 250ms cubic-bezier(0.16, 1, 0.3, 1)',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${C.borderStrong}`,
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 9.5, fontFamily: C.fontMono, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.active }}>
          row inspector
        </span>
        <span style={{ color: C.textDisabled, fontSize: 10 }}>·</span>
        <span style={{ fontSize: 11, color: C.textPrimary, fontFamily: C.fontMono }}>{table.label}</span>
        <span style={{ color: C.textDisabled, fontSize: 10 }}>·</span>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: C.fontMono }}>
          #{(row.__idx + 1).toString().padStart(4, '0')}
        </span>
        {position === 'right' && (
          <button onClick={() => setCollapsed(true)} title="minimize inspector" style={{
            marginLeft: 'auto', background: 'transparent', border: 0,
            color: C.textDisabled, cursor: 'pointer', fontSize: 13, padding: '0 4px',
          }}>▶</button>
        )}
        <button onClick={onClose} title="deselect row" style={{
          marginLeft: position === 'right' ? 0 : 'auto', background: 'transparent', border: 0,
          color: C.textDisabled, cursor: 'pointer', fontSize: 14, padding: '0 4px',
        }}>×</button>
      </div>

      <div style={{ overflow: 'auto', flex: 1, fontFamily: C.fontMono, fontSize: 11 }}>
        {columns.map((col) => {
          const v = row[col.id];
          let valColor: string = C.textPrimary;
          const valText = v == null ? 'NULL' : String(v);
          if (v == null) valColor = C.textDisabled;
          if (col.type === 'tag' && v) valColor = toneColor(toneOf(String(v)));
          if (col.type === 'frame' && v) valColor = frameColor(String(v));
          if (col.type === 'bool') valColor = (v === 'True' || v === true || v === 1) ? C.success : C.danger;

          return (
            <div key={col.id} style={{
              display: 'flex',
              padding: '6px 12px',
              borderBottom: `1px solid ${C.borderSubtle}`,
              gap: 10,
              alignItems: 'baseline',
            }}>
              <div style={{ flex: '0 0 110px', color: C.textMuted, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col.label}
                {col.fk && <span style={{ marginLeft: 4, color: C.info, fontSize: 9 }}>FK</span>}
              </div>
              <div style={{ flex: 1, color: valColor, wordBreak: 'break-all', fontSize: 11 }}>
                {valText}
              </div>
              <div style={{ flex: '0 0 auto', color: C.textDisabled, fontSize: 9.5, textTransform: 'uppercase' }}>
                {col.type}
              </div>
            </div>
          );
        })}

        {isPassTable(table.id) && (
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borderSubtle}` }}>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ◊ value · last 60 samples
            </div>
            <Sparkline seed={row.__idx} color={C.active} />
          </div>
        )}
      </div>

      <div style={{
        padding: '8px 12px',
        borderTop: `1px solid ${C.borderStrong}`,
        display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0,
      }}>
        <button onClick={handleCopyJson} style={btnStyle()}>Copy JSON</button>
        <button style={btnStyle('info')}>Open FK</button>
        {showDeleteBtn && (
          <button
            onClick={() => { setPasswordInput(''); setDeleteError(''); setDeleteFiles(true); setShowDeleteModal(true); }}
            style={{ ...btnStyle('danger'), marginLeft: 'auto' }}
          >
            Delete Pass
          </button>
        )}
      </div>

      {showDeleteModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          backgroundColor: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}
        >
          <div style={{
            backgroundColor: C.bgPanel,
            border: `1px solid ${C.borderStrong}`,
            borderRadius: 6,
            padding: 24,
            width: 320,
            fontFamily: C.fontMono,
            fontSize: 12,
          }}>
            <div style={{ color: C.danger, fontWeight: 600, marginBottom: 12, fontSize: 13 }}>
              Delete Pass {deletePassId}
            </div>
            <div style={{ color: C.textMuted, marginBottom: 16, fontSize: 11, lineHeight: 1.5 }}>
              This will permanently delete the pass, all its events, and all decoded telemetry.
              This action cannot be undone.
            </div>
            <label style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              color: C.textMuted, fontSize: 10.5, lineHeight: 1.4,
              marginBottom: 14, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
                style={{ marginTop: 1 }}
              />
              <span>
                Delete associated files from disk, including assembled FILE packet outputs and archived ingest JSONL.
              </span>
            </label>
            <div style={{ marginBottom: 8, color: C.textMuted, fontSize: 10.5 }}>Password</div>
            <input
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDeletePass(); if (e.key === 'Escape') setShowDeleteModal(false); }}
              placeholder="enter password"
              style={{
                width: '100%', boxSizing: 'border-box',
                backgroundColor: C.bgApp, color: C.textPrimary,
                border: `1px solid ${C.borderStrong}`, borderRadius: 3,
                padding: '6px 8px', fontFamily: C.fontMono, fontSize: 12,
                marginBottom: 6,
                outline: 'none',
              }}
            />
            {deleteError && (
              <div style={{ color: C.danger, fontSize: 10.5, marginBottom: 8 }}>{deleteError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                style={btnStyle()}
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePass}
                disabled={deleting || !passwordInput}
                style={{ ...btnStyle('danger'), opacity: (deleting || !passwordInput) ? 0.5 : 1 }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
