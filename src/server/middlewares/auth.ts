import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { readSessionToken, SESSION_COOKIE } from '../services/auth';
import type { SessionUser } from '../../types';

// Vérifie le JWT du cookie de session et expose l'utilisateur via c.get('user')
export const requireAuth = createMiddleware<{ Variables: { user: SessionUser } }>(async (c, next) => {
  const user = await readSessionToken(getCookie(c, SESSION_COOKIE));
  if (!user) throw new HTTPException(401, { message: 'Non authentifié' });
  c.set('user', user);
  await next();
});
