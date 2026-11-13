// Simulation d'une journée de trafic e-commerce (fichier identique dans les trois versions de MuscleShop).
//
// Lancé par le serveur (services/simulation.ts) dans un PROCESSUS SÉPARÉ : les visiteurs virtuels
// ne partagent pas la boucle d'événements du serveur mesuré, comme avec autocannon.
//
// Une journée de 24 h est compressée dans la durée choisie : creux la nuit, pics le midi et le soir.
// Chaque visiteur virtuel enchaîne un parcours réaliste (voir SCENARIOS) avec un temps de lecture entre les pages.
// Les requêtes envoyées sont celles qu'un vrai navigateur ferait selon l'architecture :
// - "ssr" (Astro) : une page = une requête HTML rendue par le serveur (+ JS/CSS au premier passage) ;
// - "spa" (React, Electron) : la coquille HTML une fois par visite, puis les appels d'API de chaque page.
// Aucune commande n'est créée (pas d'appel à Stripe) : les acheteurs s'arrêtent à la page Commande.

import { performance } from 'node:perf_hooks';

const SIMULATION_HEADER = 'x-simulation';

// Trafic relatif par heure (0 h → 23 h) : profil classique d'une boutique en ligne française
const HOUR_WEIGHTS = [0.06, 0.04, 0.03, 0.02, 0.03, 0.05, 0.12, 0.25, 0.4, 0.5, 0.55, 0.7, 0.95, 0.9, 0.6, 0.5, 0.55, 0.65, 0.85, 1, 0.95, 0.75, 0.45, 0.2];

// Parcours des visiteurs et leur part du trafic
const SCENARIOS = [
  { name: 'Visiteur qui regarde', weight: 42, steps: (r) => ['home', 'catalogue', ...Array.from({ length: r.int(2, 4) }, () => 'product')] },
  { name: 'Recherche', weight: 20, steps: () => ['home', 'search', 'product', 'add', 'cart'] },
  { name: 'Acheteur', weight: 20, steps: (r) => ['home', 'category', 'product', 'add', ...(r.next() < 0.5 ? ['product', 'add'] : []), 'cart', 'login', 'checkout', 'orders'] },
  { name: 'Client fidèle', weight: 15, steps: () => ['login', 'orders', 'product', 'add', 'cart'] },
  { name: 'Administrateur', weight: 3, steps: () => ['adminLogin', 'admin'] },
];

const SEARCH_TERMS = ['whey', 'creatine', 'barre', 'chocolat', 'vitamine', 'shaker', 'bcaa', 'omega'];

// --- Aléatoire à graine (mulberry32) : deux lancements identiques envoient les mêmes parcours ---
function prng(seed) {
  let s = seed;
  const next = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min, max) => min + Math.floor(next() * (max - min + 1)), pick: (list) => list[Math.floor(next() * list.length)] };
}

// --- Statistiques ---
const round = (v) => Math.round(v * 100) / 100;
function stats(values) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  const at = (p) => (n ? sorted[Math.min(n - 1, Math.floor(p * n))] : 0);
  let sum = 0;
  for (const v of sorted) sum += v;
  return { count: n, avg: round(n ? sum / n : 0), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(n ? sorted[n - 1] : 0) };
}

let config;
let stopping = false;

process.on('message', (message) => {
  if (message?.type === 'start') {
    config = message.config;
    run().catch((error) => {
      process.send?.({ type: 'error', message: String(error?.stack ?? error) });
      process.exit(1);
    });
  }
  if (message?.type === 'stop') stopping = true;
});
process.on('disconnect', () => process.exit(0));

async function run() {
  const { origin, architecture, maxUsers, durationMinutes, catalog, accounts, admin, thinkMs } = config;
  const random = prng(config.seed ?? 20261112);
  const durationMs = durationMinutes * 60_000;
  const hourMs = durationMs / 24;
  const startedAt = Date.now();
  const t0 = performance.now();
  const elapsed = () => performance.now() - t0;
  const hourOf = (ms) => Math.min(23, Math.floor(ms / hourMs));

  // Mesures
  const requestTimes = new Map(); // libellé → durées
  const requestErrors = new Map(); // libellé → { errors, clientErrors }
  const pageTimes = new Map(); // page → durées
  const all = [];
  const hours = HOUR_WEIGHTS.map(() => ({ requests: 0, errors: 0, clientErrors: 0, pageTimes: [], requestTimes: [], targetUsers: 0, maxActive: 0 }));
  const perSecond = new Map(); // seconde → nombre de requêtes
  const recent = []; // [fin, durée] des 5 dernières secondes (suivi en direct)
  let requests = 0;
  let errors = 0;
  let clientErrors = 0;
  let sessions = 0;
  let pageViews = 0;

  function record(label, durationMs, status) {
    const now = elapsed();
    const hour = hours[hourOf(now)];
    requests++;
    hour.requests++;
    all.push(durationMs);
    hour.requestTimes.push(durationMs);
    if (!requestTimes.has(label)) {
      requestTimes.set(label, []);
      requestErrors.set(label, { errors: 0, clientErrors: 0 });
    }
    requestTimes.get(label).push(durationMs);
    const second = Math.floor(now / 1000);
    perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
    recent.push([now, durationMs]);
    // 5xx ou échec réseau : erreur serveur. 4xx : réponse normale d'un site (401 non connecté, 409 stock…)
    if (status === 0 || status >= 500) {
      errors++;
      hour.errors++;
      requestErrors.get(label).errors++;
    } else if (status >= 400) {
      clientErrors++;
      hour.clientErrors++;
      requestErrors.get(label).clientErrors++;
    }
  }

  // --- Un visiteur : ses cookies (panier, session) et les fichiers déjà en cache ---
  function newVisitor() {
    return { cookies: new Map(), assets: new Set(), shellLoaded: false, loggedIn: false };
  }

  function storeCookies(visitor, headers) {
    for (const header of headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (/max-age=0/i.test(header) || /expires=thu, 01 jan 1970/i.test(header) || value === '') visitor.cookies.delete(name);
      else visitor.cookies.set(name, value);
    }
  }

  async function request(visitor, method, path, label, body) {
    const start = performance.now();
    let status = 0;
    let text = '';
    let contentType = '';
    try {
      const res = await fetch(origin + path, {
        method,
        redirect: 'manual',
        headers: {
          [SIMULATION_HEADER]: '1',
          ...(visitor.cookies.size ? { cookie: [...visitor.cookies].map(([n, v]) => `${n}=${v}`).join('; ') } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      text = await res.text();
      status = res.status;
      contentType = res.headers.get('content-type') ?? '';
      storeCookies(visitor, res.headers);
    } catch {
      status = 0;
    }
    record(`${method} ${label}`, performance.now() - start, status);
    return { status, text, contentType };
  }

  // Document HTML : le navigateur télécharge ensuite les JS et CSS qu'il ne connaît pas encore
  async function document(visitor, path, label) {
    const res = await request(visitor, 'GET', path, label);
    if (res.contentType.includes('text/html')) {
      const assets = [...res.text.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|mjs|css))"/g)].map((m) => m[1]).filter((url) => !visitor.assets.has(url));
      assets.forEach((url) => visitor.assets.add(url));
      await Promise.all(assets.map((url) => request(visitor, 'GET', url, 'Fichier statique (JS / CSS)')));
    }
    return res;
  }

  const product = () => random.pick(catalog.products);
  const category = () => random.pick(catalog.categories);
  const term = () => random.pick(SEARCH_TERMS);

  // --- Ce que coûte chaque page, selon l'architecture ---
  const ssr = {
    home: (v) => document(v, '/', 'Page /'),
    catalogue: (v) => document(v, '/produits', 'Page /produits'),
    search: (v) => document(v, `/produits?q=${term()}`, 'Page /produits?q='),
    category: (v) => document(v, `/categories/${category()}`, 'Page /categories/[slug]'),
    product: (v) => document(v, `/produits/${product()}`, 'Page /produits/[slug]'),
    cart: (v) => document(v, '/panier', 'Page /panier'),
    checkout: (v) => document(v, '/commande', 'Page /commande'),
    orders: (v) => document(v, '/compte/commandes', 'Page /compte/commandes'),
    admin: (v) => document(v, '/admin', 'Page /admin'),
    loginPage: (v) => document(v, '/compte/connexion', 'Page /compte/connexion'),
    afterLogin: async () => {},
  };

  const api = (v, path, label) => request(v, 'GET', path, label);
  const spa = {
    // Coquille HTML + JS/CSS une fois par visite, puis session et panier (contextes de l'application)
    shell: async (v) => {
      if (v.shellLoaded) return;
      v.shellLoaded = true;
      await document(v, '/', 'Coquille HTML (index.html)');
      await Promise.all([api(v, '/api/auth/me', '/api/auth/me'), api(v, '/api/cart', '/api/cart')]);
    },
    home: (v) =>
      Promise.all([
        api(v, '/api/categories', '/api/categories'),
        api(v, '/api/products?sort=best-sellers&limit=4', '/api/products?sort=best-sellers'),
        api(v, '/api/products?promo=true&limit=4', '/api/products?promo=true'),
        api(v, '/api/products?sort=newest&limit=4', '/api/products?sort=newest'),
      ]),
    catalogue: (v) => api(v, '/api/products', '/api/products'),
    search: (v) => api(v, `/api/products?q=${term()}`, '/api/products?q='),
    category: (v) => api(v, `/api/categories/${category()}`, '/api/categories/:slug'),
    product: (v) => api(v, `/api/products/${product()}`, '/api/products/:slug'),
    cart: (v) => api(v, '/api/cart', '/api/cart'),
    checkout: (v) => api(v, '/api/cart', '/api/cart'),
    orders: (v) => api(v, '/api/orders', '/api/orders'),
    admin: (v) => api(v, '/api/admin/stats', '/api/admin/stats'),
    loginPage: async () => {},
    afterLogin: (v) => api(v, '/api/auth/me', '/api/auth/me'),
  };

  const pages = architecture === 'ssr' ? ssr : spa;
  const pageLabels = {
    home: 'Accueil', catalogue: 'Catalogue', search: 'Recherche', category: 'Catégorie', product: 'Fiche produit',
    cart: 'Panier', checkout: 'Commande', orders: 'Mes commandes', admin: 'Admin (tableau de bord)', login: 'Connexion', add: 'Ajout au panier',
  };

  // Une étape = une page affichée ou une action ; sa durée = temps jusqu'à ce que tout soit reçu
  async function step(visitor, name) {
    const start = performance.now();
    if (architecture === 'spa' && name !== 'add') await spa.shell(visitor);

    if (name === 'add') {
      await request(visitor, 'POST', '/api/cart/items', '/api/cart/items', { productId: random.pick(catalog.productIds), quantity: 1 });
    } else if (name === 'login' || name === 'adminLogin') {
      const account = name === 'adminLogin' ? admin : random.pick(accounts);
      if (!account) return false;
      await pages.loginPage(visitor);
      const res = await request(visitor, 'POST', '/api/auth/login', '/api/auth/login', { email: account, password: config.password });
      visitor.loggedIn = res.status === 200;
      if (visitor.loggedIn) await pages.afterLogin(visitor);
      name = 'login';
    } else {
      // Pages réservées : un visiteur non connecté ne les demande pas
      if ((name === 'checkout' || name === 'orders' || name === 'admin') && !visitor.loggedIn) return false;
      await pages[name](visitor);
    }

    const duration = performance.now() - start;
    if (!pageTimes.has(name)) pageTimes.set(name, []);
    pageTimes.get(name).push(duration);
    if (name !== 'add' && name !== 'login') {
      pageViews++;
      hours[hourOf(elapsed())].pageTimes.push(duration);
    }
    return true;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pickScenario = () => {
    let roll = random.next() * SCENARIOS.reduce((sum, s) => sum + s.weight, 0);
    for (const scenario of SCENARIOS) if ((roll -= scenario.weight) < 0) return scenario;
    return SCENARIOS[0];
  };

  // --- Pilotage : le nombre de visiteurs simultanés suit la courbe de la journée ---
  let active = 0;
  const target = () => Math.max(1, Math.round(maxUsers * HOUR_WEIGHTS[hourOf(elapsed())]));
  const running = new Set();

  async function visitorLoop() {
    active++;
    try {
      while (!stopping && elapsed() < durationMs && active <= target()) {
        const visitor = newVisitor();
        sessions++;
        for (const name of pickScenario().steps(random)) {
          if (stopping || elapsed() >= durationMs) break;
          const done = await step(visitor, name);
          if (done) await sleep(thinkMs[0] + random.next() * (thinkMs[1] - thinkMs[0]));
        }
      }
    } finally {
      active--;
    }
  }

  let lastProgress = 0;
  while (!stopping && elapsed() < durationMs) {
    const now = elapsed();
    const hour = hours[hourOf(now)];
    hour.targetUsers = Math.max(hour.targetUsers, target());
    while (active < target()) {
      const loop = visitorLoop();
      running.add(loop);
      loop.finally(() => running.delete(loop));
      await Promise.resolve();
    }
    hour.maxActive = Math.max(hour.maxActive, active);

    if (now - lastProgress >= 1000) {
      lastProgress = now;
      while (recent.length && recent[0][0] < now - 5000) recent.shift();
      const last = stats(recent.map(([, d]) => d));
      process.send?.({
        type: 'progress',
        progress: {
          elapsedMs: Math.round(now),
          durationMs,
          hour: hourOf(now),
          activeUsers: active,
          targetUsers: target(),
          requests,
          errors,
          clientErrors,
          pageViews,
          requestsPerSecond: round(last.count / 5),
          p95LastMs: last.p95,
        },
      });
    }
    await sleep(100);
  }

  // Fin : on laisse les requêtes en cours se terminer (10 s au plus)
  stopping = true;
  await Promise.race([Promise.allSettled([...running]), sleep(10_000)]);
  const totalMs = elapsed();
  const seconds = [...perSecond.values()];

  process.send?.({
    type: 'done',
    report: {
      architecture,
      startedAt,
      finishedAt: Date.now(),
      durationMs: Math.round(totalMs),
      stopped: totalMs < durationMs - 1000,
      totals: {
        sessions,
        pageViews,
        requests,
        errors,
        clientErrors,
        errorRate: round(requests ? (errors / requests) * 100 : 0),
        requestsPerSecond: round(requests / (totalMs / 1000)),
        peakRequestsPerSecond: seconds.length ? Math.max(...seconds) : 0,
      },
      latency: stats(all),
      pages: [...pageTimes].map(([name, list]) => ({ page: name, label: pageLabels[name] ?? name, ...stats(list) })).sort((a, b) => b.count - a.count),
      requests: [...requestTimes]
        .map(([label, list]) => ({ label, ...stats(list), ...requestErrors.get(label) }))
        .sort((a, b) => b.count - a.count),
      hours: hours.map((h, hour) => ({
        hour,
        targetUsers: h.targetUsers,
        maxActive: h.maxActive,
        requests: h.requests,
        requestsPerSecond: round(h.requests / (hourMs / 1000)),
        p95RequestMs: stats(h.requestTimes).p95,
        p95PageMs: stats(h.pageTimes).p95,
        errors: h.errors,
        clientErrors: h.clientErrors,
      })),
    },
  });
  setTimeout(() => process.exit(0), 100);
}
