export interface Category {
  id: number;
  slug: string;
  name: string;
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  description: string;
  price: number; // en centimes
  originalPrice: number | null; // prix barré en centimes, null si pas de promo
  stock: number;
  image: string | null;
  categoryId: number;
}

export interface CartItem {
  productId: number;
  quantity: number;
}

export interface CartLine {
  product: Product;
  quantity: number;
  subtotal: number; // en centimes
}

export interface Cart {
  lines: CartLine[];
  total: number; // en centimes
  count: number; // nombre d'articles
}

// Contenu du JWT de session
export interface SessionUser {
  id: number;
  email: string;
  name: string;
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';

export interface Order {
  id: number;
  userId: number;
  status: OrderStatus;
  total: number; // en centimes
  createdAt: string;
}
