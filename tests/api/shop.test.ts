import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/server/app';

// Stripe simulé : pas d'appel réseau, et on choisit le résultat du paiement dans chaque test
const stripe = vi.hoisted(() => ({ paid: false, expired: false, expiredSessions: [] as string[] }));
vi.mock('../../src/server/services/payment', () => ({
  createCheckoutSession: async ({ orderId }: { orderId: number }) => ({
    id: `cs_test_${orderId}`,
    url: `https://checkout.stripe.com/c/pay/cs_test_${orderId}`,
  }),
  getCheckoutStatus: async () => ({ paid: stripe.paid, expired: stripe.expired }),
  expireCheckoutSession: async (id: string) => void stripe.expiredSessions.push(id),
}));

// Simule un navigateur : renvoie les cookies reçus à chaque requête
function createClient() {
  const jar = new Map<string, string>();
  return async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, value] = pair.split('=');
      if (header.includes('Max-Age=0')) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
}

const credentials = { email: `test-${Date.now()}@muscleshop.fr`, password: 'motdepasse', name: 'Testeur' };

describe('Panier', () => {
  it('ajoute un produit et cumule les quantités', async () => {
    const request = createClient();
    await request('/api/cart/items', { method: 'POST', body: { productId: 1, quantity: 1 } });
    const res = await request('/api/cart/items', { method: 'POST', body: { productId: 1, quantity: 2 } });
    expect(res.status).toBe(201);
    const cart = await res.json();
    expect(cart.count).toBe(3);
    expect(cart.total).toBe(cart.lines[0].product.price * 3);
  });

  it('refuse un produit inconnu et une quantité au-delà du stock', async () => {
    const request = createClient();
    expect((await request('/api/cart/items', { method: 'POST', body: { productId: 999, quantity: 1 } })).status).toBe(404);
    expect((await request('/api/cart/items', { method: 'POST', body: { productId: 1, quantity: 10_000 } })).status).toBe(409);
  });

  it('ignore un cookie de panier falsifié', async () => {
    const res = await app.request('/api/cart', { headers: { cookie: 'cart=pas-du-json' } });
    expect((await res.json()).count).toBe(0);
  });
});

describe('Authentification', () => {
  it("inscription, puis refus d'un email déjà utilisé", async () => {
    const request = createClient();
    expect((await request('/api/auth/register', { method: 'POST', body: credentials })).status).toBe(201);
    expect((await request('/api/auth/register', { method: 'POST', body: credentials })).status).toBe(409);
  });

  it('connexion avec le bon mot de passe uniquement', async () => {
    const request = createClient();
    const wrong = await request('/api/auth/login', { method: 'POST', body: { ...credentials, password: 'mauvaismdp' } });
    expect(wrong.status).toBe(401);
    expect((await request('/api/auth/me')).status).toBe(401);

    await request('/api/auth/login', { method: 'POST', body: credentials });
    expect(await (await request('/api/auth/me')).json()).toMatchObject({ email: credentials.email });
  });

  it('rejette un JWT falsifié', async () => {
    const res = await app.request('/api/auth/me', { headers: { cookie: 'session=eyJhbGciOiJIUzI1NiJ9.e30.faux' } });
    expect(res.status).toBe(401);
  });
});

describe('Commande', () => {
  beforeEach(() => Object.assign(stripe, { paid: false, expired: false, expiredSessions: [] }));

  const stockOf = async (request: ReturnType<typeof createClient>) =>
    (await (await request('/api/products/creatine-monohydrate-300g')).json()).stock as number;

  // Utilisateur connecté avec 2 créatines dans le panier, commande créée
  async function checkout() {
    const request = createClient();
    await request('/api/auth/login', { method: 'POST', body: credentials });
    await request('/api/cart/items', { method: 'POST', body: { productId: 2, quantity: 2 } });
    const res = await request('/api/orders', { method: 'POST' });
    return { request, res, order: await res.json() };
  }

  it('exige une connexion', async () => {
    const request = createClient();
    await request('/api/cart/items', { method: 'POST', body: { productId: 2, quantity: 1 } });
    expect((await request('/api/orders', { method: 'POST' })).status).toBe(401);
  });

  it('refuse une commande avec un panier vide', async () => {
    const request = createClient();
    await request('/api/auth/login', { method: 'POST', body: credentials });
    expect((await request('/api/orders', { method: 'POST' })).status).toBe(400);
  });

  it('renvoie une URL Stripe sans toucher au stock ni au panier', async () => {
    const before = await stockOf(createClient());
    const { request, res, order } = await checkout();

    expect(res.status).toBe(201);
    expect(order.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(await stockOf(request)).toBe(before);
    expect((await (await request('/api/cart')).json()).count).toBe(2);
  });

  it('paiement confirmé par Stripe : commande payée, stock décrémenté une seule fois', async () => {
    const before = await stockOf(createClient());
    const { request, order } = await checkout();

    stripe.paid = true;
    expect((await (await request(`/api/orders/${order.id}`)).json()).status).toBe('paid');
    await request(`/api/orders/${order.id}`); // second retour sur la page : pas de double décrément
    expect(await stockOf(request)).toBe(before - 2);
  });

  it('paiement non effectué : la commande reste en attente', async () => {
    const { request, order } = await checkout();
    expect((await (await request(`/api/orders/${order.id}`)).json()).status).toBe('pending');
  });

  it('annulation : commande annulée et session Stripe fermée', async () => {
    const { request, order } = await checkout();
    const res = await request(`/api/orders/${order.id}/cancel`, { method: 'POST' });
    expect((await res.json()).status).toBe('cancelled');
    expect(stripe.expiredSessions).toEqual([`cs_test_${order.id}`]);
  });

  it("un utilisateur ne voit pas la commande d'un autre", async () => {
    const { order } = await checkout();
    const other = createClient();
    await other('/api/auth/register', {
      method: 'POST',
      body: { email: `autre-${Date.now()}@muscleshop.fr`, password: 'motdepasse', name: 'Autre' },
    });
    expect((await other(`/api/orders/${order.id}`)).status).toBe(404);
  });
});
