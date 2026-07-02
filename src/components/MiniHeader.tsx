import { useState, useEffect } from 'react';
import { C } from '../lib/colors';
import { useTz, fmtNowDate, fmtNowTime, type Tz } from '../lib/timezone';

export function MiniHeader() {
  const [now, setNow] = useState(() => new Date());
  const { tz, setTz } = useTz();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const utcDate = now.toISOString().slice(0, 10);
  const utcTime = now.toISOString().slice(11, 19);
  const pstDate = fmtNowDate(now, 'PST');
  const pstTime = fmtNowTime(now, 'PST');

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
      </div>

      {/* Right cluster */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontFamily: C.fontMono, fontSize: 11 }}>
        {/* PST clock — always visible */}
        <span style={{ color: C.textMuted }}>
          {pstDate} {pstTime} <span style={{ color: C.textDisabled }}>PST</span>
        </span>

        <span style={{ color: C.borderStrong }}>|</span>

        {/* UTC clock — always visible */}
        <span style={{ color: C.textPrimary }}>
          {utcDate} {utcTime} <span style={{ color: C.textDisabled }}>UTC</span>
        </span>

        {/* Toggle */}
        <TzToggle tz={tz} setTz={setTz} />
      </div>
    </div>
  );
}

function TzToggle({ tz, setTz }: { tz: Tz; setTz: (t: Tz) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      border: `1px solid ${C.borderSubtle}`,
      borderRadius: 4, overflow: 'hidden',
      fontSize: 10.5, fontFamily: C.fontMono,
    }}>
      {(['UTC', 'PST'] as Tz[]).map((t) => (
        <button
          key={t}
          onClick={() => setTz(t)}
          style={{
            padding: '2px 8px',
            backgroundColor: tz === t ? C.active : 'transparent',
            color: tz === t ? C.bgApp : C.textMuted,
            border: 'none',
            cursor: 'pointer',
            fontFamily: C.fontMono,
            fontSize: 10.5,
            fontWeight: tz === t ? 700 : 400,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
