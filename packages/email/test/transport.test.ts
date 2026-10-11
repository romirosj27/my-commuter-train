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

describe('alert email', async () => {
  const { alertEmailMessage } = await import('../src/index.ts');
  it('is short, escapes content and carries one-click unsubscribe headers', () => {
    const m = alertEmailMessage({
      to: 'a@example.com',
      train: '07:40 Newcastle to York',
      operator: 'CrossCountry',
      lines: [{ headline: 'Now platform 4', detail: 'Was platform 2 <b>' }],
      serviceUrl: 'https://app/s/1',
      settingsUrl: 'https://app/c/1',
      unsubscribeUrl: 'https://api/unsub?token=t',
      unsubscribePostUrl: 'https://api/unsub?token=t',
    });
    expect(m.subject).toBe('Now platform 4: 07:40 Newcastle to York');
    expect(m.html).toContain('Was platform 2 &lt;b&gt;');
    expect(m.text).toContain('Unsubscribe from alerts for this commute: https://api/unsub?token=t');
    expect(m.headers).toEqual({ 'List-Unsubscribe': '<https://api/unsub?token=t>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  });
});
