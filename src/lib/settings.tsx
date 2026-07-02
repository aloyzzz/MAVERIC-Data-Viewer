import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Accessibility / readability settings, persisted to localStorage and applied
// globally via an injected <style> block. The app uses hardcoded px font sizes
// throughout, so scaling is done with CSS `zoom` on #root rather than by
// rewriting every component.

export interface Settings {
  /** UI scale factor applied via zoom on #root. 1 = 100%. */
  uiScale: number;
  /** Boost contrast/brightness of the whole UI. */
  highContrast: boolean;
  /** Make body text heavier for legibility. */
  boldText: boolean;
  /** Disable animations and transitions. */
  reduceMotion: boolean;
  /** Show a strong focus outline on keyboard navigation. */
  focusIndicators: boolean;
  /** Underline links and clickable accents. */
  underlineLinks: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  highContrast: false,
  boldText: false,
  reduceMotion: false,
  focusIndicators: true,
  underlineLinks: false,
};

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.6;
export const UI_SCALE_STEP = 0.1;

const STORAGE_KEY = 'maveric_settings';

interface SettingsCtx {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsCtx>({
  settings: DEFAULT_SETTINGS,
  setSetting: () => {},
  reset: () => {},
});

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function buildCss(s: Settings): string {
  const rules: string[] = [];

  // Scale + global filters live on #root so the whole app responds.
  const rootDecls: string[] = [`zoom: ${s.uiScale};`];
  if (s.highContrast) rootDecls.push('filter: contrast(1.18) brightness(1.12) saturate(1.05);');
  if (s.boldText) rootDecls.push('font-weight: 500;');
  rules.push(`#root { ${rootDecls.join(' ')} }`);

  if (s.boldText) {
    // Most text doesn't set an explicit weight inline, so this lands on body copy.
    rules.push('#root, #root * { font-weight: 500; }');
  }

  if (s.reduceMotion) {
    rules.push(
      '*, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }',
    );
  }

  if (s.focusIndicators) {
    rules.push(':focus-visible { outline: 2px solid #30C8E0 !important; outline-offset: 2px !important; border-radius: 2px; }');
  }

  if (s.underlineLinks) {
    rules.push('a, [role="link"] { text-decoration: underline !important; }');
  }

  return rules.join('\n');
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    const id = 'maveric-settings-style';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = buildCss(settings);
  }, [settings]);

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private mode errors */
      }
      return next;
    });
  }

  function reset() {
    setSettings(DEFAULT_SETTINGS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <SettingsContext.Provider value={{ settings, setSetting, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
