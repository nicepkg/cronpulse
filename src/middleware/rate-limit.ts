import type { Context, Next } from 'hono';
import type { Env } from '../types';

interface RateLimitConfig {
  windowMs: number;  // window size in ms
  max: number;       // max requests per window
  keyPrefix: string; // KV key prefix
}

export function rateLimit(config: RateLimitConfig) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Use user ID from context (set by auth middleware) or IP
    const user = (c as any).get('user');
    const key = `${config.keyPrefix}:${user?.id || c.req.header('CF-Connecting-IP') || 'unknown'}`;

    try {
      const current = await c.env.KV.get(key);
      const count = current ? parseInt(current) : 0;

      if (count >= config.max) {
        return c.json({
          error: 'Rate limit exceeded',
          retry_after: Math.ceil(config.windowMs / 1000),
        }, 429, {
          'Retry-After': String(Math.ceil(config.windowMs / 1000)),
          'X-RateLimit-Limit': String(config.max),
          'X-RateLimit-Remaining': '0',
        });
      }

      // Increment counter
      await c.env.KV.put(key, String(count + 1), {
        expirationTtl: Math.ceil(config.windowMs / 1000),
      });

      // Set rate limit headers
      c.header('X-RateLimit-Limit', String(config.max));
      c.header('X-RateLimit-Remaining', String(config.max - count - 1));
    } catch {
      // If KV fails, allow the request (fail open)
    }

    await next();
  };
}
