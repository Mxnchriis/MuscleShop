import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { productListQuery } from '../validators/products';
import { getProductBySlug, listProducts } from '../services/catalog';

export const products = new Hono()
  .get('/', zValidator('query', productListQuery), (c) => {
    return c.json({ items: listProducts(c.req.valid('query')) });
  })
  .get('/:slug', (c) => {
    const product = getProductBySlug(c.req.param('slug'));
    if (!product) throw new HTTPException(404, { message: 'Produit introuvable' });
    return c.json(product);
  });
