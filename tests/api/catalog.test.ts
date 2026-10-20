import { describe, expect, it } from 'vitest';
import app from '../../src/server/app';

// Données issues du seed, chargé dans test.db par tests/api/setup.ts
describe('Catalogue', () => {
  it('GET /api/products renvoie les produits de la base', async () => {
    const res = await app.request('/api/products');
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThan(0);
  });

  it('GET /api/products?category= filtre par catégorie', async () => {
    const res = await app.request('/api/products?category=creatine');
    const { items } = await res.json();
    expect(items.map((p: { slug: string }) => p.slug)).toEqual(['creatine-monohydrate-300g']);
  });

  it('GET /api/products/:slug renvoie la fiche produit', async () => {
    const res = await app.request('/api/products/whey-vanille-1kg');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Whey Vanille 1 kg', price: 2990 });
  });

  it('GET /api/products/:slug inconnu renvoie 404', async () => {
    const res = await app.request('/api/products/inexistant');
    expect(res.status).toBe(404);
  });

  it('GET /api/categories/:slug inclut ses produits', async () => {
    const res = await app.request('/api/categories/proteines');
    const category = await res.json();
    expect(category.name).toBe('Protéines');
    expect(category.products).toHaveLength(1);
  });
});
