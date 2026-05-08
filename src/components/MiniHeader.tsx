import { useState } from 'react';
import { C } from '../lib/colors';

interface MiniHeaderProps {
  layout: 'A' | 'B';
  onLayoutChange: (l: 'A' | 'B') => void;
}

export function MiniHeader({ layout, onLayoutChange }: MiniHeaderProps) {
  const [now] = useState(() => new Date());
  const utcTime = now.toISOString().slice(11, 19);

  return (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center',
      height: 34, padding: '0 14px', flexShrink: 0,
      backgroundColor: C.bgApp,
      borderBottom: `1px solid ${C.success}33`,
    }}>
      {/* Noise texture */}
      <svg style={{ width: 0, height: 0, position: 'absolute' }} aria-hidden>
        <filter id="db-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
        </filter>
      </svg>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', filter: 'url(#db-noise)', opacity: 0.015, mixBlendMode: 'overlay' }} />

      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 14, position: 'relative' }}>
        <div style={{
          width: 18, height: 18, borderRadius: 3,
          background: `linear-gradient(135deg, ${C.active} 0%, ${C.info} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: C.fontMono, fontSize: 10, fontWeight: 700, color: C.bgApp,
        }}>▦</div>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.02em', color: C.textPrimary }}>
          MAVERIC <span style={{ color: C.active }}>DB</span>
        </span>
        <span style={{ fontSize: 11, color: C.textDisabled }}>v6.1.0</span>
      </div>

      <span style={{ color: C.borderStrong, fontSize: 11 }}>|</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, fontFamily: C.fontMono, fontSize: 11 }}>
        <span style={{ color: C.textMuted }}>2026-05-07-000</span>
        <span style={{ color: C.textDisabled }}>·</span>
        <span style={{ textTransform: 'uppercase', color: C.textMuted, fontSize: 10, letterSpacing: '0.04em' }}>OP</span>
        <span style={{ color: C.textSecondary }}>lcurry@SCFA-LAX</span>
      </div>

      {/* Right cluster */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontFamily: C.fontMono, fontSize: 11 }}>
        <span style={{ color: C.success, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.success, boxShadow: `0 0 6px ${C.success}` }} />
          5.4/s
        </span>
        <span style={{ color: C.borderStrong }}>|</span>
        <span style={{ color: C.textPrimary }}>
          2026-05-07 {utcTime} <span style={{ color: C.textDisabled }}>UTC</span>
        </span>
        <span style={{ color: C.borderStrong }}>|</span>
        {/* Layout toggle */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(['A', 'B'] as const).map((l) => (
            <button
              key={l}
              onClick={() => onLayoutChange(l)}
              style={{
                background: layout === l ? C.bgPanelRaised : 'transparent',
                border: `1px solid ${layout === l ? C.borderStrong : C.borderSubtle}`,
                color: layout === l ? C.active : C.textDisabled,
                padding: '1px 7px',
                borderRadius: 3,
                fontSize: 10,
                fontFamily: C.fontMono,
                cursor: 'pointer',
              }}
            >{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
