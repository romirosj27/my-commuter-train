import { describe, expect, it } from 'vitest';
import {
  combine,
  DEFAULT_PREDICTION_CONFIG as CFG,
  formingServiceRule,
  publishedIncidentRule,
  turnaroundFor,
  upstreamDisruptionRule,
  type FormingInput,
  type TrainAhead,
} from '../src/prediction/index.ts';
import { fromLondon } from '../src/time/index.ts';

const DAY = '2026-11-10';
const L = (t: string, d = DAY) => fromLondon(d, t);

describe('forming service rule', () => {
  const base = (inbound: FormingInput['inbound'], o: Partial<FormingInput> = {}): FormingInput => ({
    inbound,
    location: { name: 'Newcastle', crs: 'NCL' },
    scheduledDeparture: L('08:10'),
    departed: false,
    toc: 'TP',
    ...o,
  });
  const inbound = (expected: string | null, o: Partial<NonNullable<FormingInput['inbound']>> = {}) => ({
    origin: 'York',
    isCancelled: false,
    scheduledArrival: L('07:52'),
    expectedArrival: expected ? L(expected) : null,
    ...o,
  });

  it('is low when the inbound train arrives in time to turn round', () => {
    expect(formingServiceRule(base(inbound('07:52'))).risk).toBe('low');
    expect(formingServiceRule(base(inbound('08:05'))).risk).toBe('low'); // exactly the 5 min turnaround
  });

  it('predicts the knock-on delay beyond the turnaround', () => {
    const p = formingServiceRule(base(inbound('08:09')));
    expect(p).toMatchObject({ risk: 'medium' });
    expect(p.reason).toBe('The train forming this service is due into Newcastle at 08:09, 17 min late. Allowing 5 min to turn round, it could leave about 4 min late.');
    const high = formingServiceRule(base(inbound('08:18')));
    expect(high.risk).toBe('high');
    expect(high.reason).toContain('about 13 min late');
  });

  it('is high when the inbound train is cancelled', () => {
    expect(formingServiceRule(base(inbound(null, { isCancelled: true }))).risk).toBe('high');
  });

  it('is low with no inbound, no report, or once departed', () => {
    expect(formingServiceRule(base(null)).risk).toBe('low');
    expect(formingServiceRule(base(inbound(null))).risk).toBe('low');
    expect(formingServiceRule(base(inbound('08:30'), { departed: true })).risk).toBe('low');
  });

  it('uses configurable turnaround times, most specific first', () => {
    const cfg = { ...CFG, turnaroundOverrides: { NCL: 8, 'NCL:TP': 12 } };
    expect(turnaroundFor(cfg, 'NCL', 'TP')).toBe(12);
    expect(turnaroundFor(cfg, 'NCL', 'GR')).toBe(8);
    expect(turnaroundFor(cfg, 'YRK', 'TP')).toBe(5);
    expect(formingServiceRule(base(inbound('08:00')), cfg).risk).toBe('medium'); // 08:00 + 12 > 08:10
    expect(formingServiceRule(base(inbound('08:09')), { ...CFG, forming: { highFromMin: 4 } }).risk).toBe('high');
  });

  it('works across midnight', () => {
    const p = formingServiceRule(
      base({ origin: 'York', isCancelled: false, scheduledArrival: L('23:50'), expectedArrival: L('00:05', '2026-11-11') }, { scheduledDeparture: L('00:05', '2026-11-11') }),
    );
    expect(p.reason).toContain('about 5 min late');
  });
});

describe('upstream disruption rule', () => {
  const ahead = (time: string, o: Partial<TrainAhead> = {}): TrainAhead => ({
    label: `${time} to York`,
    scheduledDeparture: L(time),
    isCancelled: false,
    delayMin: null,
    ...o,
  });
  const run = (a: TrainAhead[], network = [] as Parameters<typeof upstreamDisruptionRule>[0]['network'], now = L('08:30')) =>
    upstreamDisruptionRule({ scheduledDeparture: L('08:58'), now, ahead: a, network });

  it('is high for a cancellation ahead within the window', () => {
    expect(run([ahead('08:45', { isCancelled: true })])).toEqual({ rule: 'upstream', risk: 'high', reason: 'The 08:45 to York just ahead of yours is cancelled.' });
    expect(run([ahead('08:20', { isCancelled: true })]).risk).toBe('low'); // 38 min ahead > 30
  });

  it('is medium for a significant delay ahead within the window, naming the worst', () => {
    const p = run([ahead('08:45', { delayMin: 25 }), ahead('08:30', { delayMin: 12 })]);
    expect(p).toEqual({ rule: 'upstream', risk: 'medium', reason: 'The 08:45 to York ahead of yours is 25 min late.' });
    expect(run([ahead('08:45', { delayMin: 9 })]).risk).toBe('low');
    expect(run([ahead('07:50', { delayMin: 40 })]).risk).toBe('low'); // 68 min ahead > 60
  });

  it('ignores trains after ours', () => {
    expect(run([ahead('09:10', { isCancelled: true })]).risk).toBe('low');
  });

  it('uses recent network events on the route', () => {
    const delay = { kind: 'movement' as const, station: 'Darlington', observedAt: L('08:20'), delayMin: 35 };
    expect(run([], [delay])).toMatchObject({ risk: 'medium', reason: 'Trains near Darlington are running up to 35 min late.' });
    expect(run([], [delay], L('09:00')).risk).toBe('low'); // too old
    const cancel = { kind: 'cancellation' as const, station: 'Darlington', observedAt: L('08:25'), delayMin: null };
    expect(run([], [cancel])).toMatchObject({ risk: 'medium', reason: 'A train at Darlington was cancelled at 08:25.' });
  });
});

describe('published incident rule', () => {
  const incident = (crs: string[], o: Partial<{ operatorCodes: string[]; startsAt: Date; endsAt: Date | null }> = {}) => ({
    summary: `Problem at ${crs.join(',')}`,
    affectedCrs: crs,
    operatorCodes: [],
    startsAt: L('08:00'),
    endsAt: L('10:30'),
    ...o,
  });
  const run = (incidents: ReturnType<typeof incident>[], toc = 'TP') =>
    publishedIncidentRule({ routeCrs: ['NCL', 'DHM', 'DAR', 'YRK'], toc, from: L('08:30'), to: L('09:30'), incidents });

  it('is medium for an intermediate station and high at either end', () => {
    expect(run([incident(['DAR'])])).toEqual({ rule: 'incident', risk: 'medium', reason: 'Problem at DAR' });
    expect(run([incident(['YRK'])]).risk).toBe('high');
    expect(run([incident(['DAR']), incident(['NCL'])])).toMatchObject({ risk: 'high', reason: 'Problem at NCL' });
  });

  it('ignores incidents off the route, for other operators, or outside the journey', () => {
    expect(run([incident(['LDS'])]).risk).toBe('low');
    expect(run([incident(['DAR'], { operatorCodes: ['GR'] })]).risk).toBe('low');
    expect(run([incident(['DAR'], { operatorCodes: ['GR', 'TP'] })]).risk).toBe('medium');
    expect(run([incident(['DAR'], { endsAt: L('08:15') })]).risk).toBe('low');
    expect(run([incident(['DAR'], { startsAt: L('10:00'), endsAt: null })]).risk).toBe('low');
    expect(run([incident(['DAR'], { endsAt: null })]).risk).toBe('medium');
  });
});

describe('combine', () => {
  it('takes the highest risk and keeps every reason, most severe first', () => {
    const r = combine([
      { rule: 'forming', risk: 'low', reason: 'a' },
      { rule: 'upstream', risk: 'medium', reason: 'b' },
      { rule: 'incident', risk: 'high', reason: 'c' },
    ]);
    expect(r.risk).toBe('high');
    expect(r.reasons).toEqual(['c', 'b', 'a']);
    expect(combine([{ rule: 'forming', risk: 'low', reason: 'a' }]).risk).toBe('low');
    expect(combine([]).risk).toBe('low');
  });
});

describe('prediction config', async () => {
  const { predictionConfigFromJson } = await import('../src/prediction/index.ts');
  it('merges overrides onto the defaults and rejects bad input', () => {
    expect(predictionConfigFromJson(undefined)).toEqual(CFG);
    const c = predictionConfigFromJson('{"minTurnaroundMin":8,"turnaroundOverrides":{"NCL:TP":12},"upstream":{"delayWindowMin":45}}');
    expect(c).toMatchObject({ minTurnaroundMin: 8, turnaroundOverrides: { 'NCL:TP': 12 }, upstream: { delayWindowMin: 45, cancelWindowMin: 30 } });
    expect(() => predictionConfigFromJson('{"minTurnaround":8}')).toThrow();
    expect(() => predictionConfigFromJson('{"turnaroundOverrides":{"newcastle":3}}')).toThrow();
  });
});
