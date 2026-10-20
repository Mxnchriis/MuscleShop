import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { orderItems, orders, products } from '../db/schema';
import { expireCheckoutSession, getCheckoutStatus } from './payment';
import type { Cart } from '../../types';

// Commande "pending" : prix figés dans order_items, stock inchangé tant que le paiement n'est pas confirmé
export function createOrder(userId: number, cart: Cart) {
  return db.transaction((tx) => {
    const order = tx.insert(orders).values({ userId, total: cart.total }).returning().get();
    tx.insert(orderItems)
      .values(
        cart.lines.map((line) => ({
          orderId: order.id,
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.product.price,
        })),
      )
      .run();
    return order;
  });
}

export function attachCheckoutSession(orderId: number, sessionId: string) {
  db.update(orders).set({ stripeSessionId: sessionId }).where(eq(orders.id, orderId)).run();
}

// Passe la commande en "paid" et décrémente le stock, une seule fois même si appelé plusieurs fois
function markOrderPaid(orderId: number) {
  db.transaction((tx) => {
    const { changes } = tx
      .update(orders)
      .set({ status: 'paid' })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
      .run();
    if (changes === 0) return; // déjà traitée

    const items = tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
    for (const item of items) {
      // Le paiement est déjà encaissé : on ne bloque pas, on borne le stock à 0
      tx.update(products)
        .set({ stock: sql`max(${products.stock} - ${item.quantity}, 0)` })
        .where(eq(products.id, item.productId))
        .run();
    }
  });
}

function setStatus(orderId: number, status: 'cancelled') {
  db.update(orders).set({ status }).where(and(eq(orders.id, orderId), eq(orders.status, 'pending'))).run();
}

export function listOrders(userId: number) {
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.id)).all();
}

function findOrder(userId: number, orderId: number) {
  return db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).get();
}

// Ne renvoie la commande que si elle appartient à l'utilisateur.
// Si elle est en attente, on demande à Stripe où en est le paiement.
export async function getOrder(userId: number, orderId: number) {
  let order = findOrder(userId, orderId);
  if (!order) return undefined;

  if (order.status === 'pending' && order.stripeSessionId) {
    const { paid, expired } = await getCheckoutStatus(order.stripeSessionId);
    if (paid) markOrderPaid(order.id);
    else if (expired) setStatus(order.id, 'cancelled');
    order = findOrder(userId, orderId)!;
  }

  const items = db
    .select({ name: products.name, slug: products.slug, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, order.id))
    .all();

  return { ...order, items };
}

export async function cancelOrder(userId: number, orderId: number) {
  const order = findOrder(userId, orderId);
  if (!order || order.status !== 'pending') return order;
  if (order.stripeSessionId) await expireCheckoutSession(order.stripeSessionId);
  setStatus(order.id, 'cancelled');
  return findOrder(userId, orderId);
}
