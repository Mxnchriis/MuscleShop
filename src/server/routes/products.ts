import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { productListQuery } from '../validators/products';

// TODO : brancher sur db (src/server/db/client.ts)
export const products = new Hono()
  .get('/', zValidator('query', productListQuery), (c) => {
    const { q, category } = c.req.valid('query');
    return c.json({ items: [], q, category });
  })
  .get('/:slug', (c) => {
    return c.json({ slug: c.req.param('slug') });
  });
