import { C } from '../lib/colors';
import {
  useSettings,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_STEP,
  type Settings,
} from '../lib/settings';

const mono = { fontFamily: C.fontMono } as const;

interface ToggleDef {
  key: keyof Settings;
  label: string;
  desc: string;
}

const TOGGLES: ToggleDef[] = [
  { key: 'highContrast', label: 'High contrast', desc: 'Boost contrast and brightness across the interface.' },
  { key: 'boldText', label: 'Bold text', desc: 'Use a heavier weight for body text to improve legibility.' },
  { key: 'underlineLinks', label: 'Underline links', desc: 'Always underline links so they stand out from regular text.' },
  { key: 'focusIndicators', label: 'Keyboard focus outline', desc: 'Show a clear outline on the focused control during keyboard navigation.' },
  { key: 'reduceMotion', label: 'Reduce motion', desc: 'Minimize animations and transitions for a calmer interface.' },
];

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 38, height: 22, flexShrink: 0,
        borderRadius: 11, padding: 2, cursor: 'pointer',
        border: `1px solid ${on ? C.active : C.borderStrong}`,
        backgroundColor: on ? C.activeFill : C.bgApp,
        display: 'flex', alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'all 0.12s ease',
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        backgroundColor: on ? C.active : C.textMuted,
      }} />
    </button>
  );
}

interface SettingsPageProps {
  onOpenManagement?: () => void;
}

export function SettingsPage({ onOpenManagement }: SettingsPageProps) {
  const { settings, setSetting, reset } = useSettings();
  const scalePct = Math.round(settings.uiScale * 100);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', backgroundColor: C.bgApp }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 24px 60px' }}>
        <div style={{ marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.textPrimary }}>
            Settings
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textMuted }}>
            Readability and accessibility preferences. Changes apply immediately and are saved on this device.
          </p>
        </div>

        {/* UI scale */}
        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>Text & UI size</div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>
                Scale the entire interface up or down for easier reading.
              </div>
            </div>
            <div style={{ ...mono, fontSize: 15, color: C.active, minWidth: 56, textAlign: 'right' }}>
              {scalePct}%
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <button
              style={stepBtnStyle}
              onClick={() => setSetting('uiScale', Math.max(UI_SCALE_MIN, +(settings.uiScale - UI_SCALE_STEP).toFixed(2)))}
              aria-label="Decrease size"
            >
              A-
            </button>
            <input
              type="range"
              min={UI_SCALE_MIN}
              max={UI_SCALE_MAX}
              step={UI_SCALE_STEP}
              value={settings.uiScale}
              onChange={(e) => setSetting('uiScale', +(+e.target.value).toFixed(2))}
              style={{ flex: 1, accentColor: C.active, cursor: 'pointer' }}
            />
            <button
              style={{ ...stepBtnStyle, fontSize: 16 }}
              onClick={() => setSetting('uiScale', Math.min(UI_SCALE_MAX, +(settings.uiScale + UI_SCALE_STEP).toFixed(2)))}
              aria-label="Increase size"
            >
              A+
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Small', v: 0.9 },
              { label: 'Default', v: 1 },
              { label: 'Large', v: 1.2 },
              { label: 'Extra large', v: 1.4 },
            ].map((p) => {
              const active = Math.abs(settings.uiScale - p.v) < 0.001;
              return (
                <button
                  key={p.label}
                  onClick={() => setSetting('uiScale', p.v)}
                  style={{
                    ...mono, fontSize: 11, padding: '4px 10px', borderRadius: 3, cursor: 'pointer',
                    border: `1px solid ${active ? C.active : C.borderStrong}`,
                    backgroundColor: active ? C.activeFill : C.bgApp,
                    color: active ? C.active : C.textMuted,
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Toggles */}
        <section style={{ ...sectionStyle, padding: 0 }}>
          {TOGGLES.map((t, i) => (
            <div
              key={t.key}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 16, padding: '14px 16px',
                borderTop: i === 0 ? 'none' : `1px solid ${C.borderSubtle}`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>{t.label}</div>
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>{t.desc}</div>
              </div>
              <Switch
                on={Boolean(settings[t.key])}
                onChange={(v) => setSetting(t.key, v as never)}
              />
            </div>
          ))}
        </section>

        {/* Admin */}
        {onOpenManagement && (
          <section style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>Management</div>
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>
                  Administrative tools. Requires a password to unlock.
                </div>
              </div>
              <button
                onClick={onOpenManagement}
                style={{
                  ...mono, fontSize: 11, padding: '7px 14px', borderRadius: 3, cursor: 'pointer',
                  border: `1px solid ${C.warning}55`, backgroundColor: C.warningFill, color: C.warning,
                  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                }}
              >
                Open Management
              </button>
            </div>
          </section>
        )}

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={reset}
            style={{
              ...mono, fontSize: 11, padding: '7px 14px', borderRadius: 3, cursor: 'pointer',
              border: `1px solid ${C.borderStrong}`, backgroundColor: C.bgApp, color: C.textMuted,
            }}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

const sectionStyle = {
  marginTop: 18,
  padding: 16,
  borderRadius: 6,
  border: `1px solid ${C.borderSubtle}`,
  backgroundColor: C.bgPanel,
} as const;

const stepBtnStyle = {
  ...mono,
  fontSize: 13,
  fontWeight: 700,
  width: 34, height: 30,
  borderRadius: 3,
  border: `1px solid ${C.borderStrong}`,
  backgroundColor: C.bgApp,
  color: C.textPrimary,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
} as const;
