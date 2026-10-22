import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { sign, verify } from 'hono/jwt';
import { db } from '../db/client';
import { users } from '../db/schema';
import { env } from '../env';
import type { SessionUser } from '../../types';

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 jours, en secondes

// Mot de passe stocké sous la forme "sel:hash" (scrypt, inclus dans Node : aucune dépendance)
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const hash = await scryptAsync(password, salt, 64);
  return timingSafeEqual(hash, Buffer.from(hex, 'hex'));
}

// Colonnes exposées comme « utilisateur connecté » (jamais le hash du mot de passe)
const sessionColumns = { id: users.id, email: users.email, name: users.name, role: users.role };

export async function registerUser(input: { email: string; password: string; name: string }): Promise<SessionUser | null> {
  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get();
  if (existing) return null;

  const passwordHash = await hashPassword(input.password);
  return db
    .insert(users)
    .values({ email: input.email, name: input.name, passwordHash })
    .returning(sessionColumns)
    .get();
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function createSessionToken(user: SessionUser) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  return sign({ sub: user.id, email: user.email, name: user.name, exp }, env.JWT_SECRET, 'HS256');
}

// Identifiant de l'utilisateur, ou null si le jeton est absent, expiré ou falsifié
async function readSessionToken(token: string | undefined): Promise<number | null> {
  if (!token) return null;
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256');
    return Number(payload.sub);
  } catch {
    return null;
  }
}

// Utilisateur de la session : JWT vérifié, puis utilisateur relu en base.
// Le rôle n'est donc pas figé dans le jeton : retirer les droits admin prend effet immédiatement,
// et un compte supprimé n'a plus de session valide.
export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  const id = await readSessionToken(token);
  if (id === null) return null;
  return db.select(sessionColumns).from(users).where(eq(users.id, id)).get() ?? null;
}
