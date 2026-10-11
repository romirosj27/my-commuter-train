import type { EmailMessage } from './transport.ts';
import { button, escapeHtml, layout } from './layout.ts';

/** One change in an alert email, already in plain words. */
export interface AlertLine {
  /** Short headline, e.g. "Now platform 4" or "Cancelled". */
  headline: string;
  /** Optional detail, e.g. the reason or the new expected time. */
  detail?: string | null;
}

export interface AlertEmailInput {
  to: string;
  /** e.g. "07:40 Newcastle to York" */
  train: string;
  operator: string;
  lines: AlertLine[];
  serviceUrl: string;
  settingsUrl: string;
  /** Page with a one-click unsubscribe button (for the email body). */
  unsubscribeUrl: string;
  /** RFC 8058 one-click POST target (for the List-Unsubscribe header). */
  unsubscribePostUrl: string;
}

export function alertEmailMessage(a: AlertEmailInput): EmailMessage {
  const subject = `${a.lines.map((l) => l.headline).join(' · ')}: ${a.train}`;
  const text = [
    `${a.train} (${a.operator})`,
    '',
    ...a.lines.map((l) => `• ${l.headline}${l.detail ? ` — ${l.detail}` : ''}`),
    '',
    `Live details: ${a.serviceUrl}`,
    '',
    `Alert settings: ${a.settingsUrl}`,
    `Unsubscribe from alerts for this commute: ${a.unsubscribeUrl}`,
  ].join('\n');
  const html = layout({
    title: subject,
    bodyHtml: `
<p style="margin:0 0 4px;font-size:13px;color:#555;">${escapeHtml(a.operator)}</p>
<p style="margin:0 0 12px;font-size:18px;font-weight:600;">${escapeHtml(a.train)}</p>
${a.lines
  .map(
    (l) => `<p style="margin:0 0 8px;"><strong>${escapeHtml(l.headline)}</strong>${l.detail ? `<br><span style="color:#444;">${escapeHtml(l.detail)}</span>` : ''}</p>`,
  )
  .join('\n')}
${button(a.serviceUrl, 'See live details')}`,
    footerHtml: `<a href="${escapeHtml(a.settingsUrl)}" style="color:#555;">Alert settings</a> · <a href="${escapeHtml(a.unsubscribeUrl)}" style="color:#555;">Unsubscribe</a>`,
  });
  return {
    to: a.to,
    subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${a.unsubscribePostUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
