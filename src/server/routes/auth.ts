import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { deleteCookie } from 'hono/cookie';
import { loginBody, registerBody } from '../validators/auth';

export const auth = new Hono()
  .post('/register', zValidator('json', registerBody), (c) => {
    const { email, name } = c.req.valid('json');
    return c.json({ email, name }, 201);
  })
  .post('/login', zValidator('json', loginBody), (c) => {
    return c.json({ ok: true });
  })
  .post('/logout', (c) => {
    deleteCookie(c, 'session');
    return c.json({ ok: true });
  });
