import { and, asc, count, desc, eq, getTableColumns, gte, inArray, like, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, orderItems, orders, products, users } from '../db/schema';
import { OrderStateError, withItems } from './orders';
import type { OrderStatus } from '../../types';

export const LOW_STOCK_THRESHOLD = 10;
const SALES_DAYS = 14;

// Commandes qui comptent dans le chiffre d'affaires
const PAID_STATUSES: OrderStatus[] = ['paid', 'shipped'];

// Quantités vendues par produit (commandes payées ou expédiées)
const sales = db
  .select({
    productId: orderItems.productId,
    sold: sql<number>`sum(${orderItems.quantity})`.as('sold'),
    revenue: sql<number>`sum(${orderItems.quantity} * ${orderItems.unitPrice})`.as('revenue'),
  })
  .from(orderItems)
  .innerJoin(orders, eq(orderItems.orderId, orders.id))
  .where(inArray(orders.status, PAID_STATUSES))
  .groupBy(orderItems.productId)
  .as('sales');

export function getDashboard() {
  const revenue = db
    .select({ total: sql<number>`coalesce(sum(${orders.total}), 0)`, count: count() })
    .from(orders)
    .where(inArray(orders.status, PAID_STATUSES))
    .get()!;

  const byStatus = Object.fromEntries(
    db.select({ status: orders.status, count: count() }).from(orders).groupBy(orders.status).all().map((row) => [row.status, row.count]),
  ) as Partial<Record<OrderStatus, number>>;

  const stock = db
    .select({
      products: count(),
      outOfStock: sql<number>`coalesce(sum(case when ${products.stock} = 0 then 1 else 0 end), 0)`,
      lowStock: sql<number>`coalesce(sum(case when ${products.stock} > 0 and ${products.stock} <= ${LOW_STOCK_THRESHOLD} then 1 else 0 end), 0)`,
      units: sql<number>`coalesce(sum(${products.stock}), 0)`,
    })
    .from(products)
    .get()!;

  return {
    revenue: revenue.total,
    paidOrders: revenue.count,
    averageBasket: revenue.count ? Math.round(revenue.total / revenue.count) : 0,
    ordersByStatus: byStatus,
    customers: db.select({ n: count() }).from(users).where(eq(users.role, 'customer')).get()!.n,
    stock,
    salesByDay: salesByDay(),
    topProducts: db
      .select({ id: products.id, name: products.name, slug: products.slug, sold: sales.sold, revenue: sales.revenue })
      .from(sales)
      .innerJoin(products, eq(sales.productId, products.id))
      .orderBy(desc(sales.sold))
      .limit(5)
      .all(),
    recentOrders: listAdminOrders({ limit: 5 }),
  };
}

// Chiffre d'affaires et nombre de commandes payées par jour (UTC), jours sans vente inclus
function salesByDay() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (SALES_DAYS - 1));

  const day = sql<string>`substr(${orders.createdAt}, 1, 10)`;
  const rows = db
    .select({ day, revenue: sql<number>`sum(${orders.total})`, orders: count() })
    .from(orders)
    .where(and(inArray(orders.status, PAID_STATUSES), gte(orders.createdAt, start.toISOString())))
    .groupBy(day)
    .all();

  return Array.from({ length: SALES_DAYS }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const row = rows.find((r) => r.day === key);
    return { day: key, revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 };
  });
}

// Tous les produits, du stock le plus faible au plus élevé, avec les ventes
export function listStock() {
  return db
    .select({
      ...getTableColumns(products),
      categoryName: categories.name,
      sold: sql<number>`coalesce(${sales.sold}, 0)`,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(sales, eq(sales.productId, products.id))
    .orderBy(asc(products.stock), asc(products.name))
    .all();
}

export function updateStock(productId: number, stock: number) {
  return db.update(products).set({ stock }).where(eq(products.id, productId)).returning().get();
}

// Historique de toutes les commandes, avec le client et les produits
export function listAdminOrders({ status, q, limit = 200 }: { status?: OrderStatus; q?: string; limit?: number }) {
  const search = q
    ? or(like(users.email, `%${q}%`), like(users.name, `%${q}%`), /^\d+$/.test(q) ? eq(orders.id, Number(q)) : undefined)
    : undefined;

  return withItems(
    db
      .select({
        id: orders.id,
        status: orders.status,
        total: orders.total,
        createdAt: orders.createdAt,
        customerName: users.name,
        customerEmail: users.email,
      })
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id))
      .where(and(status ? eq(orders.status, status) : undefined, search))
      .orderBy(desc(orders.id))
      .limit(limit)
      .all(),
  );
}

// Payée → expédiée. Toute autre transition est refusée (409).
export function shipOrder(orderId: number) {
  const updated = db
    .update(orders)
    .set({ status: 'shipped' })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'paid')))
    .returning()
    .get();
  if (updated) return updated;

  const existing = db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).get();
  if (!existing) return undefined;
  throw new OrderStateError('Seule une commande payée peut être marquée comme expédiée');
}
