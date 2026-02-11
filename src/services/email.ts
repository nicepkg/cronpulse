import type { Env } from '../types';

// Email sender domain: use custom domain if configured, else Resend test domain
const CUSTOM_DOMAIN = 'cron-pulse.com';
const RESEND_TEST_FROM = 'CronPulse <onboarding@resend.dev>';

function getFromAddress(name: string): string {
  return `CronPulse <${name}@${CUSTOM_DOMAIN}>`;
}

export interface SendEmailResult {
  sent: boolean;
  demo: boolean;
  error?: string;
}

/**
 * Send an email via Resend API.
 * Falls back to console logging in demo mode (no API key).
 */
export async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; text: string; html?: string; from?: string }
): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    console.log(`[demo mode] Email to ${opts.to}: ${opts.subject}`);
    return { sent: false, demo: true };
  }

  // Use Resend test domain until custom domain is verified
  const from = RESEND_TEST_FROM;

  try {
    const body: Record<string, string> = {
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    };
    if (opts.html) body.html = opts.html;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend API error:', res.status, errText);
      return { sent: false, demo: false, error: errText };
    }

    return { sent: true, demo: false };
  } catch (e) {
    console.error('Failed to send email:', e);
    return { sent: false, demo: false, error: String(e) };
  }
}

/** Wrap plain text content in a simple, responsive HTML email template */
export function htmlEmail(opts: {
  title: string;
  heading: string;
  body: string;
  ctaUrl?: string;
  ctaText?: string;
  footerText?: string;
}): string {
  const cta = opts.ctaUrl ? `
      <tr><td style="padding:24px 0 0">
        <a href="${escapeAttr(opts.ctaUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(opts.ctaText || 'View Details')}</a>
      </td></tr>` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;border:1px solid #e5e7eb">
  <tr><td style="padding:32px 32px 0;text-align:center">
    <h1 style="margin:0;font-size:20px;color:#111827">${escapeHtml(opts.heading)}</h1>
  </td></tr>
  <tr><td style="padding:20px 32px;color:#374151;font-size:14px;line-height:1.6">
    ${opts.body}
  </td></tr>${cta}
  <tr><td style="padding:24px 32px;border-top:1px solid #e5e7eb;text-align:center">
    <p style="margin:0;font-size:12px;color:#9ca3af">${opts.footerText || 'CronPulse &mdash; Cron Job Monitoring'}</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
