/**
 * The demo API: answers the web app's /api requests in the browser.
 * Account and commute data live in this browser's localStorage; trains come
 * from the mock scenarios (see railway.ts). Validation reuses the shared zod
 * schemas, so the demo accepts and rejects the same input as the real API.
 */
import {
  alertSettingsSchema,
  arrivalDelayMin,
  assessEligibility,
  CHECK_TERMS_NOTE,
  commuteInputSchema,
  commutePatchSchema,
  DEFAULT_ALERT_SETTINGS,
  delayRepayBandsSchema,
  demoOperators,
  demoStations,
  formatLondonHm,
  PLACEHOLDER_BANDS,
  resolveNear,
  resolveTimeline,
  toLondon,
  type AlertSettingsInput,
  type CommuteDto,
  type DelayRepayBand,
} from '@mct/shared';
import type { z } from 'zod';
import { appNow } from '@/lib/clock';
import { board, leg, operatorName, railwayAt, serviceDetail, stationName } from './railway';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface StoredCommute extends Omit<CommuteDto, 'homeName' | 'workName'> {}
interface StoredJourney {
  id: string;
  travelDate: string;
  originCrs: string;
  destCrs: string;
  toc: string;
  schedDep: string;
  schedArr: string;
  actualArr: string | null;
  destCancelled: boolean;
  ticketType: 'single' | 'return' | 'season';
  claimStatus: 'none' | 'claimed' | 'paid' | 'rejected';
  source: 'live' | 'hsp' | 'manual';
  serviceId: string | null;
}
interface Scheme {
  toc: string;
  name: string;
  bands: DelayRepayBand[];
  claimUrl: string | null;
  notes: string | null;
  verifiedOn: string | null;
  updatedAt: string;
}
interface DemoData {
  signedIn: boolean;
  user: { id: string; name: string; email: string; createdAt: string };
  commutes: StoredCommute[];
  journeys: StoredJourney[];
  schemes: Scheme[];
}

const KEY = 'mct-demo-v1';

function initial(): DemoData {
  const now = new Date().toISOString();
  const everyDay = [1, 2, 3, 4, 5, 6, 7];
  return {
    signedIn: true,
    user: { id: 'demo-user', name: 'Demo Commuter', email: 'demo@example.com', createdAt: now },
    commutes: [
      {
        id: crypto.randomUUID(),
        name: 'Office',
        homeCrs: 'NCL',
        workCrs: 'YRK',
        outbound: { start: '07:00', end: '09:30' },
        return: { start: '17:00', end: '19:00' },
        activeDays: everyDay,
        operatorCodes: [],
        isDefault: true,
        alertSettings: DEFAULT_ALERT_SETTINGS,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        name: 'Darlington site',
        homeCrs: 'YRK',
        workCrs: 'DAR',
        outbound: { start: '07:00', end: '09:30' },
        return: { start: '16:30', end: '18:30' },
        activeDays: [1, 2, 3, 4, 5],
        operatorCodes: ['TP', 'GR'],
        isDefault: false,
        alertSettings: { ...DEFAULT_ALERT_SETTINGS, delayThresholdMin: 10 },
        createdAt: now,
      },
    ],
    journeys: [],
    schemes: demoOperators.map((o) => ({
      toc: o.code,
      name: `${o.name} Delay Repay (placeholder)`,
      bands: PLACEHOLDER_BANDS,
      claimUrl: null,
      notes: "Placeholder bands. Check the operator's current Delay Repay terms before relying on this.",
      verifiedOn: null,
      updatedAt: now,
    })),
  };
}

let data: DemoData = load();

function load(): DemoData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DemoData;
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return initial();
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode etc.: keep in memory only */
  }
}

/** Puts the demo back to its starting state. */
export function resetDemoData(): void {
  data = initial();
  save();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new HttpError(400, 'Invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function requireUser() {
  if (!data.signedIn) throw new HttpError(401, 'Sign in required');
  return data.user;
}

const commuteDto = (c: StoredCommute): CommuteDto => ({ ...c, homeName: stationName(c.homeCrs), workName: stationName(c.workCrs) });

function findCommute(id: string): StoredCommute {
  const c = data.commutes.find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Commute not found');
  return c;
}

function assertStation(crs: string) {
  if (!demoStations.some((s) => s.crs === crs)) throw new HttpError(400, 'Invalid request', [{ path: 'station', message: `Unknown station ${crs}` }]);
}

function journeyDto(j: StoredJourney) {
  const scheme = data.schemes.find((s) => s.toc === j.toc) ?? null;
  return {
    ...j,
    originName: stationName(j.originCrs),
    destName: stationName(j.destCrs),
    operator: operatorName(j.toc),
    arrivalDelayMin: j.actualArr ? arrivalDelayMin(new Date(j.schedArr), new Date(j.actualArr)) : null,
    eligibility: assessEligibility({
      schedArr: new Date(j.schedArr),
      actualArr: j.actualArr ? new Date(j.actualArr) : null,
      destCancelled: j.destCancelled,
      ticketType: j.ticketType,
      scheme,
    }),
    claimUrl: scheme?.claimUrl ?? null,
  };
}

function commuteBoard(c: StoredCommute, direction: 'outbound' | 'return', date: string) {
  const out = direction === 'outbound';
  const window = out ? c.outbound : c.return;
  return board(railwayAt(appNow()), {
    fromCrs: out ? c.homeCrs : c.workCrs,
    toCrs: out ? c.workCrs : c.homeCrs,
    date,
    start: window.start,
    end: window.end,
    operators: c.operatorCodes,
  });
}

const sessionPayload = () => {
  const u = data.user;
  const now = new Date();
  return {
    session: {
      id: 'demo-session',
      token: 'demo',
      userId: u.id,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    user: { ...u, emailVerified: true, image: null, timezone: 'Europe/London', updatedAt: now.toISOString() },
  };
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type Handler = (ctx: { params: Record<string, string>; query: URLSearchParams; body: unknown }) => unknown;
const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, pattern, keys, handler });
}

// --- Auth (Better Auth endpoints the web app calls) ---
route('GET', '/api/auth/get-session', () => (data.signedIn ? sessionPayload() : null));
route('POST', '/api/auth/sign-in/email', ({ body }) => {
  const b = body as { email?: string };
  data.signedIn = true;
  if (b.email) data.user.email = b.email;
  save();
  return { redirect: false, token: 'demo', user: sessionPayload().user };
});
route('POST', '/api/auth/sign-up/email', ({ body }) => {
  const b = body as { email?: string; name?: string };
  data = { ...initial(), user: { ...initial().user, email: b.email ?? 'demo@example.com', name: b.name || 'Demo Commuter' } };
  save();
  return { token: 'demo', user: sessionPayload().user };
});
route('POST', '/api/auth/sign-out', () => {
  data.signedIn = false;
  save();
  return { success: true };
});
route('POST', '/api/auth/send-verification-email', () => ({ status: true }));
route('POST', '/api/auth/request-password-reset', () => ({ status: true }));
route('POST', '/api/auth/reset-password', () => ({ status: true }));
route('POST', '/api/auth/delete-user', () => {
  resetDemoData();
  data.signedIn = false;
  save();
  return { success: true, message: 'User deleted' };
});

// --- Me ---
route('GET', '/api/me', () => {
  const u = requireUser();
  return { id: u.id, email: u.email, name: u.name, isAdmin: true };
});
route('GET', '/api/me/export', () => {
  requireUser();
  return { exportedAt: appNow().toISOString(), profile: data.user, commutes: data.commutes, journeys: data.journeys, alertsSent: [] };
});

// --- Reference ---
route('GET', '/api/stations', ({ query }) => {
  const q = (query.get('q') ?? '').trim().toLowerCase();
  if (!q) throw new HttpError(400, 'Invalid request', [{ path: 'q', message: 'Too short' }]);
  const hits = demoStations
    .map((s) => ({ s, score: s.crs.toLowerCase() === q ? 3 : s.name.toLowerCase().startsWith(q) ? 2 : s.name.toLowerCase().includes(q) ? 1 : 0 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
  return { stations: hits.slice(0, 10).map(({ s }) => ({ crs: s.crs, name: s.name })) };
});
route('GET', '/api/operators', () => ({ operators: demoOperators.map((o) => ({ code: o.code, name: o.name })) }));

// --- Commutes ---
route('GET', '/api/commutes', () => (requireUser(), { commutes: data.commutes.map(commuteDto) }));
route('POST', '/api/commutes', ({ body }) => {
  requireUser();
  const input = parse(commuteInputSchema, body);
  assertStation(input.homeCrs);
  assertStation(input.workCrs);
  if (data.commutes.length >= 10) throw new HttpError(409, 'You can save up to 10 commutes');
  const isDefault = input.isDefault || data.commutes.length === 0;
  if (isDefault) data.commutes.forEach((c) => (c.isDefault = false));
  const { alertSettings, ...rest } = input;
  const c: StoredCommute = { ...rest, id: crypto.randomUUID(), isDefault, alertSettings: alertSettings ?? DEFAULT_ALERT_SETTINGS, createdAt: new Date().toISOString() };
  data.commutes.push(c);
  save();
  return [201, commuteDto(c)];
});
route('GET', '/api/commutes/:id', ({ params }) => (requireUser(), commuteDto(findCommute(params.id!))));
route('PATCH', '/api/commutes/:id', ({ params, body }) => {
  requireUser();
  const c = findCommute(params.id!);
  const patch = parse(commutePatchSchema, body);
  const n = { ...c, ...patch };
  const merged = parse(commuteInputSchema, {
    name: n.name,
    homeCrs: n.homeCrs,
    workCrs: n.workCrs,
    outbound: n.outbound,
    return: n.return,
    activeDays: n.activeDays,
    operatorCodes: n.operatorCodes,
    isDefault: n.isDefault,
  });
  assertStation(merged.homeCrs);
  assertStation(merged.workCrs);
  if (merged.isDefault && !c.isDefault) data.commutes.forEach((x) => (x.isDefault = false));
  Object.assign(c, { ...merged, alertSettings: c.alertSettings, isDefault: merged.isDefault || c.isDefault });
  save();
  return commuteDto(c);
});
route('DELETE', '/api/commutes/:id', ({ params }) => {
  requireUser();
  const c = findCommute(params.id!);
  data.commutes = data.commutes.filter((x) => x !== c);
  if (c.isDefault && data.commutes[0]) data.commutes[0].isDefault = true;
  save();
  return [204, undefined];
});
route('POST', '/api/commutes/:id/default', ({ params }) => {
  requireUser();
  const c = findCommute(params.id!);
  data.commutes.forEach((x) => (x.isDefault = x === c));
  save();
  return commuteDto(c);
});
route('PUT', '/api/commutes/:id/alert-settings', ({ params, body }) => {
  requireUser();
  const c = findCommute(params.id!);
  c.alertSettings = parse(alertSettingsSchema, body) as AlertSettingsInput;
  save();
  return c.alertSettings;
});
route('GET', '/api/commutes/:id/board', ({ params, query }) => {
  requireUser();
  const c = findCommute(params.id!);
  const direction = query.get('direction') === 'return' ? 'return' : 'outbound';
  const date = query.get('date') ?? toLondon(appNow()).date;
  const weekday = toLondon(new Date(`${date}T12:00:00Z`)).weekday;
  return {
    commuteId: c.id,
    direction,
    date,
    window: direction === 'outbound' ? c.outbound : c.return,
    activeDay: c.activeDays.includes(weekday),
    generatedAt: appNow().toISOString(),
    services: commuteBoard(c, direction, date),
  };
});
route('GET', '/api/services/:id', ({ params, query }) => {
  requireUser();
  const d = serviceDetail(railwayAt(appNow()), decodeURIComponent(params.id!), query.get('from'), query.get('to'));
  if (!d) throw new HttpError(404, 'Service not found');
  return d;
});

// --- Journeys / Delay Repay ---
route('GET', '/api/journeys', () => {
  requireUser();
  const list = [...data.journeys].sort((a, b) => b.travelDate.localeCompare(a.travelDate) || b.schedDep.localeCompare(a.schedDep));
  return { journeys: list.map(journeyDto), note: CHECK_TERMS_NOTE };
});
route('GET', '/api/journeys/suggestions', ({ query }) => {
  requireUser();
  const date = query.get('date') ?? toLondon(appNow()).date;
  const c = data.commutes.find((x) => x.isDefault);
  if (!c) return { date, suggestions: [] };
  const suggestions = [];
  for (const direction of ['outbound', 'return'] as const) {
    const [from, to] = direction === 'outbound' ? [c.homeCrs, c.workCrs] : [c.workCrs, c.homeCrs];
    if (data.journeys.some((j) => j.travelDate === date && j.originCrs === from && j.destCrs === to)) continue;
    const rows = commuteBoard(c, direction, date);
    if (!rows.length) continue;
    const counts = new Map<string, number>();
    for (const j of data.journeys.filter((x) => x.originCrs === from && x.destCrs === to)) {
      const k = `${formatLondonHm(new Date(j.schedDep))}|${j.toc}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const usual = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const match = usual ? rows.find((s) => `${formatLondonHm(new Date(s.from.departure.scheduled!))}|${s.toc}` === usual) : undefined;
    const pick = match ?? (usual ? undefined : rows[0]);
    if (!pick) continue;
    suggestions.push({
      direction,
      commuteId: c.id,
      serviceId: pick.serviceId,
      basis: match ? 'usual' : 'first',
      travelDate: date,
      originCrs: from,
      originName: pick.from.name,
      destCrs: to,
      destName: pick.to.name,
      toc: pick.toc,
      operator: pick.operator,
      schedDep: pick.from.departure.scheduled,
      schedArr: pick.to.arrival.scheduled,
      actualArr: pick.to.isCancelled ? null : pick.to.arrival.isActual ? pick.to.arrival.expected : null,
      destCancelled: pick.to.isCancelled,
    });
  }
  return { date, suggestions };
});
route('POST', '/api/journeys', ({ body }) => {
  requireUser();
  const b = (body ?? {}) as Record<string, string | null | undefined>;
  const ticketType = (b.ticketType as StoredJourney['ticketType']) ?? 'single';
  let j: StoredJourney;
  if (b.serviceId) {
    const l = leg(railwayAt(appNow()), b.serviceId, b.originCrs ?? '', b.destCrs ?? '');
    if (!l) throw new HttpError(400, 'That train does not run between those stations');
    if (data.journeys.some((x) => x.serviceId === b.serviceId)) throw new HttpError(409, "You've already logged this journey");
    const destCancelled = l.s.isCancelled || l.to.isCancelled;
    j = {
      id: crypto.randomUUID(),
      travelDate: toLondon(new Date(l.from.departure.scheduled!)).date,
      originCrs: b.originCrs!,
      destCrs: b.destCrs!,
      toc: l.s.service.toc,
      schedDep: l.from.departure.scheduled!,
      schedArr: l.to.arrival.scheduled!,
      actualArr: destCancelled ? null : l.to.arrival.isActual ? l.to.arrival.expected : null,
      destCancelled,
      ticketType,
      claimStatus: 'none',
      source: 'live',
      serviceId: b.serviceId,
    };
  } else {
    const errors: Array<{ path: string; message: string }> = [];
    for (const k of ['travelDate', 'originCrs', 'destCrs', 'toc', 'schedDep', 'schedArr'] as const) if (!b[k]) errors.push({ path: k, message: 'Required' });
    if (errors.length) throw new HttpError(400, 'Invalid request', errors);
    if (b.originCrs === b.destCrs) throw new HttpError(400, 'Invalid request', [{ path: 'destCrs', message: 'Origin and destination must differ' }]);
    assertStation(b.originCrs!);
    assertStation(b.destCrs!);
    const [dep, arr] = resolveTimeline(b.travelDate!, [b.schedDep!, b.schedArr!]) as [Date, Date];
    j = {
      id: crypto.randomUUID(),
      travelDate: b.travelDate!,
      originCrs: b.originCrs!,
      destCrs: b.destCrs!,
      toc: b.toc!,
      schedDep: dep.toISOString(),
      schedArr: arr.toISOString(),
      actualArr: b.actualArr ? resolveNear(arr, b.actualArr).toISOString() : null,
      destCancelled: false,
      ticketType,
      claimStatus: 'none',
      source: 'manual',
      serviceId: null,
    };
  }
  data.journeys.push(j);
  save();
  return [201, journeyDto(j)];
});
route('PATCH', '/api/journeys/:id', ({ params, body }) => {
  requireUser();
  const j = data.journeys.find((x) => x.id === params.id);
  if (!j) throw new HttpError(404, 'Journey not found');
  const b = (body ?? {}) as Partial<StoredJourney> & { actualArr?: string | null };
  if (b.actualArr !== undefined) j.actualArr = b.actualArr ? resolveNear(new Date(j.schedArr), b.actualArr).toISOString() : null;
  if (b.ticketType) j.ticketType = b.ticketType;
  if (b.claimStatus) j.claimStatus = b.claimStatus;
  save();
  return journeyDto(j);
});
route('DELETE', '/api/journeys/:id', ({ params }) => {
  requireUser();
  data.journeys = data.journeys.filter((x) => x.id !== params.id);
  save();
  return [204, undefined];
});
route('GET', '/api/delay-repay/schemes', () => {
  requireUser();
  return { note: CHECK_TERMS_NOTE, schemes: data.schemes.map((s) => ({ ...s, operator: operatorName(s.toc) })) };
});
route('PUT', '/api/delay-repay/schemes/:toc', ({ params, body }) => {
  requireUser();
  const s = data.schemes.find((x) => x.toc === params.toc);
  if (!s) throw new HttpError(404, 'Operator not found');
  const b = body as Partial<Scheme>;
  const bands = parse(delayRepayBandsSchema, b.bands);
  if (b.claimUrl && !b.claimUrl.startsWith('https://')) throw new HttpError(400, 'Invalid request', [{ path: 'claimUrl', message: 'Use an https:// link' }]);
  Object.assign(s, { name: b.name || s.name, bands, claimUrl: b.claimUrl || null, notes: b.notes || null, verifiedOn: b.verifiedOn || null, updatedAt: new Date().toISOString() });
  save();
  return s;
});

/** Handles one request; returns null for paths the demo doesn't serve. */
export async function handleDemoRequest(method: string, url: URL, body: unknown): Promise<Response | null> {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
    try {
      const result = r.handler({ params, query: url.searchParams, body });
      if (Array.isArray(result) && typeof result[0] === 'number' && result.length === 2) {
        const [status, payload] = result as [number, unknown];
        return status === 204 ? new Response(null, { status }) : json(payload, status);
      }
      return json(result);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, message: err.message, details: err.details }, err.status);
      console.error('demo api error', err);
      return json({ error: 'Demo error' }, 500);
    }
  }
  return url.pathname.startsWith('/api/') ? json({ error: 'Not available in the demo' }, 404) : null;
}
