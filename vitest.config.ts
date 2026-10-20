import { defineConfig } from 'vitest/config';

// Les tests tournent sur une base dédiée (test.db), recréée à chaque lancement
// Stripe est simulé dans les tests (vi.mock) : la clé n'est jamais utilisée
const testEnv = { DATABASE_URL: 'test.db', JWT_SECRET: 'secret-de-test', STRIPE_SECRET_KEY: 'sk_test_factice' };

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    env: testEnv,
    globalSetup: './tests/api/setup.ts',
  },
});
