import { defineMiddleware } from 'astro:middleware';
import { readSessionToken, SESSION_COOKIE } from './server/services/auth';
import { CART_COOKIE, cartCount, parseCart } from './server/services/cart';

// Middleware Astro : rend l'utilisateur connecté et la taille du panier disponibles
// dans toutes les pages via Astro.locals (header, pages protégées)
export const onRequest = defineMiddleware(async ({ cookies, locals }, next) => {
  locals.user = await readSessionToken(cookies.get(SESSION_COOKIE)?.value);
  locals.cartCount = cartCount(parseCart(cookies.get(CART_COOKIE)?.value));
  return next();
});
