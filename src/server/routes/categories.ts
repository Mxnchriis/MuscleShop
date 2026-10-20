import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCategoryBySlug, listCategories, listProducts } from '../services/catalog';

export const categories = new Hono()
  .get('/', (c) => c.json({ items: listCategories() }))
  .get('/:slug', (c) => {
    const slug = c.req.param('slug');
    const category = getCategoryBySlug(slug);
    if (!category) throw new HTTPException(404, { message: 'Catégorie introuvable' });
    return c.json({ ...category, products: listProducts({ category: slug }) });
  });
