import { describe, expect, it } from 'vitest';
import { ConsoleTransport, createTransport, ResendTransport, verifyEmailMessage } from '../src/index.ts';

describe('email transports', () => {
  it('console transport records messages', async () => {
    const t = new ConsoleTransport('from@example.com', () => {});
    const { id } = await t.send(verifyEmailMessage('a@example.com', 'A <b>', 'https://x/verify?t=1'));
    expect(id).toBe('console-1');
    expect(t.sent[0]!.html).toContain('A &lt;b&gt;');
    expect(t.sent[0]!.text).toContain('https://x/verify?t=1');
  });

  it('resend transport posts to the API', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'r1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new ResendTransport('key', 'from@example.com', fake);
    expect(await t.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).toEqual({ id: 'r1' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ to: ['a@example.com'], from: 'from@example.com' });
  });

  it('requires an API key for resend', () => {
    expect(() => createTransport({ EMAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(createTransport({}).name).toBe('console');
  });
});
