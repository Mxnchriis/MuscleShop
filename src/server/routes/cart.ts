import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { cartItemBody } from '../validators/cart';

export const cart = new Hono()
  .get('/', (c) => c.json({ items: [] }))
  .post('/items', zValidator('json', cartItemBody), (c) => {
    const item = c.req.valid('json');
    return c.json({ added: item }, 201);
  })
  .patch('/items/:productId', zValidator('json', cartItemBody.pick({ quantity: true })), (c) => {
    return c.json({ productId: Number(c.req.param('productId')), ...c.req.valid('json') });
  })
  .delete('/items/:productId', (c) => c.body(null, 204));
