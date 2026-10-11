import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth.ts';
import { HttpError } from '../lib/http.ts';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

function toHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const value of Array.isArray(v) ? v : [String(v)]) headers.append(k, value);
  }
  return headers;
}

/** Mounts Better Auth at /api/auth/* and provides a `requireUser` pre-handler. */
export async function authPlugin(app: FastifyInstance, auth: Auth, authRateLimitPerMin: number) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rateLimit: { max: authRateLimitPerMin, timeWindow: '1 minute' } },
    async handler(req, reply) {
      const url = new URL(req.url, `${req.protocol}://${req.headers.host ?? 'localhost'}`);
      const hasBody = req.method !== 'GET' && req.body !== undefined && req.body !== null;
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers: toHeaders(req),
          body: hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined,
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });

  app.decorate('requireUser', async (req: FastifyRequest, _reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: toHeaders(req) });
    if (!session) throw new HttpError(401, 'Sign in required');
    if (!session.user.emailVerified) throw new HttpError(403, 'Email not verified');
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerified: session.user.emailVerified,
    };
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function userOf(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'Sign in required');
  return req.user;
}
