import { BENCHMARK_HEADER } from '../middlewares/metrics';
import { latencyStats } from './metrics';
import type { benchmarkTargetIds } from '../validators/admin';

type TargetId = (typeof benchmarkTargetIds)[number];

// Cibles autorisées (liste fermée : le benchmark ne peut pas appeler n'importe quelle URL)
export const benchmarkTargets: Record<TargetId, { path: string; label: string; api: boolean }> = {
  'api-health': { path: '/api/health', label: 'API · santé (sans base)', api: true },
  'api-products': { path: '/api/products', label: 'API · liste des produits', api: true },
  'api-product': { path: '/api/products/whey-vanille-1kg', label: 'API · fiche produit', api: true },
  'api-categories': { path: '/api/categories', label: 'API · catégories', api: true },
  'page-home': { path: '/', label: 'Page · accueil (4 appels API)', api: false },
  'page-catalog': { path: '/produits', label: 'Page · catalogue', api: false },
  'page-product': { path: '/produits/whey-vanille-1kg', label: 'Page · fiche produit', api: false },
};

type Fetcher = (path: string, init: RequestInit) => Response | Promise<Response>;

interface BenchmarkInput {
  target: TargetId;
  iterations: number;
  origin: string; // URL du serveur pour le mode HTTP
  internalFetch: Fetcher; // app.request de Hono pour le mode interne
}

const WARMUP = 5;

// Compare, sur la même cible :
// - "internal" : Hono seul, appelé dans le processus (app.request), sans Node HTTP ni Astro ;
// - "http"     : le chemin complet d'un visiteur (pile HTTP de Node → Astro → Hono pour /api).
// Les requêtes portent l'en-tête x-benchmark : elles ne polluent pas les métriques.
export async function runBenchmark({ target, iterations, origin, internalFetch }: BenchmarkInput) {
  const { path, label, api } = benchmarkTargets[target];
  const headers = { [BENCHMARK_HEADER]: '1' };

  const modes = [
    ...(api ? [{ mode: 'internal', label: 'Appel interne (Hono seul)', call: () => internalFetch(path, { headers }) }] : []),
    {
      mode: 'http',
      label: api ? 'HTTP (Node → Astro → Hono)' : 'HTTP (Node → Astro, rendu complet)',
      call: () => fetch(origin + path, { headers }),
    },
  ];

  const results = [];
  for (const { mode, label: modeLabel, call } of modes) {
    const once = async () => {
      const start = performance.now();
      const res = await call();
      await res.text();
      if (!res.ok) throw new Error(`${path} a répondu ${res.status} en mode ${mode}`);
      return performance.now() - start;
    };

    for (let i = 0; i < WARMUP; i++) await once();
    const times = [];
    for (let i = 0; i < iterations; i++) times.push(await once());

    const totalMs = times.reduce((sum, time) => sum + time, 0);
    results.push({ mode, label: modeLabel, ...latencyStats(times), requestsPerSecond: Math.round(iterations / (totalMs / 1000)) });
  }

  return { target, label, path, iterations, results };
}
