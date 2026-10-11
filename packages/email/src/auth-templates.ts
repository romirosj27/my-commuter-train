import type { EmailMessage } from './transport.ts';
import { button, escapeHtml, layout } from './layout.ts';

export function verifyEmailMessage(to: string, name: string, url: string): EmailMessage {
  const subject = 'Confirm your email address';
  return {
    to,
    subject,
    text: `Hi ${name},\n\nConfirm your email address to start tracking your commute:\n${url}\n\nIf you didn't sign up, you can ignore this email.`,
    html: layout({
      title: subject,
      bodyHtml: `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email address to start tracking your commute.</p>${button(url, 'Confirm email')}<p style="font-size:13px;color:#555;">If you didn't sign up, you can ignore this email.</p>`,
    }),
  };
}

export function resetPasswordMessage(to: string, name: string, url: string): EmailMessage {
  const subject = 'Reset your password';
  return {
    to,
    subject,
    text: `Hi ${name},\n\nReset your password using this link (valid for 1 hour):\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: layout({
      title: subject,
      bodyHtml: `<p>Hi ${escapeHtml(name)},</p><p>Use the button below to reset your password. The link is valid for 1 hour.</p>${button(url, 'Reset password')}<p style="font-size:13px;color:#555;">If you didn't ask for this, you can ignore this email.</p>`,
    }),
  };
}
