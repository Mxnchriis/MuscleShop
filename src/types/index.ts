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
  stock: number;
  image: string | null;
  categoryId: number;
}

export interface CartItem {
  productId: number;
  quantity: number;
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';

export interface Order {
  id: number;
  userId: number;
  status: OrderStatus;
  total: number; // en centimes
  createdAt: string;
}
