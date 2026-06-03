import { useState, useEffect } from 'react';
import { C } from '../lib/colors';

export function MiniHeader() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const utcDate = now.toISOString().slice(0, 10);
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
        <span style={{ textTransform: 'uppercase', color: C.textMuted, fontSize: 10, letterSpacing: '0.04em' }}>OP</span>
        <span style={{ color: C.textSecondary }}>lcurry@SCFA-LAX</span>
      </div>

      {/* Right cluster */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontFamily: C.fontMono, fontSize: 11 }}>
        <span style={{ color: C.textPrimary }}>
          {utcDate} {utcTime} <span style={{ color: C.textDisabled }}>UTC</span>
        </span>
      </div>
    </div>
  );
}
