/**
 * The app's notion of "now". Normally the real time; demo mode shifts it so
 * the mock trains can be shown at any simulated time of day.
 */
let offsetMs = 0;

export function appNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function setClockOffset(ms: number): void {
  offsetMs = ms;
}
