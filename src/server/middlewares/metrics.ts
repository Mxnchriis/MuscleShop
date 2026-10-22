import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import { recordMetric } from '../services/metrics';

// En-têtes posés par les appelants pour qualifier la requête
export const INTERNAL_CALL_HEADER = 'x-internal-call'; // client RPC des pages Astro (app.request)
export const BENCHMARK_HEADER = 'x-benchmark'; // requêtes du benchmark : non comptées

// Routes du panel de performance lui-même : non comptées (sinon le panel mesure surtout… le panel)
export const isPerfPanelPath = (path: string) => path.startsWith('/api/admin/metrics') || path.startsWith('/api/admin/benchmark');

// Chronomètre chaque requête traitée par Hono (premier middleware de l'app).
// Ajoute un en-tête Server-Timing, visible dans l'onglet Réseau du navigateur.
export const metrics = createMiddleware(async (c, next) => {
  const start = performance.now();
  await next();
  const durationMs = performance.now() - start;

  c.header('Server-Timing', `hono;desc="Hono";dur=${durationMs.toFixed(2)}`, { append: true });

  // Gabarit de la route qui a répondu (ex. /api/products/:slug), pas l'URL réelle
  const route = routePath(c, -1);
  if (c.req.header(BENCHMARK_HEADER) || isPerfPanelPath(c.req.path)) return; // pas de bruit

  recordMetric({
    source: c.req.header(INTERNAL_CALL_HEADER) ? 'api-internal' : 'api-http',
    method: c.req.method,
    route: route === '*' || route === '/*' ? '(aucune route)' : route,
    path: c.req.path,
    status: c.res.status,
    durationMs,
  });
});
