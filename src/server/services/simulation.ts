import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { eq, like } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, products, users } from '../db/schema';

// Journée simulée : pilote scripts/simulation.mjs (processus séparé) et mesure le serveur pendant ce temps.
// Fichier identique dans les trois versions de MuscleShop ; seuls `architecture` et `version` sont passés par la route.

export const simulationProfiles = {
  calme: { label: 'Journée calme', maxUsers: 15 },
  normale: { label: 'Journée normale', maxUsers: 50 },
  soldes: { label: 'Jour de soldes', maxUsers: 150 },
} as const;
export type SimulationProfile = keyof typeof simulationProfiles;

// Temps de lecture entre deux pages (ms), compressé comme la journée
const THINK_MS: [number, number] = [150, 600];
const PASSWORD = 'password123'; // comptes créés par `npm run db:mock`

interface ResourceSample {
  elapsedMs: number;
  cpuPercent: number;
  rssMb: number;
  heapUsedMb: number;
  loopP99Ms: number;
  loopMaxMs: number;
}

interface SimulationState {
  status: 'idle' | 'running' | 'done' | 'error';
  version?: string;
  mode?: 'production' | 'développement'; // un serveur de dev (astro dev, tsx watch, Vite) fausse la comparaison
  profile?: SimulationProfile;
  profileLabel?: string;
  maxUsers?: number;
  durationMinutes?: number;
  startedAt?: number;
  progress?: Record<string, number>;
  report?: Record<string, unknown>;
  resources: ResourceSample[];
  error?: string;
  file?: string;
}

let state: SimulationState = { status: 'idle', resources: [] };
let child: ChildProcess | null = null;
let sampler: ReturnType<typeof setInterval> | undefined;

const round = (value: number) => Math.round(value * 100) / 100;
const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

// scripts/simulation.mjs : cherché depuis le dossier courant en remontant (workspaces npm)
function findScript() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const file = join(dir, 'scripts', 'simulation.mjs');
    if (existsSync(file)) return file;
    if (dirname(dir) === dir) throw new Error('scripts/simulation.mjs introuvable');
  }
}

// CPU, mémoire et retard de la boucle d'événements du serveur, chaque seconde
function startSampling(startedAt: number) {
  const RESOLUTION_MS = 10;
  const loop = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  loop.enable();
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  sampler = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage(lastCpu);
    const memory = process.memoryUsage();
    state.resources.push({
      elapsedMs: Date.now() - startedAt,
      cpuPercent: round(((cpu.user + cpu.system) / 1000 / (now - lastAt)) * 100),
      rssMb: mb(memory.rss),
      heapUsedMb: mb(memory.heapUsed),
      loopP99Ms: Math.max(0, round(loop.percentile(99) / 1e6 - RESOLUTION_MS)),
      loopMaxMs: Math.max(0, round(loop.max / 1e6 - RESOLUTION_MS)),
    });
    loop.reset();
    lastCpu = process.cpuUsage();
    lastAt = now;
  }, 1000);
  return () => {
    clearInterval(sampler);
    loop.disable();
  };
}

// Ressources du serveur résumées, globalement et par heure simulée
function resourceSummary() {
  const samples = state.resources;
  if (samples.length === 0) return null;
  const avg = (values: number[]) => round(values.reduce((a, b) => a + b, 0) / values.length);
  const hourMs = ((state.durationMinutes ?? 1) * 60_000) / 24;
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const inHour = samples.filter((s) => Math.min(23, Math.floor(s.elapsedMs / hourMs)) === hour);
    return inHour.length
      ? { hour, cpuPercent: avg(inHour.map((s) => s.cpuPercent)), rssMb: Math.max(...inHour.map((s) => s.rssMb)), loopP99Ms: Math.max(...inHour.map((s) => s.loopP99Ms)) }
      : { hour, cpuPercent: null, rssMb: null, loopP99Ms: null };
  });
  return {
    cpuAvgPercent: avg(samples.map((s) => s.cpuPercent)),
    cpuMaxPercent: Math.max(...samples.map((s) => s.cpuPercent)),
    rssStartMb: samples[0].rssMb,
    rssMaxMb: Math.max(...samples.map((s) => s.rssMb)),
    loopP99MaxMs: Math.max(...samples.map((s) => s.loopP99Ms)),
    loopMaxMs: Math.max(...samples.map((s) => s.loopMaxMs)),
    hours,
  };
}

export function getSimulation() {
  const { resources, ...rest } = state;
  return { ...rest, server: resourceSummary(), samples: resources.length };
}

interface StartInput {
  origin: string; // URL du serveur, vue par les visiteurs virtuels
  architecture: 'ssr' | 'spa';
  version: string; // ex. astro-hono, nom du fichier de résultats
  profile: SimulationProfile;
  durationMinutes: number;
}

// Lance la journée ; null si une simulation tourne déjà
export function startSimulation({ origin, architecture, version, profile, durationMinutes }: StartInput) {
  if (state.status === 'running') return null;

  // Données réelles de la base : produits, catégories, comptes de démo (db:mock)
  const productRows = db.select({ id: products.id, slug: products.slug }).from(products).all();
  const catalog = {
    products: productRows.map((p) => p.slug),
    productIds: productRows.map((p) => p.id),
    categories: db.select({ slug: categories.slug }).from(categories).all().map((c) => c.slug),
  };
  const accounts = db.select({ email: users.email }).from(users).where(like(users.email, '%@client.muscleshop.fr')).all().map((u) => u.email);
  const admin = db.select({ email: users.email }).from(users).where(eq(users.email, 'admin@muscleshop.fr')).get()?.email ?? null;

  const { label, maxUsers } = simulationProfiles[profile];
  const startedAt = Date.now();
  state = { status: 'running', version, mode: process.env.NODE_ENV === 'production' ? 'production' : 'développement', profile, profileLabel: label, maxUsers, durationMinutes, startedAt, resources: [] };

  const script = findScript();
  const stopSampling = startSampling(startedAt);
  child = fork(script, [], { execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });

  child.on('message', (message: { type: string; progress?: Record<string, number>; report?: Record<string, unknown>; message?: string }) => {
    if (message.type === 'progress') state.progress = message.progress;
    if (message.type === 'error') state = { ...state, status: 'error', error: message.message };
    if (message.type === 'done') {
      stopSampling();
      state = { ...state, status: 'done', report: message.report };
      // Résultat complet enregistré pour comparer les trois versions
      try {
        const dir = resolve(dirname(script), '..', 'bench', 'results');
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `simulation-${version}-${profile}-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.json`);
        writeFileSync(file, JSON.stringify({ ...getSimulation(), resources: state.resources }, null, 2));
        state.file = file;
      } catch {
        // pas de dossier accessible en écriture : le résultat reste visible dans le panel
      }
    }
  });
  child.on('exit', () => {
    child = null;
    stopSampling();
    if (state.status === 'running') state = { ...state, status: 'error', error: 'Le processus de simulation s’est arrêté sans résultat' };
  });

  child.send({
    type: 'start',
    config: { origin, architecture, maxUsers, durationMinutes, catalog, accounts, admin, password: PASSWORD, thinkMs: THINK_MS, seed: 20261112 },
  });
  return getSimulation();
}

// Arrêt anticipé : le rapport porte sur la partie déjà jouée
export function stopSimulation() {
  child?.send({ type: 'stop' });
  return getSimulation();
}
