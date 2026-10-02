import type { CartItem, Product } from '../../types';

export function cartTotal(items: CartItem[], products: Product[]): number {
  return items.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
}
