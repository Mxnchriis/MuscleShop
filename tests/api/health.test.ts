import { describe, expect, it } from 'vitest';
import app from '../../src/server/app';

describe('API', () => {
  it('GET /api/health répond ok', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /api/cart/items valide le corps', async () => {
    const res = await app.request('/api/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'abc' }),
    });
    expect(res.status).toBe(400);
  });
});
