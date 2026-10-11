/**
 * Parses a REDIS_URL into ioredis/BullMQ connection options. Supports
 * `rediss://` (TLS) and a `?family=6` query parameter, which Fly.io's private
 * network (IPv6, `*.internal` / `*.flycast` hosts) needs.
 */
export interface RedisUrlOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  family?: 4 | 6;
  tls?: Record<string, never>;
}

export function redisOptionsFromUrl(url: string): RedisUrlOptions {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') throw new Error('REDIS_URL must start with redis:// or rediss://');
  const family = u.searchParams.get('family');
  if (family && family !== '4' && family !== '6') throw new Error('REDIS_URL family must be 4 or 6');
  return {
    host: u.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    ...(family ? { family: Number(family) as 4 | 6 } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
