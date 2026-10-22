import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import app from '../../src/server/app';
import { db } from '../../src/server/db/client';
import { orders, users } from '../../src/server/db/schema';
import { wallTime } from '../../src/server/services/metrics';
import { createClient } from './helpers';

// Le mode HTTP du benchmark appelle le serveur avec fetch : pas de serveur dans les tests,
// on redirige donc fetch vers l'application Hono.
vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => app.request(new URL(input).pathname, init));

const stamp = Date.now();
const emailOf = (prefix: string) => `${prefix}-${stamp}@muscleshop.fr`;

async function registeredClient(prefix: string) {
  const request = createClient();
  await request('/api/auth/register', { method: 'POST', body: { email: emailOf(prefix), password: 'motdepasse', name: prefix } });
  return request;
}

let admin: ReturnType<typeof createClient>;
let customer: ReturnType<typeof createClient>;

beforeAll(async () => {
  customer = await registeredClient('client');
  admin = await registeredClient('admin');
  // Promotion après la connexion : le rôle est relu en base, la session existante devient admin
  db.update(users).set({ role: 'admin' }).where(eq(users.email, emailOf('admin'))).run();
});

describe('Accès à l’espace admin', () => {
  it('refuse un visiteur (401) et un client (403)', async () => {
    expect((await app.request('/api/admin/stats')).status).toBe(401);
    expect((await customer('/api/admin/stats')).status).toBe(403);
  });

  it('accepte un admin promu sans reconnexion', async () => {
    expect((await admin('/api/admin/stats')).status).toBe(200);
    expect(await (await admin('/api/auth/me')).json()).toMatchObject({ role: 'admin' });
  });

  it('retire l’accès dès que le rôle est retiré en base', async () => {
    const request = await registeredClient('ex-admin');
    db.update(users).set({ role: 'admin' }).where(eq(users.email, emailOf('ex-admin'))).run();
    expect((await request('/api/admin/stats')).status).toBe(200);
    db.update(users).set({ role: 'customer' }).where(eq(users.email, emailOf('ex-admin'))).run();
    expect((await request('/api/admin/stats')).status).toBe(403);
  });
});

describe('Tableau de bord', () => {
  it('renvoie les indicateurs et 14 jours de ventes', async () => {
    const stats = await (await admin('/api/admin/stats')).json();
    expect(stats.salesByDay).toHaveLength(14);
    expect(stats.stock.products).toBeGreaterThanOrEqual(20);
    expect(typeof stats.customers).toBe('number');
    expect(typeof stats.revenue).toBe('number');
  });
});

describe('Stocks', () => {
  it('liste les produits du stock le plus faible au plus élevé', async () => {
    const { items } = await (await admin('/api/admin/products')).json();
    const stocks = items.map((p: { stock: number }) => p.stock);
    expect(stocks).toEqual([...stocks].sort((a, b) => a - b));
  });

  it('modifie un stock et valide la valeur', async () => {
    const { items } = await (await admin('/api/admin/products')).json();
    const zinc = items.find((p: { slug: string }) => p.slug === 'zinc-60');

    const res = await admin(`/api/admin/products/${zinc.id}/stock`, { method: 'PATCH', body: { stock: 3 } });
    expect((await res.json()).stock).toBe(3);
    expect((await admin(`/api/admin/products/${zinc.id}/stock`, { method: 'PATCH', body: { stock: -1 } })).status).toBe(400);
    expect((await admin('/api/admin/products/99999/stock', { method: 'PATCH', body: { stock: 1 } })).status).toBe(404);
    expect((await customer(`/api/admin/products/${zinc.id}/stock`, { method: 'PATCH', body: { stock: 0 } })).status).toBe(403);

    await admin(`/api/admin/products/${zinc.id}/stock`, { method: 'PATCH', body: { stock: zinc.stock } });
  });
});

describe('Commandes', () => {
  const insertOrder = (status: 'pending' | 'paid') => {
    const user = db.select({ id: users.id }).from(users).where(eq(users.email, emailOf('client'))).get()!;
    return db.insert(orders).values({ userId: user.id, total: 1990, status }).returning().get();
  };

  it('passe une commande payée en expédiée, une seule fois', async () => {
    const order = insertOrder('paid');
    const res = await admin(`/api/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'shipped' } });
    expect((await res.json()).status).toBe('shipped');
    expect((await admin(`/api/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'shipped' } })).status).toBe(409);
  });

  it('refuse d’expédier une commande non payée', async () => {
    const order = insertOrder('pending');
    expect((await admin(`/api/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status: 'shipped' } })).status).toBe(409);
  });

  it('filtre l’historique par statut et par client', async () => {
    const { items: shipped } = await (await admin('/api/admin/orders?status=shipped')).json();
    expect(shipped.every((o: { status: string }) => o.status === 'shipped')).toBe(true);

    const { items: mine } = await (await admin(`/api/admin/orders?q=${encodeURIComponent(emailOf('client'))}`)).json();
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((o: { customerEmail: string }) => o.customerEmail === emailOf('client'))).toBe(true);
  });
});

describe('Métriques', () => {
  it('distingue les appels HTTP et internes, par gabarit de route', async () => {
    await admin('/api/admin/metrics', { method: 'DELETE' });
    const res = await app.request('/api/products/whey-vanille-1kg');
    expect(res.headers.get('server-timing')).toMatch(/hono;.*dur=/);
    await app.request('/api/products/zinc-60', { headers: { 'x-internal-call': '1' } });

    const { report, system } = await (await admin('/api/admin/metrics')).json();
    const product = report.routes.filter((r: { route: string }) => r.route === '/api/products/:slug');
    expect(product.map((r: { source: string }) => r.source).sort()).toEqual(['api-http', 'api-internal']);
    // Les appels au panel lui-même ne sont pas comptés
    expect(report.routes.some((r: { route: string }) => r.route.startsWith('/api/admin/metrics'))).toBe(false);
    expect(system.process.node).toBe(process.version);
    expect(system.database.rows.products).toBeGreaterThanOrEqual(20);
  });

  it('fusionne les appels API parallèles pour le temps « horloge »', () => {
    expect(wallTime([[0, 10], [5, 15], [20, 25]])).toBe(20);
    expect(wallTime([])).toBe(0);
  });
});

describe('Benchmark', () => {
  it('compare appel interne et HTTP sur une route d’API', async () => {
    await admin('/api/admin/metrics', { method: 'DELETE' });
    const res = await admin('/api/admin/benchmark', { method: 'POST', body: { target: 'api-health', iterations: 10 } });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.results.map((r: { mode: string }) => r.mode)).toEqual(['internal', 'http']);
    expect(result.results[0].count).toBe(10);

    // Les requêtes du benchmark ne polluent pas les métriques
    const { report } = await (await admin('/api/admin/metrics')).json();
    expect(report.routes.some((r: { route: string }) => r.route === '/api/health')).toBe(false);
  });

  it('refuse une cible hors liste ou trop de requêtes', async () => {
    expect((await admin('/api/admin/benchmark', { method: 'POST', body: { target: 'https://exemple.com', iterations: 10 } })).status).toBe(400);
    expect((await admin('/api/admin/benchmark', { method: 'POST', body: { target: 'api-health', iterations: 5000 } })).status).toBe(400);
    expect((await customer('/api/admin/benchmark', { method: 'POST', body: { target: 'api-health', iterations: 10 } })).status).toBe(403);
  });
});
