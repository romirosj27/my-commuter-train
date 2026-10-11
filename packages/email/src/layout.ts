/** Minimal, phone-friendly HTML wrapper shared by every email. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface LayoutParts {
  title: string;
  /** Pre-escaped HTML body. */
  bodyHtml: string;
  footerHtml?: string;
}

export function layout({ title, bodyHtml, footerHtml }: LayoutParts): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:16px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:20px;line-height:1.5;font-size:16px;">
${bodyHtml}
</div>
${footerHtml ? `<div style="max-width:480px;margin:12px auto 0;font-size:13px;color:#555;line-height:1.5;">${footerHtml}</div>` : ''}
</body></html>`;
}

export function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">${escapeHtml(label)}</a></p>`;
}
