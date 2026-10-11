import { describe, expect, it } from 'vitest';
import { arrivalDelayMin, assessEligibility, bandFor, delayRepayBandsSchema, type DelayRepayBand } from '../src/delay-repay.ts';
import { fromLondon, resolveNear, resolveTimeline } from '../src/time/index.ts';

const BANDS: DelayRepayBand[] = [
  { minMinutes: 15, maxMinutes: 30, singlePct: 25, returnPct: 12.5 },
  { minMinutes: 30, maxMinutes: 60, singlePct: 50, returnPct: 25 },
  { minMinutes: 60, maxMinutes: null, singlePct: 100, returnPct: 50 },
];
const scheme = { name: 'Test', bands: BANDS, verifiedOn: null };

describe('arrival delay', () => {
  it('measures real elapsed minutes, across midnight', () => {
    const [, sched] = resolveTimeline('2026-11-10', ['23:40', '00:38']) as [Date, Date];
    const actual = resolveNear(sched, '00:57');
    expect(arrivalDelayMin(sched, actual)).toBe(19);
    expect(arrivalDelayMin(sched, resolveNear(sched, '23:59'))).toBe(-39);
  });

  it('measures correctly across the October clock change', () => {
    // Due 01:50 BST; arrived 01:10 GMT after the clocks went back: 20 min late, not 40 early.
    const sched = fromLondon('2026-10-25', '01:50', 'earlier');
    const actual = resolveNear(sched, '01:10');
    expect(actual.toISOString()).toBe('2026-10-25T01:10:00.000Z');
    expect(arrivalDelayMin(sched, actual)).toBe(20);
  });

  it('measures correctly across the March clock change', () => {
    // Due 00:50 GMT; arrived 02:20 BST: 30 min late in real time.
    const sched = fromLondon('2027-03-28', '00:50');
    expect(arrivalDelayMin(sched, resolveNear(sched, '02:20'))).toBe(30);
  });

  it('is null without an actual time', () => {
    expect(arrivalDelayMin(new Date(), null)).toBeNull();
  });
});

describe('bands', () => {
  it('uses inclusive lower and exclusive upper bounds', () => {
    expect(bandFor(BANDS, 14)).toBeNull();
    expect(bandFor(BANDS, 15)?.singlePct).toBe(25);
    expect(bandFor(BANDS, 29)?.singlePct).toBe(25);
    expect(bandFor(BANDS, 30)?.singlePct).toBe(50);
    expect(bandFor(BANDS, 600)?.singlePct).toBe(100);
  });

  it('validates band tables', () => {
    expect(delayRepayBandsSchema.safeParse(BANDS).success).toBe(true);
    expect(delayRepayBandsSchema.safeParse([{ minMinutes: 30, maxMinutes: 15, singlePct: 25, returnPct: 12 }]).success).toBe(false);
    expect(delayRepayBandsSchema.safeParse([BANDS[1], BANDS[0]]).success).toBe(false);
    expect(delayRepayBandsSchema.safeParse([{ ...BANDS[0], singlePct: 120 }]).success).toBe(false);
    expect(delayRepayBandsSchema.safeParse([]).success).toBe(false);
  });
});

describe('assessEligibility', () => {
  const sched = new Date('2026-11-10T08:00:00Z');
  const at = (min: number) => new Date(sched.getTime() + min * 60_000);

  it('works out the band and percentage for the ticket type', () => {
    expect(assessEligibility({ schedArr: sched, actualArr: at(22), destCancelled: false, ticketType: 'single', scheme })).toMatchObject({
      status: 'eligible', delayMin: 22, percent: 25, schemeVerified: false,
      message: '22 min late (15–29 min band): 25% of your single ticket.',
    });
    expect(assessEligibility({ schedArr: sched, actualArr: at(45), destCancelled: false, ticketType: 'return', scheme }).percent).toBe(25);
    const season = assessEligibility({ schedArr: sched, actualArr: at(75), destCancelled: false, ticketType: 'season', scheme });
    expect(season).toMatchObject({ status: 'eligible', percent: null });
    expect(season.message).toContain('60+ min band');
  });

  it('is not eligible below the first band or when early', () => {
    expect(assessEligibility({ schedArr: sched, actualArr: at(14), destCancelled: false, ticketType: 'single', scheme })).toMatchObject({
      status: 'not_eligible', message: 'You arrived 14 min late, below the first compensation band.',
    });
    expect(assessEligibility({ schedArr: sched, actualArr: at(-1), destCancelled: false, ticketType: 'single', scheme }).message).toBe('You arrived on time.');
  });

  it('asks for the arrival time when it is unknown, including after a cancellation', () => {
    expect(assessEligibility({ schedArr: sched, actualArr: null, destCancelled: true, ticketType: 'single', scheme })).toMatchObject({
      status: 'needs_arrival_time',
    });
  });

  it('reports a missing scheme and verified schemes', () => {
    expect(assessEligibility({ schedArr: sched, actualArr: at(20), destCancelled: false, ticketType: 'single', scheme: null }).status).toBe('no_scheme');
    expect(assessEligibility({ schedArr: sched, actualArr: at(20), destCancelled: false, ticketType: 'single', scheme: { ...scheme, verifiedOn: '2026-10-01' } }).schemeVerified).toBe(true);
  });
});
