import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { products } from '../db/schema';
import { cartItemBody } from '../validators/cart';
import type { Cart, CartItem } from '../../types';

// Le panier vit dans un cookie : pas besoin d'être connecté pour le remplir
export const CART_COOKIE = 'cart';
export const CART_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

const storedCart = z.array(cartItemBody);

// Un cookie modifié à la main ou corrompu donne simplement un panier vide
export function parseCart(raw: string | undefined): CartItem[] {
  if (!raw) return [];
  try {
    return storedCart.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeCart(items: CartItem[]) {
  return JSON.stringify(items);
}

export function cartCount(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function setQuantity(items: CartItem[], productId: number, quantity: number): CartItem[] {
  const others = items.filter((item) => item.productId !== productId);
  return quantity > 0 ? [...others, { productId, quantity }] : others;
}

export function quantityOf(items: CartItem[], productId: number) {
  return items.find((item) => item.productId === productId)?.quantity ?? 0;
}

// Prix et stock relus en base : on ne fait jamais confiance au prix envoyé par le client
export function getCartDetails(items: CartItem[]): Cart {
  const ids = items.map((item) => item.productId);
  const rows = ids.length ? db.select().from(products).where(inArray(products.id, ids)).all() : [];

  const lines = items.flatMap((item) => {
    const product = rows.find((row) => row.id === item.productId);
    return product ? [{ product, quantity: item.quantity, subtotal: product.price * item.quantity }] : [];
  });

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.subtotal, 0),
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}
