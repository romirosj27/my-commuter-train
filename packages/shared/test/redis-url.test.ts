import { describe, expect, it } from 'vitest';
import { redisOptionsFromUrl } from '../src/redis-url.ts';

describe('redisOptionsFromUrl', () => {
  it('parses host, port, password, db and IPv6 family', () => {
    expect(redisOptionsFromUrl('redis://:s%40cret@my-redis.internal:6379/2?family=6')).toEqual({
      host: 'my-redis.internal', port: 6379, password: 's@cret', db: 2, family: 6,
    });
    expect(redisOptionsFromUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379, db: 0 });
    expect(redisOptionsFromUrl('rediss://default:p@host:6380')).toMatchObject({ username: 'default', tls: {} });
    expect(redisOptionsFromUrl('redis://[fdaa::3]:6379').host).toBe('fdaa::3');
  });

  it('rejects other schemes and bad families', () => {
    expect(() => redisOptionsFromUrl('http://x')).toThrow();
    expect(() => redisOptionsFromUrl('redis://x?family=5')).toThrow();
  });
});
