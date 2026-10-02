import type { APIRoute } from 'astro';
import app from '../../server/app';

export const prerender = false;

// Point de jonction Astro ↔ Hono : toute requête /api/* est déléguée à Hono
export const ALL: APIRoute = ({ request }) => app.fetch(request);
