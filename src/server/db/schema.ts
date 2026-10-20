import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  price: integer('price').notNull(), // centimes
  stock: integer('stock').notNull().default(0),
  image: text('image'),
  categoryId: integer('category_id').notNull().references(() => categories.id),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
});

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  status: text('status', { enum: ['pending', 'paid', 'shipped', 'cancelled'] }).notNull().default('pending'),
  total: integer('total').notNull(),
  stripeSessionId: text('stripe_session_id'), // session Stripe Checkout liée à la commande
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
});
