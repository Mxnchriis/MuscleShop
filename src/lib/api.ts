import { hc } from 'hono/client';
import type { AppType } from '../server/app';

// Client RPC typé : api.api.products.$get(), etc.
// Côté serveur (pages Astro), on transmet les cookies du visiteur (panier, session) à l'API.
export const createApi = (request: Request) =>
  hc<AppType>(new URL(request.url).origin, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  });
