import { hc } from 'hono/client';
import app, { type AppType } from '../server/app';
import { BENCHMARK_HEADER, INTERNAL_CALL_HEADER } from '../server/middlewares/metrics';

// Client RPC typé pour les pages Astro (côté serveur uniquement : ce fichier importe l'app Hono).
// Usage dans une page : const api = createApi(Astro);
// - fetch → app.request : l'appel reste dans le processus, sans aller-retour réseau.
//   Si l'API devient un service séparé, il suffit de remplacer ce fetch : le reste ne change pas.
// - cookie : on transmet le panier et la session du visiteur à l'API.
// - chaque appel est chronométré dans Astro.locals.perf (temps Hono vs temps Astro de la page).
// - une page chargée par le benchmark transmet son marqueur : ses appels internes ne sont pas comptés.
export const createApi = ({ request, locals }: { request: Request; locals: App.Locals }) =>
  hc<AppType>(new URL(request.url).origin, {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const start = performance.now();
      try {
        return await app.request(input, init);
      } finally {
        locals.perf?.intervals.push([start, performance.now()]);
        if (locals.perf) locals.perf.apiCalls++;
      }
    },
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      [INTERNAL_CALL_HEADER]: '1',
      ...(request.headers.has(BENCHMARK_HEADER) ? { [BENCHMARK_HEADER]: '1' } : {}),
    },
  });
