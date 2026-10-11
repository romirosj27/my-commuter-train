import { describe, expect, it } from 'vitest';
import { emptyCommuteForm, formFromCommute, toCommuteInput } from '../src/features/commutes/form-model';

const ncl = { crs: 'NCL', name: 'Newcastle' };
const yrk = { crs: 'YRK', name: 'York' };

describe('commute form model', () => {
  it('requires stations chosen from the list', () => {
    const r = toCommuteInput(emptyCommuteForm);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toMatchObject({ home: 'Choose a station from the list', work: 'Choose a station from the list' });
  });

  it('flags identical stations, no days and a bad threshold', () => {
    const r = toCommuteInput({ ...emptyCommuteForm, home: ncl, work: ncl, activeDays: [], delayThresholdMin: Number.NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.work).toMatch(/differ/);
      expect(r.errors.activeDays).toBe('Choose at least one day');
      expect(r.errors.delayThresholdMin).toMatch(/between 1 and 240/);
    }
  });

  it('builds the API payload, with quiet hours only when enabled', () => {
    const r = toCommuteInput({ ...emptyCommuteForm, home: ncl, work: yrk });
    expect(r.ok && r.input).toMatchObject({ homeCrs: 'NCL', workCrs: 'YRK', alertSettings: { quietHours: null } });
    const q = toCommuteInput({ ...emptyCommuteForm, home: ncl, work: yrk, quietHoursEnabled: true });
    expect(q.ok && q.input.alertSettings?.quietHours).toEqual({ start: '22:00', end: '06:30' });
  });

  it('round-trips an existing commute', () => {
    const dto = {
      id: 'x', name: 'Office', homeCrs: 'NCL', homeName: 'Newcastle', workCrs: 'YRK', workName: 'York',
      outbound: { start: '07:00', end: '09:00' }, return: { start: '17:00', end: '19:00' },
      activeDays: [1, 3], operatorCodes: ['TP'], isDefault: true, createdAt: '',
      alertSettings: { enabled: false, types: ['delay' as const], delayThresholdMin: 9, quietHours: { start: '21:00', end: '07:00' } },
    };
    const r = toCommuteInput(formFromCommute(dto));
    expect(r.ok && r.input).toMatchObject({
      activeDays: [1, 3], operatorCodes: ['TP'], isDefault: true,
      alertSettings: { enabled: false, types: ['delay'], delayThresholdMin: 9, quietHours: { start: '21:00', end: '07:00' } },
    });
  });
});
