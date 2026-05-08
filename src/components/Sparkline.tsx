import { useMemo } from 'react';
import { C } from '../lib/colors';

interface SparklineProps {
  seed?: number;
  color?: string;
  points?: number;
  height?: number;
}

export function Sparkline({ seed = 0, color = C.active, points = 60, height = 36 }: SparklineProps) {
  const data = useMemo(() => {
    const r = (n: number) => {
      const x = Math.sin(seed * 9.3 + n * 1.7) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: points }, (_, i) =>
      0.4 + 0.4 * Math.sin(i / 4 + seed) + (r(i) - 0.5) * 0.25,
    );
  }, [seed, points]);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const norm = data.map((v) => (v - min) / (max - min || 1));

  const w = 320;
  const path = norm
    .map((v, i) => {
      const x = (i / (norm.length - 1)) * w;
      const y = height - v * height;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`spark-${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${height} L 0 ${height} Z`} fill={`url(#spark-${seed})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" />
      <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} stroke={C.borderSubtle} strokeWidth="1" />
    </svg>
  );
}
