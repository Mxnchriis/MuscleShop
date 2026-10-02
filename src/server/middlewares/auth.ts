import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';

// TODO : vérifier le JWT (hono/jwt) et exposer l'utilisateur via c.set('user', …)
export const requireAuth = createMiddleware(async (c, next) => {
  const token = getCookie(c, 'session');
  if (!token) throw new HTTPException(401, { message: 'Non authentifié' });
  await next();
});
