import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { errorHandler } from './middlewares/error-handler';
import { BENCHMARK_HEADER, metrics } from './middlewares/metrics';
import { products } from './routes/products';
import { categories } from './routes/categories';
import { cart } from './routes/cart';
import { orders } from './routes/orders';
import { auth } from './routes/auth';
import { admin } from './routes/admin';

const app = new Hono().basePath('/api');

// metrics en premier : il chronomètre tout le reste (logger, routes, erreurs)
app.use(metrics);
// Journal des requêtes, sauf celles du benchmark (des centaines de lignes inutiles)
const log = logger();
app.use((c, next) => (c.req.header(BENCHMARK_HEADER) ? next() : log(c, next)));
app.onError(errorHandler);

const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/products', products)
  .route('/categories', categories)
  .route('/cart', cart)
  .route('/orders', orders)
  .route('/auth', auth)
  .route('/admin', admin);

export default app;
export type AppType = typeof routes;
