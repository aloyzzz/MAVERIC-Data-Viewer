export const C = {
  bgApp:         '#080808',
  bgPanel:       '#0E0E0E',
  bgPanelRaised: '#151515',
  borderSubtle:  '#222222',
  borderStrong:  '#333333',
  textPrimary:   '#E5E5E5',
  textSecondary: '#A0A0A0',
  textMuted:     '#8A8A8A',
  textDisabled:  '#777777',

  danger:  '#FF3838', dangerFill:  '#1A0E0E',
  warning: '#E8B83A', warningFill: '#1A1508',
  info:    '#5AA8F0', infoFill:    '#0E1418',
  success: '#3CC98E', successFill: '#0C1612',
  active:  '#30C8E0', activeFill:  '#0C1315',
  neutral: '#888888', neutralFill: '#141414',

  frameAx25:  '#6690B8',
  frameGolay: '#50A898',

  fontSans: "'Inter', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', monospace",
} as const;

export type Tone = 'danger' | 'warning' | 'info' | 'success' | 'active' | 'neutral';

const TONE_MAP: Record<string, Tone> = {
  ACK: 'info', RES: 'success', CMD: 'neutral', REQ: 'neutral', TLM: 'active',
  FILE: 'neutral', ERR: 'danger', FAIL: 'danger', TIMEOUT: 'danger',
  NACK: 'danger', GUARD: 'warning', NONE: 'neutral',
  DANGER: 'danger', WARNING: 'warning', INFO: 'info', SUCCESS: 'success',
  ACTIVE: 'active', NEUTRAL: 'neutral',
  LIVE: 'success', CLOSED: 'neutral', ROTATED: 'warning',
  CHARGE: 'success', DISCHARGE: 'warning', IDLE: 'neutral',
  CRITICAL: 'danger', CLEARED: 'success',
  START: 'success', STOP: 'neutral', RUNNING: 'success', STOPPED: 'neutral',
  TX: 'info', RX: 'success',
};

export function toneOf(label: string): Tone {
  return TONE_MAP[String(label).toUpperCase()] ?? 'neutral';
}

const TONE_COLORS: Record<Tone, string> = {
  danger: C.danger, warning: C.warning, info: C.info,
  success: C.success, active: C.active, neutral: C.neutral,
};

const TONE_FILLS: Record<Tone, string> = {
  danger: C.dangerFill, warning: C.warningFill, info: C.infoFill,
  success: C.successFill, active: C.activeFill, neutral: C.neutralFill,
};

export function toneColor(t: Tone): string {
  return TONE_COLORS[t];
}

export function toneFill(t: Tone): string {
  return TONE_FILLS[t];
}

export function frameColor(f: string | null | undefined): string {
  if (!f) return C.danger;
  const u = f.toUpperCase();
  if (u.includes('AX')) return C.frameAx25;
  if (u.includes('GOLAY')) return C.frameGolay;
  return C.danger;
}
