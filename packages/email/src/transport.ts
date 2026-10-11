export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** Dev/test transport: logs each message and keeps it in memory. */
export class ConsoleTransport implements EmailTransport {
  readonly name = 'console';
  readonly sent: Array<EmailMessage & { id: string; from: string }> = [];

  constructor(
    private readonly from: string,
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const id = `console-${this.sent.length + 1}`;
    this.sent.push({ ...message, id, from: this.from });
    this.log(`\n--- email ${id} ---\nFrom: ${this.from}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n---`);
    return { id };
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** Resend HTTP API transport. */
export class ResendTransport implements EmailTransport {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<{ id: string }> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error('Resend response had no id');
    return { id: body.id };
  }
}

export function createTransport(env: { EMAIL_TRANSPORT?: string; EMAIL_FROM?: string; RESEND_API_KEY?: string }): EmailTransport {
  const from = env.EMAIL_FROM ?? 'My Commuter Train <alerts@localhost>';
  if (env.EMAIL_TRANSPORT === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when EMAIL_TRANSPORT=resend');
    return new ResendTransport(env.RESEND_API_KEY, from);
  }
  return new ConsoleTransport(from);
}
