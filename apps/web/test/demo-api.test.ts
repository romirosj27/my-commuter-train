// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { setClockOffset } from '../src/lib/clock';
import { handleDemoRequest, resetDemoData } from '../src/demo/api';
import { fromLondon, toLondon } from '@mct/shared';

const call = async (method: string, path: string, body?: unknown) => {
  const res = await handleDemoRequest(method, new URL(path, 'http://demo.test'), body);
  return { status: res!.status, body: res!.status === 204 ? null : await res!.json() };
};

describe('demo API', () => {
  beforeEach(() => {
    resetDemoData();
    // 07:50 today, London
    setClockOffset(fromLondon(toLondon(new Date()).date, '07:50').getTime() - Date.now());
  });

  it('starts signed in with demo commutes, and signs out and in', async () => {
    expect((await call('GET', '/api/auth/get-session')).body.user.name).toBe('Demo Commuter');
    await call('POST', '/api/auth/sign-out');
    expect((await call('GET', '/api/auth/get-session')).body).toBeNull();
    expect((await call('GET', '/api/commutes')).status).toBe(401);
    await call('POST', '/api/auth/sign-in/email', { email: 'x@example.com', password: 'anything' });
    expect((await call('GET', '/api/commutes')).body.commutes).toHaveLength(2);
  });

  it('serves the board from the mock scenarios, with predictions', async () => {
    const { commutes } = (await call('GET', '/api/commutes')).body;
    const today = toLondon(new Date()).date;
    const board = (await call('GET', `/api/commutes/${commutes[0].id}/board?direction=outbound&date=${today}`)).body;
    const at = (hhmm: string) => board.services.find((s: { from: { departure: { scheduled: string } } }) => toLondon(new Date(s.from.departure.scheduled)).time.startsWith(hhmm));
    expect(at('08:02').status).toBe('cancelled');
    expect(at('07:40').from.platformChanged).toBe(true);
    expect(at('08:10').risk.risk).toBe('high');
    const detail = (await call('GET', `/api/services/${at('08:10').serviceId}?from=NCL&to=YRK`)).body;
    expect(detail.formedBy).toMatchObject({ origin: 'York', destination: 'Newcastle' });
  });

  it('validates like the real API', async () => {
    const res = await call('POST', '/api/commutes', { name: 'x', homeCrs: 'NCL', workCrs: 'NCL', outbound: { start: '07:00', end: '09:00' }, return: { start: '17:00', end: '19:00' }, activeDays: [1] });
    expect(res.status).toBe(400);
    expect((await call('GET', '/api/nope')).status).toBe(404);
  });

  it('logs journeys and assesses Delay Repay', async () => {
    const today = toLondon(new Date()).date;
    const j = (await call('POST', '/api/journeys', { travelDate: today, originCrs: 'NCL', destCrs: 'YRK', toc: 'GR', schedDep: '23:40', schedArr: '00:38', actualArr: '01:05' })).body;
    expect(j).toMatchObject({ arrivalDelayMin: 27, eligibility: { status: 'eligible', percent: 25 } });
  });
});
