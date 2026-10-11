import { describe, expect, it } from 'vitest';
import { commuteInputSchema } from '../src/schemas/index.ts';

describe('commuteInputSchema', () => {
  const base = {
    name: 'Work',
    homeCrs: 'ncl',
    workCrs: 'YRK',
    outbound: { start: '07:00', end: '09:00' },
    return: { start: '17:00', end: '19:00' },
    activeDays: [1, 2, 3, 4, 5],
  };

  it('normalises CRS and fills defaults', () => {
    const c = commuteInputSchema.parse(base);
    expect(c.homeCrs).toBe('NCL');
    expect(c.operatorCodes).toEqual([]);
    expect(c.isDefault).toBe(false);
  });

  it('rejects identical stations and bad times', () => {
    expect(commuteInputSchema.safeParse({ ...base, workCrs: 'NCL' }).success).toBe(false);
    expect(commuteInputSchema.safeParse({ ...base, outbound: { start: '7:00', end: '09:00' } }).success).toBe(false);
    expect(commuteInputSchema.safeParse({ ...base, activeDays: [] }).success).toBe(false);
  });
});
