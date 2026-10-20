import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { cartItemBody } from '../validators/cart';
import { CART_COOKIE, CART_MAX_AGE, getCartDetails, parseCart, quantityOf, serializeCart, setQuantity } from '../services/cart';
import { getProductById } from '../services/catalog';
import { env } from '../env';
import type { CartItem } from '../../types';

const readCart = (c: Context) => parseCart(getCookie(c, CART_COOKIE));

function saveCart(c: Context, items: CartItem[]) {
  setCookie(c, CART_COOKIE, serializeCart(items), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.isProd,
    path: '/',
    maxAge: CART_MAX_AGE,
  });
  return getCartDetails(items);
}

function checkStock(productId: number, quantity: number) {
  const product = getProductById(productId);
  if (!product) throw new HTTPException(404, { message: 'Produit introuvable' });
  if (quantity > product.stock) throw new HTTPException(409, { message: `Stock insuffisant (${product.stock} disponibles)` });
}

export const cart = new Hono()
  .get('/', (c) => c.json(getCartDetails(readCart(c))))
  .post('/items', zValidator('json', cartItemBody), (c) => {
    const { productId, quantity } = c.req.valid('json');
    const items = readCart(c);
    const newQuantity = quantityOf(items, productId) + quantity;
    checkStock(productId, newQuantity);
    return c.json(saveCart(c, setQuantity(items, productId, newQuantity)), 201);
  })
  .patch('/items/:productId', zValidator('json', cartItemBody.pick({ quantity: true })), (c) => {
    const productId = Number(c.req.param('productId'));
    const { quantity } = c.req.valid('json');
    checkStock(productId, quantity);
    return c.json(saveCart(c, setQuantity(readCart(c), productId, quantity)));
  })
  .delete('/items/:productId', (c) => {
    const productId = Number(c.req.param('productId'));
    return c.json(saveCart(c, setQuantity(readCart(c), productId, 0)));
  });
