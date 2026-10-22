import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { getSessionUser, SESSION_COOKIE } from '../services/auth';
import type { SessionUser } from '../../types';

type AuthEnv = { Variables: { user: SessionUser } };

// Vérifie le JWT du cookie de session et expose l'utilisateur via c.get('user')
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) throw new HTTPException(401, { message: 'Non authentifié' });
  c.set('user', user);
  await next();
});

// Comme requireAuth, mais réservé aux administrateurs (rôle relu en base à chaque requête)
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const user = await getSessionUser(getCookie(c, SESSION_COOKIE));
  if (!user) throw new HTTPException(401, { message: 'Non authentifié' });
  if (user.role !== 'admin') throw new HTTPException(403, { message: 'Accès réservé aux administrateurs' });
  c.set('user', user);
  await next();
});
