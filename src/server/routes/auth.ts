import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { deleteCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { loginBody, registerBody } from '../validators/auth';
import { authenticate, createSessionToken, registerUser, SESSION_COOKIE, SESSION_MAX_AGE } from '../services/auth';
import { requireAuth } from '../middlewares/auth';
import { env } from '../env';
import type { SessionUser } from '../../types';

// httpOnly : le JWT n'est pas lisible en JavaScript côté navigateur
async function openSession(c: Context, user: SessionUser) {
  setCookie(c, SESSION_COOKIE, await createSessionToken(user), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.isProd,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export const auth = new Hono()
  .post('/register', zValidator('json', registerBody), async (c) => {
    const user = await registerUser(c.req.valid('json'));
    if (!user) throw new HTTPException(409, { message: 'Un compte existe déjà avec cet email' });
    await openSession(c, user);
    return c.json(user, 201);
  })
  .post('/login', zValidator('json', loginBody), async (c) => {
    const { email, password } = c.req.valid('json');
    const user = await authenticate(email, password);
    if (!user) throw new HTTPException(401, { message: 'Email ou mot de passe incorrect' });
    await openSession(c, user);
    return c.json(user);
  })
  .post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  })
  .get('/me', requireAuth, (c) => c.json(c.get('user')));
