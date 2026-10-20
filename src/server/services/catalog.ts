import { and, asc, count, desc, eq, getTableColumns, inArray, isNotNull, like, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, orderItems, orders, products } from '../db/schema';
import type { productSorts } from '../validators/products';

export interface ProductFilters {
  q?: string;
  category?: string;
  promo?: boolean;
  sort?: (typeof productSorts)[number];
  limit?: number;
}

// Quantités vendues par produit, sur les commandes réellement payées
const sales = db
  .select({ productId: orderItems.productId, sold: sql<number>`sum(${orderItems.quantity})`.as('sold') })
  .from(orderItems)
  .innerJoin(orders, eq(orderItems.orderId, orders.id))
  .where(inArray(orders.status, ['paid', 'shipped']))
  .groupBy(orderItems.productId)
  .as('sales');

const orderBy = {
  name: [asc(products.name)],
  // Les plus vendus d'abord ; à égalité (ou sans vente), ordre alphabétique
  'best-sellers': [desc(sql`coalesce(${sales.sold}, 0)`), asc(products.name)],
  newest: [desc(products.id)],
};

export function listProducts({ q, category, promo, sort = 'name', limit }: ProductFilters = {}) {
  const query = db
    .select(getTableColumns(products))
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(sales, eq(sales.productId, products.id))
    .where(
      and(
        q ? like(products.name, `%${q}%`) : undefined,
        category ? eq(categories.slug, category) : undefined,
        promo ? isNotNull(products.originalPrice) : undefined,
      ),
    )
    .orderBy(...orderBy[sort])
    .$dynamic();

  return (limit ? query.limit(limit) : query).all();
}

export function getProductBySlug(slug: string) {
  return db.select().from(products).where(eq(products.slug, slug)).get();
}

export function getProductById(id: number) {
  return db.select().from(products).where(eq(products.id, id)).get();
}

// Catégories dans l'ordre du seed, avec leur nombre de produits
export function listCategories() {
  return db
    .select({ ...getTableColumns(categories), productCount: count(products.id) })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(categories.id)
    .all();
}

export function getCategoryBySlug(slug: string) {
  return db.select().from(categories).where(eq(categories.slug, slug)).get();
}
