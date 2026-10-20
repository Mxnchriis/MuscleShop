// Vite/Astro ne chargent .env que dans import.meta.env : on le charge aussi dans process.env
// pour que le code Hono fonctionne pareil sous Astro, Vitest, tsx et `npm start`.
// Les variables déjà définies (ex. par Vitest) ne sont pas écrasées.
try {
  process.loadEnvFile();
} catch {
  // Pas de fichier .env : on garde l'environnement existant
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return value;
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? 'sqlite.db',
  JWT_SECRET: required('JWT_SECRET'),
  isProd: process.env.NODE_ENV === 'production',
};
