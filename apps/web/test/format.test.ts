import { describe, expect, it } from 'vitest';
import { expectedText, hm, statusLine } from '../src/lib/format';
import { call, service, tv } from './fixtures';

describe('format', () => {
  it('shows London times across the clock change', () => {
    expect(hm('2026-07-14T06:05:00Z')).toBe('07:05');
    expect(hm('2026-11-10T07:05:00Z')).toBe('07:05');
    expect(hm(null)).toBe('—');
  });

  it('describes expected times like a departure board', () => {
    expect(expectedText(tv('2026-11-10T07:05:00Z'))).toEqual({ text: 'On time', tone: 'unknown' });
    expect(expectedText(tv('2026-11-10T07:05:00Z', '2026-11-10T07:05:00Z'))).toEqual({ text: 'On time', tone: 'ok' });
    expect(expectedText(tv('2026-11-10T07:05:00Z', '2026-11-10T07:17:00Z'))).toEqual({ text: 'Exp 07:17', tone: 'late' });
    expect(expectedText(tv('2026-11-10T07:05:00Z', '2026-11-10T07:17:00Z', true))).toEqual({ text: '07:17', tone: 'late' });
    expect(expectedText(tv('2026-11-10T07:05:00Z'), true)).toEqual({ text: 'Cancelled', tone: 'cancelled' });
  });

  it('summarises status for a row', () => {
    expect(statusLine(service())).toBe('On time');
    expect(statusLine(service({ status: 'delayed', delayMin: 12 }))).toBe('12 min late');
    expect(statusLine(service({ progress: 'arrived', delayMin: -1 }))).toBe('Arrived 1 min early');
    expect(statusLine(service({ status: 'part_cancelled', to: call({ name: 'York' }) }))).toBe('Terminates before York');
  });
});
