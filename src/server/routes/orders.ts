import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middlewares/auth';
import { CART_COOKIE, getCartDetails, parseCart } from '../services/cart';
import {
  attachCheckoutSession,
  cancelOrder,
  cartFromOrder,
  createOrder,
  getOrder,
  listOrders,
  prepareRepayment,
} from '../services/orders';
import { createCheckoutSession } from '../services/payment';
import type { Cart, SessionUser } from '../../types';

// Crée une commande "pending" et sa session de paiement Stripe ; renvoie l'URL de paiement
async function checkoutNewOrder(user: SessionUser, cart: Cart, origin: string, fromCart: boolean) {
  const order = createOrder(user.id, cart);
  const checkout = await createCheckoutSession({
    orderId: order.id,
    email: user.email,
    items: cart.lines.map((line) => ({ name: line.product.name, unitPrice: line.product.price, quantity: line.quantity })),
    // source=cart : la confirmation videra le panier
    successUrl: `${origin}/commande/confirmation?id=${order.id}${fromCart ? '&source=cart' : ''}`,
    cancelUrl: fromCart ? `${origin}/commande/annulee?id=${order.id}` : `${origin}/compte/commandes`,
  });
  attachCheckoutSession(order.id, checkout.id);
  return { id: order.id, checkoutUrl: checkout.url };
}

export const orders = new Hono()
  .use(requireAuth)
  .get('/', (c) => c.json({ items: listOrders(c.get('user').id) }))
  // Commande à partir du panier ; le front redirige vers checkoutUrl.
  // Le panier est conservé : il n'est vidé qu'une fois le paiement confirmé.
  .post('/', async (c) => {
    const cart = getCartDetails(parseCart(getCookie(c, CART_COOKIE)));
    if (cart.lines.length === 0) throw new HTTPException(400, { message: 'Le panier est vide' });

    const missing = cart.lines.find((line) => line.quantity > line.product.stock);
    if (missing) throw new HTTPException(409, { message: `Stock insuffisant pour ${missing.product.name}` });

    return c.json(await checkoutNewOrder(c.get('user'), cart, new URL(c.req.url).origin, true), 201);
  })
  .get('/:id', async (c) => {
    const order = await getOrder(c.get('user').id, Number(c.req.param('id')));
    if (!order) throw new HTTPException(404, { message: 'Commande introuvable' });
    return c.json(order);
  })
  // Relance le paiement d'une commande en attente (depuis « Mes commandes »)
  .post('/:id/pay', async (c) => {
    const user = c.get('user');
    const repayment = await prepareRepayment(user.id, Number(c.req.param('id')));
    if (!repayment) throw new HTTPException(404, { message: 'Commande introuvable' });

    const { order, items } = repayment;
    const origin = new URL(c.req.url).origin;
    const checkout = await createCheckoutSession({
      orderId: order.id,
      email: user.email,
      items,
      successUrl: `${origin}/commande/confirmation?id=${order.id}`,
      cancelUrl: `${origin}/compte/commandes`,
    });
    attachCheckoutSession(order.id, checkout.id);

    return c.json({ id: order.id, checkoutUrl: checkout.url });
  })
  // Nouvelle commande avec les produits d'une commande payée, expédiée ou annulée (prix actuels)
  .post('/:id/reorder', async (c) => {
    const user = c.get('user');
    const cart = cartFromOrder(user.id, Number(c.req.param('id')));
    if (!cart) throw new HTTPException(404, { message: 'Commande introuvable' });

    return c.json(await checkoutNewOrder(user, cart, new URL(c.req.url).origin, false), 201);
  })
  // Annule une commande non payée (depuis « Mes commandes » ou au retour de Stripe)
  .post('/:id/cancel', async (c) => {
    const order = await cancelOrder(c.get('user').id, Number(c.req.param('id')));
    if (!order) throw new HTTPException(404, { message: 'Commande introuvable' });
    return c.json(order);
  });
