import { Hono } from 'hono';
import { requireAuth } from '../middlewares/auth';

export const orders = new Hono()
  .use(requireAuth)
  .get('/', (c) => c.json({ items: [] }))
  .post('/', (c) => c.json({ status: 'pending' }, 201))
  .get('/:id', (c) => c.json({ id: Number(c.req.param('id')) }));
