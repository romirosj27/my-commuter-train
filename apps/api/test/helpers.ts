import type { DbHandle } from '@mct/db';
import { ConsoleTransport } from '@mct/email';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, type AppOptions } from '../src/app.ts';

export const WEB = 'http://localhost:5173';
export const API = 'http://localhost:8080';

export async function testApp(db: DbHandle, over: Partial<AppOptions> = {}) {
  const email = new ConsoleTransport('test@example.com', () => {});
  const app = await buildApp({
    db,
    email,
    authSecret: 'test-secret-test-secret-test-secret-123',
    apiURL: API,
    webURL: WEB,
    authInternalRateLimit: false,
    ...over,
  });
  return { app, email };
}

/** Cookie jar for one signed-in user. */
export class Client {
  cookie = '';
  constructor(private readonly app: FastifyInstance) {}

  async request(opts: InjectOptions) {
    const res = await this.app.inject({
      ...opts,
      headers: { origin: WEB, ...(this.cookie ? { cookie: this.cookie } : {}), ...(opts.headers ?? {}) },
    });
    const set = res.headers['set-cookie'];
    if (set) {
      const jar = new Map(this.cookie ? this.cookie.split('; ').map((c) => c.split('=') as [string, string]) : []);
      for (const c of Array.isArray(set) ? set : [set]) {
        const [pair] = c.split(';');
        const [k, ...v] = pair!.split('=');
        jar.set(k!, v.join('='));
      }
      this.cookie = [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    return res;
  }

  get(url: string) {
    return this.request({ method: 'GET', url });
  }
  post(url: string, payload?: unknown) {
    return this.request({ method: 'POST', url, payload: payload as InjectOptions['payload'] });
  }
  put(url: string, payload?: unknown) {
    return this.request({ method: 'PUT', url, payload: payload as InjectOptions['payload'] });
  }
  patch(url: string, payload?: unknown) {
    return this.request({ method: 'PATCH', url, payload: payload as InjectOptions['payload'] });
  }
  delete(url: string, payload?: unknown) {
    return this.request({ method: 'DELETE', url, payload: payload as InjectOptions['payload'] });
  }
}

export function linkFrom(email: ConsoleTransport, to: string): string {
  const msg = [...email.sent].reverse().find((m) => m.to === to);
  if (!msg) throw new Error(`no email to ${to}`);
  const url = /https?:\/\/\S+/.exec(msg.text)?.[0];
  if (!url) throw new Error('no link in email');
  return url;
}

/** Signs up, follows the verification link and returns a signed-in client. */
export async function signedInUser(app: FastifyInstance, email: ConsoleTransport, address: string, password = 'correct-horse-battery') {
  const c = new Client(app);
  const res = await c.post('/api/auth/sign-up/email', { email: address, password, name: address.split('@')[0], callbackURL: `${WEB}/` });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const link = new URL(linkFrom(email, address));
  const verify = await c.get(link.pathname + link.search);
  if (verify.statusCode >= 400) throw new Error(`verify failed: ${verify.statusCode} ${verify.body}`);
  return c;
}
