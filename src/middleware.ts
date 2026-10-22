import { defineMiddleware } from 'astro:middleware';
import { getSessionUser, SESSION_COOKIE } from './server/services/auth';
import { CART_COOKIE, cartCount, parseCart } from './server/services/cart';
import { recordAstroOverhead, recordMetric, wallTime } from './server/services/metrics';
import { BENCHMARK_HEADER, isPerfPanelPath } from './server/middlewares/metrics';
import { loginUrl } from './lib/redirect';

// Durée annoncée par Hono dans l'en-tête Server-Timing (voir src/server/middlewares/metrics.ts)
function honoDuration(serverTiming: string | null) {
  const match = serverTiming?.match(/hono;[^,]*dur=([\d.]+)/);
  return match ? Number(match[1]) : null;
}

// Middleware Astro : s'exécute avant chaque requête reçue par le serveur
export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, locals, request, url, routePattern } = context;
  const start = performance.now();
  const isBenchmark = request.headers.has(BENCHMARK_HEADER);

  // /api/* : Hono gère sa session lui-même. On mesure seulement ce qu'Astro ajoute
  // autour de Hono (middleware + route attrape-tout) : durée totale − durée Hono.
  if (url.pathname.startsWith('/api/')) {
    const response = await next();
    const honoMs = honoDuration(response.headers.get('server-timing'));
    if (honoMs !== null && !isBenchmark && !isPerfPanelPath(url.pathname)) {
      recordAstroOverhead(performance.now() - start - honoMs);
    }
    return response;
  }

  // Pages : utilisateur connecté et taille du panier pour toutes les pages (header, pages protégées)
  locals.user = await getSessionUser(cookies.get(SESSION_COOKIE)?.value);
  locals.cartCount = cartCount(parseCart(cookies.get(CART_COOKIE)?.value));
  locals.perf = { apiCalls: 0, intervals: [] };

  // Espace admin : connexion obligatoire, rôle admin obligatoire
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    if (!locals.user) return context.redirect(loginUrl(url));
    if (locals.user.role !== 'admin') return new Response('Accès réservé aux administrateurs', { status: 403 });
  }

  const response = await next();

  // Répartition du temps de la page : appels Hono internes (src/lib/api.ts) / reste = Astro
  const durationMs = performance.now() - start;
  const apiMs = wallTime(locals.perf.intervals);
  try {
    response.headers.append(
      'Server-Timing',
      `astro;desc="Astro (hors appels API)";dur=${(durationMs - apiMs).toFixed(2)}, api;desc="Hono (appels internes)";dur=${apiMs.toFixed(2)}`,
    );
  } catch {
    // en-têtes non modifiables (ex. redirection) : on garde juste la mesure
  }

  if (!isBenchmark) {
    recordMetric({
      source: 'page',
      method: request.method,
      route: routePattern,
      path: url.pathname,
      status: response.status,
      durationMs,
      apiCalls: locals.perf.apiCalls,
      apiMs,
    });
  }
  return response;
});
