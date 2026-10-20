import { and, eq, getTableColumns, like } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, products } from '../db/schema';

export interface ProductFilters {
  q?: string;
  category?: string;
}

export function listProducts({ q, category }: ProductFilters = {}) {
  return db
    .select(getTableColumns(products))
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        q ? like(products.name, `%${q}%`) : undefined,
        category ? eq(categories.slug, category) : undefined,
      ),
    )
    .orderBy(products.name)
    .all();
}

export function getProductBySlug(slug: string) {
  return db.select().from(products).where(eq(products.slug, slug)).get();
}

export function getProductById(id: number) {
  return db.select().from(products).where(eq(products.id, id)).get();
}

export function listCategories() {
  return db.select().from(categories).orderBy(categories.name).all();
}

export function getCategoryBySlug(slug: string) {
  return db.select().from(categories).where(eq(categories.slug, slug)).get();
}
