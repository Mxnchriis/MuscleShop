import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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

// Associe une (nouvelle) session Stripe à la commande et la remet en attente de paiement
export function attachCheckoutSession(orderId: number, sessionId: string) {
  db.update(orders).set({ stripeSessionId: sessionId, status: 'pending' }).where(eq(orders.id, orderId)).run();
}

// Lignes d'une commande au prix figé lors de la commande, avec le stock actuel du produit
function orderLines(orderId: number) {
  return db
    .select({
      name: products.name,
      stock: products.stock,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
    })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId))
    .all();
}

// Action impossible vu le statut de la commande (déjà payée, stock épuisé…) : renvoyée en 409
export class OrderStateError extends Error {}

// Prépare le paiement d'une commande en attente.
// L'ancienne session Stripe est fermée pour éviter de payer deux fois la même commande.
export async function prepareRepayment(userId: number, orderId: number) {
  const order = await getOrder(userId, orderId); // synchronise d'abord le statut avec Stripe
  if (!order) return undefined;
  if (order.status === 'cancelled') throw new OrderStateError('Commande annulée : utilisez « Recommander »');
  if (order.status !== 'pending') throw new OrderStateError('Cette commande a déjà été payée');

  const lines = orderLines(order.id);
  const missing = lines.find((line) => line.quantity > line.stock);
  if (missing) throw new OrderStateError(`Stock insuffisant pour ${missing.name}`);

  if (order.stripeSessionId) await expireCheckoutSession(order.stripeSessionId);
  return { order, items: lines.map(({ name, unitPrice, quantity }) => ({ name, unitPrice, quantity })) };
}

// Panier reconstitué à partir d'une commande payée, expédiée ou annulée, aux prix et stock actuels,
// pour créer une nouvelle commande (l'ancienne reste inchangée dans l'historique).
// Une commande en attente se paie : elle ne se recommande pas.
export function cartFromOrder(userId: number, orderId: number): Cart | undefined {
  const order = findOrder(userId, orderId);
  if (!order) return undefined;
  if (order.status === 'pending') throw new OrderStateError('Cette commande est en attente : utilisez « Payer »');

  const lines = db
    .select({ product: products, quantity: orderItems.quantity })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, order.id))
    .all()
    .map(({ product, quantity }) => ({ product, quantity, subtotal: product.price * quantity }));

  const missing = lines.find((line) => line.quantity > line.product.stock);
  if (missing) throw new OrderStateError(`Stock insuffisant pour ${missing.product.name}`);

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.subtotal, 0),
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
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

// Commandes de l'utilisateur avec leurs produits (2 requêtes, quel que soit le nombre de commandes)
export function listOrders(userId: number) {
  const list = db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.id)).all();
  if (list.length === 0) return [];

  const items = db
    .select({ orderId: orderItems.orderId, name: products.name, quantity: orderItems.quantity })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(inArray(orderItems.orderId, list.map((order) => order.id)))
    .all();

  return list.map((order) => ({
    ...order,
    items: items.filter((item) => item.orderId === order.id).map(({ name, quantity }) => ({ name, quantity })),
  }));
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

// Annule une commande non payée. Le statut est d'abord synchronisé avec Stripe :
// une commande payée entre-temps ne peut plus être annulée.
export async function cancelOrder(userId: number, orderId: number) {
  const order = await getOrder(userId, orderId);
  if (!order) return undefined;
  if (order.status === 'cancelled') return order;
  if (order.status !== 'pending') throw new OrderStateError('Cette commande a déjà été payée : elle ne peut plus être annulée');

  if (order.stripeSessionId) await expireCheckoutSession(order.stripeSessionId);
  setStatus(order.id, 'cancelled');
  return findOrder(userId, orderId);
}
