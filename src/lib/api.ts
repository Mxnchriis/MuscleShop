import { hc } from 'hono/client';
import app, { type AppType } from '../server/app';

// Client RPC typé pour les pages Astro (côté serveur uniquement : ce fichier importe l'app Hono).
// - fetch → app.request : l'appel reste dans le processus, sans aller-retour réseau.
//   Si l'API devient un service séparé, il suffit de retirer cette ligne : le reste ne change pas.
// - cookie : on transmet le panier et la session du visiteur à l'API.
export const createApi = (request: Request) =>
  hc<AppType>(new URL(request.url).origin, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
    headers: { cookie: request.headers.get('cookie') ?? '' },
  });
