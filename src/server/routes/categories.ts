import { Hono } from 'hono';

export const categories = new Hono()
  .get('/', (c) => c.json({ items: [] }))
  .get('/:slug', (c) => c.json({ slug: c.req.param('slug') }));
