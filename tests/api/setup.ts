import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

// Recrée test.db : tables (drizzle-kit push) puis données de démo (seed)
export default function setup() {
  const env = { ...process.env, DATABASE_URL: 'test.db', JWT_SECRET: 'secret-de-test', STRIPE_SECRET_KEY: 'sk_test_factice' };
  rmSync('test.db', { force: true });
  execSync('npx drizzle-kit push --force', { env, stdio: 'ignore' });
  execSync('npx tsx src/server/db/seed.ts', { env, stdio: 'ignore' });
}
