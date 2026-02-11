import { Hono } from 'hono';
import type { Env } from '../types';
import { now } from '../utils/time';

const webhooks = new Hono<{ Bindings: Env }>();

// Plan config: plan name -> { check_limit }
const PLAN_LIMITS: Record<string, { check_limit: number }> = {
  free: { check_limit: 10 },
  starter: { check_limit: 50 },
  pro: { check_limit: 200 },
  business: { check_limit: 1000 },
};

// LemonSqueezy variant ID -> plan name mapping
// These will be set after creating products in LemonSqueezy dashboard
const VARIANT_TO_PLAN: Record<string, string> = {
  // To be configured: 'variant_id': 'starter' | 'pro' | 'business'
};

// POST /webhooks/lemonsqueezy
webhooks.post('/lemonsqueezy', async (c) => {
  const signature = c.req.header('X-Signature');
  if (!signature) return c.text('Missing signature', 401);

  const rawBody = await c.req.text();

  // Verify HMAC signature
  const isValid = await verifySignature(rawBody, signature, c.env.LEMONSQUEEZY_WEBHOOK_SECRET);
  if (!isValid) return c.text('Invalid signature', 401);

  const payload = JSON.parse(rawBody);
  const eventName = payload.meta?.event_name;

  if (!eventName) return c.json({ received: true });

  switch (eventName) {
    case 'subscription_created':
    case 'subscription_updated':
      await handleSubscriptionChange(payload, c.env);
      break;
    case 'subscription_cancelled':
      await handleSubscriptionCancelled(payload, c.env);
      break;
    case 'subscription_expired':
      await handleSubscriptionExpired(payload, c.env);
      break;
  }

  return c.json({ received: true });
});

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (hex.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < hex.length; i++) {
    result |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

async function handleSubscriptionChange(payload: any, env: Env) {
  const attrs = payload.data?.attributes;
  if (!attrs) return;

  const email = attrs.user_email?.toLowerCase();
  if (!email) return;

  const variantId = String(attrs.variant_id);
  const status = attrs.status; // 'active', 'past_due', 'paused', 'cancelled', 'expired'

  // Determine plan from variant ID, or from product name as fallback
  let plan = VARIANT_TO_PLAN[variantId];
  if (!plan) {
    // Fallback: try to match from product name
    const productName = attrs.product_name?.toLowerCase() || '';
    if (productName.includes('business')) plan = 'business';
    else if (productName.includes('pro')) plan = 'pro';
    else if (productName.includes('starter')) plan = 'starter';
    else plan = 'starter'; // Default to starter for unknown
  }

  // Only upgrade if subscription is active
  if (status !== 'active') return;

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const timestamp = now();

  // Find user by email
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();

  if (user) {
    await env.DB.prepare(
      'UPDATE users SET plan = ?, check_limit = ?, updated_at = ? WHERE id = ?'
    ).bind(plan, limits.check_limit, timestamp, user.id).run();
  }
  // If user doesn't exist yet, they'll get the right plan when they sign up
  // (we could store pending upgrades, but KISS for MVP)
}

async function handleSubscriptionCancelled(payload: any, env: Env) {
  // Subscription cancelled but still active until end of billing period
  // Don't downgrade yet — LemonSqueezy will send subscription_expired when it actually ends
  const attrs = payload.data?.attributes;
  if (!attrs) return;

  const email = attrs.user_email?.toLowerCase();
  if (!email) return;

  // Just log for now — actual downgrade happens on expiry
  console.log(`Subscription cancelled for ${email}, will expire at end of billing period`);
}

async function handleSubscriptionExpired(payload: any, env: Env) {
  const attrs = payload.data?.attributes;
  if (!attrs) return;

  const email = attrs.user_email?.toLowerCase();
  if (!email) return;

  const timestamp = now();
  const limits = PLAN_LIMITS.free;

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();

  if (user) {
    await env.DB.prepare(
      'UPDATE users SET plan = ?, check_limit = ?, updated_at = ? WHERE id = ?'
    ).bind('free', limits.check_limit, timestamp, user.id).run();

    // Note: We don't delete excess checks — they just become inactive
    // User can choose which to keep when they downgrade
  }
}

export default webhooks;
