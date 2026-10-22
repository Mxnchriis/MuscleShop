// Métriques de performance en mémoire, alimentées par DEUX middlewares :
// - le middleware Hono (src/server/middlewares/metrics.ts) : chaque appel d'API ;
// - le middleware Astro (src/middleware.ts) : chaque page rendue, et le surcoût Astro sur /api.
// Astro et Hono tournent dans le même processus : ils partagent ce module, donc les mêmes données.

export type MetricSource = 'page' | 'api-http' | 'api-internal';

export interface MetricEntry {
  at: number; // horodatage (ms)
  source: MetricSource;
  method: string;
  route: string; // gabarit : /produits/[slug] (Astro) ou /api/products/:slug (Hono)
  path: string; // URL réelle
  status: number;
  durationMs: number;
  // Pages uniquement : appels Hono internes faits pendant le rendu
  apiCalls?: number;
  apiMs?: number; // temps « horloge » passé dans Hono (appels parallèles fusionnés)
}

const CAPACITY = 10_000;
const OVERHEAD_CAPACITY = 2_000;

let entries: MetricEntry[] = [];
let astroOverhead: number[] = []; // ms ajoutées par Astro (route attrape-tout + middleware) sur /api
let startedAt = Date.now();

export function recordMetric(entry: Omit<MetricEntry, 'at'>) {
  entries.push({ ...entry, at: Date.now() });
  if (entries.length > CAPACITY) entries = entries.slice(-CAPACITY);
}

export function recordAstroOverhead(ms: number) {
  astroOverhead.push(ms);
  if (astroOverhead.length > OVERHEAD_CAPACITY) astroOverhead = astroOverhead.slice(-OVERHEAD_CAPACITY);
}

export function resetMetrics() {
  entries = [];
  astroOverhead = [];
  startedAt = Date.now();
}

// --- Calculs ---

const round = (value: number) => Math.round(value * 100) / 100;

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function latencyStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    avg: round(sorted.length ? sum / sorted.length : 0),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1) ?? 0),
  };
}

const sources: MetricSource[] = ['page', 'api-http', 'api-internal'];

export function getMetricsReport(windowMinutes = 30) {
  const now = Date.now();
  const since = now - windowMinutes * 60_000;
  const recent = entries.filter((entry) => entry.at >= since);
  const durations = (list: MetricEntry[]) => list.map((entry) => entry.durationMs);

  // Par route (source + méthode + gabarit)
  const groups = new Map<string, MetricEntry[]>();
  for (const entry of recent) {
    const key = `${entry.source} ${entry.method} ${entry.route}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const routes = [...groups.values()]
    .map((list) => {
      const pages = list.filter((entry) => entry.apiCalls !== undefined);
      const avg = (values: number[]) => round(values.reduce((a, b) => a + b, 0) / (values.length || 1));
      return {
        source: list[0].source,
        method: list[0].method,
        route: list[0].route,
        ...latencyStats(durations(list)),
        errors: list.filter((entry) => entry.status >= 500).length,
        clientErrors: list.filter((entry) => entry.status >= 400 && entry.status < 500).length,
        // Pages : répartition Hono / Astro
        avgApiCalls: pages.length ? avg(pages.map((entry) => entry.apiCalls!)) : null,
        avgApiMs: pages.length ? avg(pages.map((entry) => entry.apiMs!)) : null,
        avgRenderMs: pages.length ? avg(pages.map((entry) => entry.durationMs - entry.apiMs!)) : null,
      };
    })
    .sort((a, b) => b.count - a.count);

  // Une case par minute sur la fenêtre : nombre de requêtes et p95 par source
  const timeline = Array.from({ length: windowMinutes }, (_, index) => {
    const start = Math.floor(since / 60_000) * 60_000 + (index + 1) * 60_000;
    const inMinute = recent.filter((entry) => entry.at >= start && entry.at < start + 60_000);
    return {
      minute: start,
      counts: Object.fromEntries(sources.map((source) => [source, inMinute.filter((e) => e.source === source).length])),
      // null : aucune requête dans la minute (un trou dans la courbe, pas « 0 ms »)
      p95Page: p95OrNull(inMinute.filter((e) => e.source === 'page')),
      p95Api: p95OrNull(inMinute.filter((e) => e.source !== 'page')),
    };
  });

  const lastMinute = recent.filter((entry) => entry.at >= now - 60_000);

  return {
    windowMinutes,
    collectingSince: startedAt,
    stored: entries.length,
    capacity: CAPACITY,
    summary: {
      ...latencyStats(durations(recent)),
      requestsLastMinute: lastMinute.length,
      errorRate: round(recent.length ? (recent.filter((e) => e.status >= 500).length / recent.length) * 100 : 0),
      bySource: Object.fromEntries(
        sources.map((source) => [source, latencyStats(durations(recent.filter((e) => e.source === source)))]),
      ) as Record<MetricSource, ReturnType<typeof latencyStats>>,
      statusClasses: {
        '2xx': recent.filter((e) => e.status < 300).length,
        '3xx': recent.filter((e) => e.status >= 300 && e.status < 400).length,
        '4xx': recent.filter((e) => e.status >= 400 && e.status < 500).length,
        '5xx': recent.filter((e) => e.status >= 500).length,
      },
    },
    astroOverhead: latencyStats(astroOverhead),
    routes,
    timeline,
    slowest: [...recent].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10).map(roundEntry),
    latest: recent.slice(-15).reverse().map(roundEntry),
  };
}

function p95OrNull(list: MetricEntry[]) {
  return list.length ? latencyStats(list.map((entry) => entry.durationMs)).p95 : null;
}

function roundEntry(entry: MetricEntry) {
  return { ...entry, durationMs: round(entry.durationMs), apiMs: entry.apiMs === undefined ? undefined : round(entry.apiMs) };
}

// Durée « horloge » couverte par des intervalles qui peuvent se chevaucher (appels en parallèle)
export function wallTime(intervals: [number, number][]) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0] ?? [0, 0];
  for (const [from, to] of sorted.slice(1)) {
    if (from > end) {
      total += end - start;
      [start, end] = [from, to];
    } else {
      end = Math.max(end, to);
    }
  }
  return total + (end - start);
}
