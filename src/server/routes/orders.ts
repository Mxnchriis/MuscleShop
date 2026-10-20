import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middlewares/auth';
import { CART_COOKIE, getCartDetails, parseCart } from '../services/cart';
import { createOrder, getOrder, listOrders, OutOfStockError } from '../services/orders';

export const orders = new Hono()
  .use(requireAuth)
  .get('/', (c) => c.json({ items: listOrders(c.get('user').id) }))
  .post('/', (c) => {
    const cart = getCartDetails(parseCart(getCookie(c, CART_COOKIE)));
    if (cart.lines.length === 0) throw new HTTPException(400, { message: 'Le panier est vide' });

    try {
      // TODO paiement : créer ici la session Stripe, puis passer la commande en "paid" via le webhook
      const order = createOrder(c.get('user').id, cart);
      deleteCookie(c, CART_COOKIE, { path: '/' });
      return c.json(order, 201);
    } catch (err) {
      if (err instanceof OutOfStockError) throw new HTTPException(409, { message: err.message });
      throw err;
    }
  })
  .get('/:id', (c) => {
    const order = getOrder(c.get('user').id, Number(c.req.param('id')));
    if (!order) throw new HTTPException(404, { message: 'Commande introuvable' });
    return c.json(order);
  });
