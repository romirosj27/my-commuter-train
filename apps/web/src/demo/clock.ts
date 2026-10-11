/**
 * The demo's simulated clock: today's date at a chosen time of day, then
 * running in real time. Persisted per browser so a refresh keeps the moment.
 */
import { fromLondon, toLondon } from '@mct/shared';
import { setClockOffset } from '@/lib/clock';

const KEY = 'mct-demo-clock';
/** The demo opens at 07:50, when the most is going on in the scenarios. */
export const DEFAULT_DEMO_TIME = '07:50';

export function setDemoTime(hhmm: string): void {
  const target = fromLondon(toLondon(new Date()).date, hhmm);
  const offset = target.getTime() - Date.now();
  setClockOffset(offset);
  try {
    localStorage.setItem(KEY, JSON.stringify({ hhmm, setAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** Restores the saved demo time (advanced by the real time since), or starts at the default. */
export function initDemoClock(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { hhmm: string; setAt: number } | null;
    // A saved time from an earlier day starts afresh.
    if (saved && new Date(saved.setAt).toDateString() === new Date().toDateString()) {
      const target = fromLondon(toLondon(new Date()).date, saved.hhmm).getTime() + (Date.now() - saved.setAt);
      setClockOffset(target - Date.now());
      return;
    }
  } catch {
    /* ignore */
  }
  setDemoTime(DEFAULT_DEMO_TIME);
}
