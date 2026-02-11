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
  opts: { to: string; subject: string; text: string; from?: string }
): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    console.log(`[demo mode] Email to ${opts.to}: ${opts.subject}`);
    return { sent: false, demo: true };
  }

  // Use Resend test domain until custom domain is verified
  const from = RESEND_TEST_FROM;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
      }),
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
