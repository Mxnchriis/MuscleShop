import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { requireAdmin } from '../middlewares/auth';
import { adminOrdersQuery, benchmarkBody, metricsQuery, orderStatusBody, simulationBody, stockBody } from '../validators/admin';
import { getSimulation, startSimulation, stopSimulation } from '../services/simulation';
import { getDashboard, listAdminOrders, listStock, shipOrder, updateStock } from '../services/admin';
import { getMetricsReport, resetMetrics } from '../services/metrics';
import { getSystemReport, resetEventLoopStats } from '../services/system';
import { benchmarkTargets, runBenchmark } from '../services/benchmark';

// Toutes les routes /api/admin/* sont réservées aux administrateurs
export const admin = new Hono()
  .use(requireAdmin)
  .get('/stats', (c) => c.json(getDashboard()))
  .get('/products', (c) => c.json({ items: listStock() }))
  .patch('/products/:id/stock', zValidator('json', stockBody), (c) => {
    const product = updateStock(Number(c.req.param('id')), c.req.valid('json').stock);
    if (!product) throw new HTTPException(404, { message: 'Produit introuvable' });
    return c.json(product);
  })
  .get('/orders', zValidator('query', adminOrdersQuery), (c) => c.json({ items: listAdminOrders(c.req.valid('query')) }))
  .patch('/orders/:id/status', zValidator('json', orderStatusBody), (c) => {
    const order = shipOrder(Number(c.req.param('id')));
    if (!order) throw new HTTPException(404, { message: 'Commande introuvable' });
    return c.json(order);
  })
  // Métriques collectées par les middlewares Astro et Hono + état du processus Node
  .get('/metrics', zValidator('query', metricsQuery), (c) => {
    return c.json({ report: getMetricsReport(c.req.valid('query').window), system: getSystemReport() });
  })
  .delete('/metrics', (c) => {
    resetMetrics();
    resetEventLoopStats();
    return c.json({ ok: true });
  })
  // Journée simulée : visiteurs virtuels dans un processus séparé (scripts/simulation.mjs)
  .get('/simulation', (c) => c.json(getSimulation()))
  .post('/simulation', zValidator('json', simulationBody), (c) => {
    const started = startSimulation({ ...c.req.valid('json'), origin: new URL(c.req.url).origin, architecture: 'ssr', version: 'astro-hono' });
    if (!started) throw new HTTPException(409, { message: 'Une simulation est déjà en cours' });
    return c.json(started, 202);
  })
  .delete('/simulation', (c) => c.json(stopSimulation()))
  .get('/benchmark/targets', (c) => c.json({ items: benchmarkTargets }))
  .post('/benchmark', zValidator('json', benchmarkBody), async (c) => {
    // Import au moment de l'appel : app.ts importe ce fichier, l'inverse créerait une boucle au chargement
    const { default: app } = await import('../app');
    const { target, iterations } = c.req.valid('json');
    return c.json(
      await runBenchmark({ target, iterations, origin: new URL(c.req.url).origin, internalFetch: (path, init) => app.request(path, init) }),
    );
  });
