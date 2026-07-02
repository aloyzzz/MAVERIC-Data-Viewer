import { createContext, useContext, useState, type ReactNode } from 'react';

export type Tz = 'UTC' | 'PST';

// PST is fixed UTC-8. We label it PST per user preference.
const PST_OFFSET_MS = 8 * 60 * 60 * 1000;

interface TzCtx { tz: Tz; setTz: (tz: Tz) => void; }
const TimezoneContext = createContext<TzCtx>({ tz: 'UTC', setTz: () => {} });

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const [tz, setTz] = useState<Tz>(() => (localStorage.getItem('maveric_tz') as Tz | null) ?? 'UTC');

  function handleSet(next: Tz) {
    setTz(next);
    localStorage.setItem('maveric_tz', next);
  }

  return <TimezoneContext.Provider value={{ tz, setTz: handleSet }}>{children}</TimezoneContext.Provider>;
}

export function useTz() { return useContext(TimezoneContext); }

// Full datetime string: "YYYY-MM-DD HH:MM:SS UTC/PST"
export function fmtMs(ms: number, tz: Tz): string {
  if (tz === 'UTC') return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  return new Date(ms - PST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19) + ' PST';
}

// Format an ISO string that ends in Z; leave non-ISO strings unchanged
export function fmtIso(iso: string, tz: Tz): string {
  if (!iso) return '';
  if (tz === 'UTC') return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC');
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return iso;
  return new Date(ms - PST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19) + ' PST';
}

// Time-only HH:MM:SS for chart axis labels
export function fmtMsTime(ms: number, tz: Tz): string {
  if (tz === 'UTC') return new Date(ms).toISOString().slice(11, 19);
  return new Date(ms - PST_OFFSET_MS).toISOString().slice(11, 19);
}

// For <input type="datetime-local"> — value must be YYYY-MM-DDTHH:MM
export function msToInput(ms: number, tz: Tz): string {
  if (tz === 'UTC') return new Date(ms).toISOString().slice(0, 16);
  return new Date(ms - PST_OFFSET_MS).toISOString().slice(0, 16);
}

export function inputToMs(s: string, tz: Tz): number {
  const utcMs = new Date((s.length === 16 ? s + ':00' : s) + 'Z').getTime();
  return tz === 'UTC' ? utcMs : utcMs + PST_OFFSET_MS;
}

// Current time formatted as "HH:MM:SS TZ"
export function fmtNowTime(now: Date, tz: Tz): string {
  if (tz === 'UTC') return now.toISOString().slice(11, 19);
  return new Date(now.getTime() - PST_OFFSET_MS).toISOString().slice(11, 19);
}

export function fmtNowDate(now: Date, tz: Tz): string {
  if (tz === 'UTC') return now.toISOString().slice(0, 10);
  return new Date(now.getTime() - PST_OFFSET_MS).toISOString().slice(0, 10);
}
