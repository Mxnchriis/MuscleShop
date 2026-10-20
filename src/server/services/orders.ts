import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { orderItems, orders, products } from '../db/schema';
import type { Cart } from '../../types';

export class OutOfStockError extends Error {}

// Tout ou rien : la commande, ses lignes et la baisse du stock sont dans une même transaction
export function createOrder(userId: number, cart: Cart) {
  return db.transaction((tx) => {
    const order = tx.insert(orders).values({ userId, total: cart.total }).returning().get();

    for (const line of cart.lines) {
      const { changes } = tx
        .update(products)
        .set({ stock: sql`${products.stock} - ${line.quantity}` })
        .where(and(eq(products.id, line.product.id), gte(products.stock, line.quantity)))
        .run();
      if (changes === 0) throw new OutOfStockError(`Stock insuffisant pour ${line.product.name}`);

      tx.insert(orderItems)
        .values({ orderId: order.id, productId: line.product.id, quantity: line.quantity, unitPrice: line.product.price })
        .run();
    }

    return order;
  });
}

export function listOrders(userId: number) {
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.id)).all();
}

// Ne renvoie la commande que si elle appartient à l'utilisateur
export function getOrder(userId: number, orderId: number) {
  const order = db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).get();
  if (!order) return undefined;

  const items = db
    .select({ name: products.name, slug: products.slug, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, order.id))
    .all();

  return { ...order, items };
}
