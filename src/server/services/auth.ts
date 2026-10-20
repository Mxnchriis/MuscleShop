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

export async function registerUser(input: { email: string; password: string; name: string }): Promise<SessionUser | null> {
  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get();
  if (existing) return null;

  const passwordHash = await hashPassword(input.password);
  return db
    .insert(users)
    .values({ email: input.email, name: input.name, passwordHash })
    .returning({ id: users.id, email: users.email, name: users.name })
    .get();
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export function createSessionToken(user: SessionUser) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  return sign({ sub: user.id, email: user.email, name: user.name, exp }, env.JWT_SECRET, 'HS256');
}

// Renvoie null si le jeton est absent, expiré ou falsifié
export async function readSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const payload = await verify(token, env.JWT_SECRET, 'HS256');
    return { id: Number(payload.sub), email: String(payload.email), name: String(payload.name) };
  } catch {
    return null;
  }
}
