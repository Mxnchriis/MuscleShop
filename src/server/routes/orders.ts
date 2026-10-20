import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middlewares/auth';
import { CART_COOKIE, getCartDetails, parseCart } from '../services/cart';
import { attachCheckoutSession, cancelOrder, createOrder, getOrder, listOrders } from '../services/orders';
import { createCheckoutSession } from '../services/payment';

export const orders = new Hono()
  .use(requireAuth)
  .get('/', (c) => c.json({ items: listOrders(c.get('user').id) }))
  // Crée la commande puis la session de paiement Stripe ; le front redirige vers checkoutUrl.
  // Le panier est conservé : il n'est vidé qu'une fois le paiement confirmé.
  .post('/', async (c) => {
    const user = c.get('user');
    const cart = getCartDetails(parseCart(getCookie(c, CART_COOKIE)));
    if (cart.lines.length === 0) throw new HTTPException(400, { message: 'Le panier est vide' });

    const missing = cart.lines.find((line) => line.quantity > line.product.stock);
    if (missing) throw new HTTPException(409, { message: `Stock insuffisant pour ${missing.product.name}` });

    const order = createOrder(user.id, cart);
    const checkout = await createCheckoutSession({
      orderId: order.id,
      email: user.email,
      lines: cart.lines,
      origin: new URL(c.req.url).origin,
    });
    attachCheckoutSession(order.id, checkout.id);

    return c.json({ id: order.id, checkoutUrl: checkout.url }, 201);
  })
  .get('/:id', async (c) => {
    const order = await getOrder(c.get('user').id, Number(c.req.param('id')));
    if (!order) throw new HTTPException(404, { message: 'Commande introuvable' });
    return c.json(order);
  })
  .post('/:id/cancel', async (c) => {
    const order = await cancelOrder(c.get('user').id, Number(c.req.param('id')));
    if (!order) throw new HTTPException(404, { message: 'Commande introuvable' });
    return c.json(order);
  });
