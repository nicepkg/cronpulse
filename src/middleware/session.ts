import { getCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import type { Env, User } from '../types';
import { now } from '../utils/time';

export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: User } }>, next: Next) {
  const sessionId = getCookie(c, 'session');

  if (!sessionId) {
    return c.redirect('/auth/login');
  }

  const session = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?'
  ).bind(sessionId, now()).first();

  if (!session) {
    return c.redirect('/auth/login');
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(session.user_id).first<User>();

  if (!user) {
    return c.redirect('/auth/login');
  }

  c.set('user', user);
  await next();
}
