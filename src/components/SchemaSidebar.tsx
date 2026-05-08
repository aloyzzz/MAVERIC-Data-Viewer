import { useState } from 'react';
import { C } from '../lib/colors';
import type { SchemaGroup } from '../types';

interface SchemaSidebarProps {
  schemas: SchemaGroup[];
  activeId: string;
  onPick: (id: string) => void;
  sidebarFilter: string;
  setSidebarFilter: (v: string) => void;
}

export function SchemaSidebar({ schemas, activeId, onPick, sidebarFilter, setSidebarFilter }: SchemaSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const filt = sidebarFilter.toLowerCase();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: 240, flexShrink: 0,
      backgroundColor: C.bgPanel,
      borderRight: `1px solid ${C.borderSubtle}`,
      minHeight: 0,
    }}>
      <div style={{
        padding: '8px 10px',
        borderBottom: `1px solid ${C.borderSubtle}`,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 9.5, fontFamily: C.fontMono, letterSpacing: '0.1em', color: C.textMuted, textTransform: 'uppercase' }}>
          db /
        </span>
        <span style={{ fontSize: 11.5, fontFamily: C.fontMono, color: C.textPrimary }}>maveric_gss</span>
        <span style={{
          marginLeft: 'auto', fontSize: 9.5,
          color: C.success, fontFamily: C.fontMono,
          padding: '1px 5px', backgroundColor: C.successFill,
          border: `1px solid ${C.success}33`, borderRadius: 2,
        }}>● live</span>
      </div>

      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${C.borderSubtle}` }}>
        <input
          value={sidebarFilter}
          onChange={(e) => setSidebarFilter(e.target.value)}
          placeholder="filter tables…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: C.bgApp,
            border: `1px solid ${C.borderSubtle}`,
            color: C.textPrimary,
            fontFamily: C.fontMono,
            fontSize: 11,
            padding: '4px 8px',
            outline: 'none',
            borderRadius: 3,
          }}
        />
      </div>

      <div style={{ overflow: 'auto', flex: 1, padding: '4px 0' }}>
        {schemas.map((s) => {
          const tables = s.tables.filter((t) => !filt || t.label.toLowerCase().includes(filt));
          if (tables.length === 0 && filt) return null;
          const isCol = collapsed[s.name];
          return (
            <div key={s.name} style={{ marginBottom: 4 }}>
              <div
                onClick={() => setCollapsed({ ...collapsed, [s.name]: !isCol })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px',
                  fontSize: 10, fontFamily: C.fontMono,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: C.textMuted, cursor: 'pointer', userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 8, color: C.textDisabled }}>{isCol ? '▸' : '▾'}</span>
                {s.name}
                <span style={{ marginLeft: 'auto', color: C.textDisabled, fontSize: 9.5 }}>{s.tables.length}</span>
              </div>
              {!isCol && tables.map((t) => {
                const sel = activeId === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => onPick(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px 4px 22px',
                      fontSize: 11.5, fontFamily: C.fontMono,
                      color: sel ? C.active : C.textPrimary,
                      backgroundColor: sel ? C.bgPanelRaised : 'transparent',
                      borderLeft: `2px solid ${sel ? C.active : 'transparent'}`,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.025)'; }}
                    onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                  >
                    <span style={{ color: sel ? C.active : C.textDisabled, fontSize: 10 }}>▦</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.label}</span>
                    <span style={{ fontSize: 9.5, color: C.textDisabled, fontFamily: C.fontMono }}>
                      {t.rows > 9999 ? `${(t.rows / 1000).toFixed(0)}k` : t.rows}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{
        padding: '6px 10px',
        borderTop: `1px solid ${C.borderSubtle}`,
        fontSize: 10, fontFamily: C.fontMono,
        color: C.textDisabled, lineHeight: 1.4,
      }}>
        <div>sqlite://ground_station.db</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <span>v6.1.0</span>
          <span style={{ color: C.textMuted }}>·</span>
          <span>readonly</span>
          <span style={{ marginLeft: 'auto', color: C.success }}>●</span>
        </div>
      </div>
    </div>
  );
}
