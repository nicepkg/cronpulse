import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { Env, User } from '../types';
import { generateId, generateToken, generateSessionId } from '../utils/id';
import { now } from '../utils/time';
import { sendEmail, htmlEmail } from '../services/email';

const auth = new Hono<{ Bindings: Env }>();

// POST /auth/login - Send magic link
auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const email = (body.email as string || '').trim().toLowerCase();

  // Collect UTM params from form body (forwarded from landing page)
  const utmSource = (body.utm_source as string || '').trim();
  const utmMedium = (body.utm_medium as string || '').trim();
  const utmCampaign = (body.utm_campaign as string || '').trim();

  if (!email || !email.includes('@')) {
    return c.html(renderLoginPage('Please enter a valid email address.'), 400);
  }

  // Rate limit: 5 attempts per email per 15 minutes
  const recentTokens = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM auth_tokens WHERE email = ? AND expires_at > ?'
  ).bind(email, now() - 900).first();

  if (recentTokens && (recentTokens.count as number) >= 5) {
    return c.html(renderLoginPage('Too many login attempts. Please try again in 15 minutes.'), 429);
  }

  // Generate magic link token
  const token = generateToken();
  const expiresAt = now() + 900; // 15 minutes

  await c.env.DB.prepare(
    'INSERT INTO auth_tokens (token, email, expires_at) VALUES (?, ?, ?)'
  ).bind(token, email, expiresAt).run();

  // Send magic link email — append UTM params so verify handler can log them
  const verifyParams = new URLSearchParams({ token });
  if (utmSource) verifyParams.set('utm_source', utmSource);
  if (utmMedium) verifyParams.set('utm_medium', utmMedium);
  if (utmCampaign) verifyParams.set('utm_campaign', utmCampaign);
  const magicLink = `${c.env.APP_URL}/auth/verify?${verifyParams.toString()}`;

  const result = await sendEmail(c.env, {
    to: email,
    subject: 'Your CronPulse Login Link',
    text: `Click here to log in to CronPulse:\n\n${magicLink}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    html: htmlEmail({
      title: 'Your CronPulse Login Link',
      heading: 'Sign in to CronPulse',
      body: `<p style="margin:0 0 8px">Click the button below to sign in. This link expires in 15 minutes.</p>
        <p style="margin:0;font-size:12px;color:#6b7280">If you didn't request this, you can safely ignore this email.</p>`,
      ctaUrl: magicLink,
      ctaText: 'Sign In',
    }),
  });

  // If email was sent successfully, show "check your email" page
  if (result.sent) {
    return c.html(renderCheckEmailPage(email));
  }

  // Fallback: show magic link directly (demo mode or send failure)
  return c.html(renderDemoLinkPage(email, magicLink));
});

// GET /auth/verify - Verify magic link token
auth.get('/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/auth/login');

  const timestamp = now();

  // Find and validate token
  const authToken = await c.env.DB.prepare(
    'SELECT * FROM auth_tokens WHERE token = ? AND used = 0 AND expires_at > ?'
  ).bind(token, timestamp).first();

  if (!authToken) {
    return c.html(renderLoginPage('Invalid or expired link. Please request a new one.'), 400);
  }

  // Mark token as used
  await c.env.DB.prepare('UPDATE auth_tokens SET used = 1 WHERE token = ?').bind(token).run();

  const email = authToken.email as string;

  // Find or create user
  let user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();

  if (!user) {
    const userId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, plan, check_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, email, 'free', 10, timestamp, timestamp).run();

    // Create default email channel
    const channelId = generateId();
    await c.env.DB.prepare(
      'INSERT INTO channels (id, user_id, kind, target, name, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(channelId, userId, 'email', email, 'Email', 1, timestamp).run();

    user = { id: userId, email, plan: 'free', check_limit: 10, api_key_hash: null, webhook_signing_secret: '', timezone: 'UTC', created_at: timestamp, updated_at: timestamp };

    // Capture acquisition source from UTM params and referrer
    const utmSource = c.req.query('utm_source') || '';
    const utmMedium = c.req.query('utm_medium') || '';
    const utmCampaign = c.req.query('utm_campaign') || '';
    const referer = c.req.header('Referer') || 'direct';

    // Log new signup with source — visible via `wrangler tail`
    console.log('[NEW_SIGNUP]', JSON.stringify({
      email,
      userId,
      timestamp: new Date(timestamp * 1000).toISOString(),
      utm_source: utmSource || undefined,
      utm_medium: utmMedium || undefined,
      utm_campaign: utmCampaign || undefined,
      referer,
    }));

    // Record signup for analytics dashboard
    try {
      await c.env.DB.prepare(
        'INSERT INTO signups (user_id, email, utm_source, utm_medium, utm_campaign, referrer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(userId, email, utmSource, utmMedium, utmCampaign, referer, timestamp).run();
    } catch { /* analytics write failure is acceptable */ }

    // Fire-and-forget signup webhook notification
    if (c.env.SIGNUP_WEBHOOK_URL) {
      c.executionCtx.waitUntil(
        fetch(c.env.SIGNUP_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'user.signup',
            email,
            timestamp,
            utm_source: utmSource || undefined,
            utm_medium: utmMedium || undefined,
            utm_campaign: utmCampaign || undefined,
            referer,
          }),
        }).catch(() => {})
      );
    }
  }

  // Create session
  const sessionId = generateSessionId();
  const sessionExpires = timestamp + 30 * 86400; // 30 days

  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(sessionId, user.id, sessionExpires, timestamp).run();

  setCookie(c, 'session', sessionId, {
    path: '/',
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: 'Lax',
    maxAge: 30 * 86400,
  });

  return c.redirect('/dashboard');
});

// GET /auth/login - Login page
auth.get('/login', async (c) => {
  // If already logged in, redirect to dashboard
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const session = await c.env.DB.prepare(
      'SELECT * FROM sessions WHERE id = ? AND expires_at > ?'
    ).bind(sessionId, now()).first();
    if (session) return c.redirect('/dashboard');
  }

  // Forward UTM params from query string to the login form
  const utmParams: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const val = c.req.query(key);
    if (val) utmParams[key] = val;
  }
  return c.html(renderLoginPage(undefined, utmParams));
});

// POST /auth/logout
auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    deleteCookie(c, 'session', { path: '/' });
  }
  return c.redirect('/');
});

function renderLoginPage(error?: string, utmParams?: Record<string, string>): string {
  const utmFields = utmParams
    ? Object.entries(utmParams).map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('\n        ')
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - CronPulse</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full p-8">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900">CronPulse</h1>
      <p class="text-gray-500 mt-2">Cron job monitoring made simple</p>
    </div>
    <div class="bg-white rounded-lg shadow-sm border p-6">
      <h2 class="text-lg font-semibold mb-4">Sign in to your account</h2>
      ${error ? `<div class="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/auth/login">
        ${utmFields}
        <label class="block text-sm font-medium text-gray-700 mb-1">Email address</label>
        <input type="email" name="email" required autofocus
          class="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="you@example.com">
        <button type="submit"
          class="w-full mt-4 bg-blue-600 text-white py-2 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          Send Magic Link
        </button>
      </form>
      <p class="text-xs text-gray-400 mt-4 text-center">We'll send you a login link. No password needed.</p>
    </div>
  </div>
</body>
</html>`;
}

function renderCheckEmailPage(email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Check Your Email - CronPulse</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full p-8 text-center">
    <div class="bg-white rounded-lg shadow-sm border p-8">
      <div class="text-4xl mb-4">📧</div>
      <h2 class="text-xl font-semibold mb-2">Check your email</h2>
      <p class="text-gray-600 text-sm">We sent a login link to <strong>${escapeHtml(email)}</strong></p>
      <p class="text-gray-400 text-xs mt-4">The link expires in 15 minutes.</p>
      <a href="/auth/login" class="text-blue-600 text-sm mt-4 inline-block hover:underline">Back to login</a>
    </div>
  </div>
</body>
</html>`;
}

function renderDemoLinkPage(email: string, magicLink: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - CronPulse</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full p-8 text-center">
    <div class="bg-white rounded-lg shadow-sm border p-8">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
        <p class="text-blue-800 text-xs font-medium">Direct login link (email could not be delivered)</p>
      </div>
      <h2 class="text-xl font-semibold mb-2">Your login link</h2>
      <p class="text-gray-600 text-sm mb-4">Click the link below to sign in as <strong>${escapeHtml(email)}</strong></p>
      <a href="${escapeHtml(magicLink)}"
        class="block bg-blue-600 text-white py-3 px-4 rounded-md text-sm font-medium hover:bg-blue-700 mb-3">
        Sign in to CronPulse
      </a>
      <p class="text-gray-400 text-xs">This link expires in 15 minutes.</p>
      <a href="/auth/login" class="text-blue-600 text-sm mt-4 inline-block hover:underline">Back to login</a>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default auth;
