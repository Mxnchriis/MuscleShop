import Stripe from 'stripe';
import { env } from '../env';
import type { CartLine } from '../../types';

// Seul fichier qui parle à Stripe : facile à remplacer (ou à simuler dans les tests)
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

interface CheckoutInput {
  orderId: number;
  email: string;
  lines: CartLine[];
  origin: string; // ex. http://localhost:4321, pour construire les URLs de retour
}

// Crée la page de paiement hébergée par Stripe (Checkout) et renvoie son URL
export async function createCheckoutSession({ orderId, email, lines, origin }: CheckoutInput) {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: 'eur',
        unit_amount: line.product.price, // déjà en centimes, comme Stripe l'attend
        product_data: { name: line.product.name },
      },
    })),
    metadata: { orderId: String(orderId) },
    success_url: `${origin}/commande/confirmation?id=${orderId}`,
    cancel_url: `${origin}/commande/annulee?id=${orderId}`,
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
