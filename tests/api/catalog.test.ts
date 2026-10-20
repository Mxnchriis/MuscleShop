import { describe, expect, it } from 'vitest';
import app from '../../src/server/app';

// Données issues du seed, chargé dans test.db par tests/api/setup.ts
describe('Catalogue', () => {
  it('GET /api/products renvoie les produits de la base', async () => {
    const res = await app.request('/api/products');
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(20);
  });

  it('GET /api/products?category= filtre par catégorie', async () => {
    const res = await app.request('/api/products?category=creatine');
    const { items } = await res.json();
    expect(items.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'creatine-gelules-120',
      'creatine-monohydrate-300g',
      'creatine-monohydrate-500g',
    ]);
  });

  it('GET /api/products?q= recherche dans les noms', async () => {
    const res = await app.request('/api/products?q=chocolat');
    const { items } = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every((p: { name: string }) => p.name.toLowerCase().includes('chocolat'))).toBe(true);
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
    expect(category.products.map((p: { slug: string }) => p.slug)).toContain('whey-chocolat-500g');
    expect(category.products.every((p: { categoryId: number }) => p.categoryId === category.id)).toBe(true);
  });

  it('GET /api/products?promo=true ne renvoie que des produits à prix barré', async () => {
    const { items } = await (await app.request('/api/products?promo=true')).json();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p: { price: number; originalPrice: number | null }) => p.originalPrice! > p.price)).toBe(true);
  });

  it('GET /api/products?sort=newest&limit=4 renvoie les 4 derniers produits ajoutés', async () => {
    const { items } = await (await app.request('/api/products?sort=newest&limit=4')).json();
    const ids = items.map((p: { id: number }) => p.id);
    expect(ids).toHaveLength(4);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it('GET /api/products?sort=best-sellers&limit=4 renvoie 4 produits même sans vente', async () => {
    const { items } = await (await app.request('/api/products?sort=best-sellers&limit=4')).json();
    expect(items).toHaveLength(4);
  });

  it('GET /api/products refuse un tri ou une limite invalides', async () => {
    expect((await app.request('/api/products?sort=prix')).status).toBe(400);
    expect((await app.request('/api/products?limit=0')).status).toBe(400);
    expect((await app.request('/api/products?limit=abc')).status).toBe(400);
  });

  it('GET /api/categories renvoie le nombre de produits par catégorie', async () => {
    const { items } = await (await app.request('/api/categories')).json();
    expect(items).toHaveLength(7);
    expect(items.find((c: { slug: string }) => c.slug === 'creatine').productCount).toBe(3);
  });
});
