import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { count, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from '../db/client';
import { categories, orderItems, orders, products, users } from '../db/schema';
import { env } from '../env';

// Retard de la boucle d'événements : si elle est bloquée (calcul synchrone, I/O synchrone),
// toutes les requêtes attendent. C'est l'indicateur clé d'un serveur Node.
// L'histogramme enregistre l'intervalle complet entre deux relevés (≈ RESOLUTION) :
// le retard réel est ce qui dépasse cet intervalle.
const RESOLUTION_MS = 10;
const loopDelay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
loopDelay.enable();

let lastCpu = process.cpuUsage();
let lastCpuAt = performance.now();
let lastElu = performance.eventLoopUtilization();

const countRows = (table: SQLiteTable) => db.select({ n: count() }).from(table).get()!.n;

const ms = (nanoseconds: number) => Math.round((nanoseconds / 1e6) * 100) / 100;
const delayMs = (nanoseconds: number) => Math.max(0, Math.round((nanoseconds / 1e6 - RESOLUTION_MS) * 100) / 100);
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

// Versions réellement installées (lues dans node_modules, sans passer par les "exports" des paquets)
function installedVersion(name: string) {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf-8')).version as string;
  } catch {
    return 'inconnue';
  }
}

const versions = Object.fromEntries(
  ['astro', '@astrojs/node', 'hono', 'drizzle-orm', 'better-sqlite3', 'zod', 'stripe'].map((name) => [name, installedVersion(name)]),
);

export function getSystemReport() {
  // CPU et utilisation de la boucle : calculés depuis l'appel précédent
  const now = performance.now();
  const cpu = process.cpuUsage(lastCpu);
  const elapsedMicros = (now - lastCpuAt) * 1000;
  const elu = performance.eventLoopUtilization(lastElu);
  lastCpu = process.cpuUsage();
  lastCpuAt = now;
  lastElu = performance.eventLoopUtilization();

  const memory = process.memoryUsage();
  let dbSize = 0;
  try {
    dbSize = statSync(env.DATABASE_URL).size;
  } catch {
    // base en mémoire ou introuvable
  }

  return {
    process: {
      pid: process.pid,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      mode: env.isProd ? 'production' : 'développement',
      uptimeSeconds: Math.round(process.uptime()),
      cpuPercent: Math.round(((cpu.user + cpu.system) / (elapsedMicros || 1)) * 1000) / 10,
      memory: { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal), externalMb: mb(memory.external) },
    },
    eventLoop: {
      utilizationPercent: Math.round(elu.utilization * 1000) / 10,
      delayP50Ms: delayMs(loopDelay.percentile(50)),
      delayP99Ms: delayMs(loopDelay.percentile(99)),
      delayMaxMs: delayMs(loopDelay.max),
    },
    os: {
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? 'inconnu',
      loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
      totalMemoryMb: mb(os.totalmem()),
      freeMemoryMb: mb(os.freemem()),
    },
    database: {
      engine: 'SQLite',
      version: db.get<{ version: string }>(sql`select sqlite_version() as version`)?.version ?? 'inconnue',
      file: env.DATABASE_URL,
      sizeKb: Math.round(dbSize / 1024),
      rows: {
        categories: countRows(categories),
        products: countRows(products),
        users: countRows(users),
        orders: countRows(orders),
        orderItems: countRows(orderItems),
      },
    },
    versions,
  };
}

export function resetEventLoopStats() {
  loopDelay.reset();
}
