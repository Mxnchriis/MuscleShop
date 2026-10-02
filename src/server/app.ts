import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { errorHandler } from './middlewares/error-handler';
import { products } from './routes/products';
import { categories } from './routes/categories';
import { cart } from './routes/cart';
import { orders } from './routes/orders';
import { auth } from './routes/auth';

const app = new Hono().basePath('/api');

app.use(logger());
app.onError(errorHandler);

const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/products', products)
  .route('/categories', categories)
  .route('/cart', cart)
  .route('/orders', orders)
  .route('/auth', auth);

export default app;
export type AppType = typeof routes;
