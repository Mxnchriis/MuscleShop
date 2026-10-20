import Stripe from 'stripe';
import { env } from '../env';
// Seul fichier qui parle à Stripe : facile à remplacer (ou à simuler dans les tests)
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export interface CheckoutItem {
  name: string;
  unitPrice: number; // en centimes, comme Stripe l'attend
  quantity: number;
}

interface CheckoutInput {
  orderId: number;
  email: string;
  items: CheckoutItem[];
  successUrl: string;
  cancelUrl: string;
}

// Crée la page de paiement hébergée par Stripe (Checkout) et renvoie son URL
export async function createCheckoutSession({ orderId, email, items, successUrl, cancelUrl }: CheckoutInput) {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: 'eur',
        unit_amount: item.unitPrice,
        product_data: { name: item.name },
      },
    })),
    metadata: { orderId: String(orderId) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { id: session.id, url: session.url! };
}

export async function getCheckoutStatus(sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return { paid: session.payment_status === 'paid', expired: session.status === 'expired' };
}

// Ferme la page de paiement si elle est encore ouverte (commande annulée)
export async function expireCheckoutSession(sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId);
}
