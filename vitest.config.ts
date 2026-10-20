import { defineConfig } from 'vitest/config';

// Les tests tournent sur une base dédiée (test.db), recréée à chaque lancement
const testEnv = { DATABASE_URL: 'test.db', JWT_SECRET: 'secret-de-test' };

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    env: testEnv,
    globalSetup: './tests/api/setup.ts',
  },
});
