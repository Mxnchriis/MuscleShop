// Panneau « Journée simulée » de l'espace admin (navigateur, sans framework).
// Fichier identique dans les trois versions de MuscleShop : Astro, React et Electron le montent dans un conteneur.
// Données : POST /api/admin/simulation (lancer), GET (suivre), DELETE (arrêter).
import { renderChart } from './charts';
import { chartFormats } from './admin';

const ms = chartFormats.ms;
const count = chartFormats.count;
const POLL_MS = 1000;

// Formes renvoyées par l'API (services/simulation.ts et scripts/simulation.mjs)
interface Stats { count: number; avg: number; p50: number; p95: number; p99: number; max: number }
interface Report {
  architecture: 'ssr' | 'spa';
  durationMs: number;
  stopped: boolean;
  totals: { sessions: number; pageViews: number; requests: number; errors: number; clientErrors: number; errorRate: number; requestsPerSecond: number; peakRequestsPerSecond: number };
  latency: Stats;
  pages: (Stats & { page: string; label: string })[];
  requests: (Stats & { label: string; errors: number; clientErrors: number })[];
  hours: { hour: number; targetUsers: number; maxActive: number; requests: number; requestsPerSecond: number; p95RequestMs: number; p95PageMs: number; errors: number; clientErrors: number }[];
}
interface Server {
  cpuAvgPercent: number; cpuMaxPercent: number; rssStartMb: number; rssMaxMb: number; loopP99MaxMs: number; loopMaxMs: number;
  hours: { hour: number; cpuPercent: number | null; rssMb: number | null; loopP99Ms: number | null }[];
}
interface Simulation {
  status: 'idle' | 'running' | 'done' | 'error';
  version?: string;
  mode?: string;
  profileLabel?: string;
  maxUsers?: number;
  durationMinutes?: number;
  progress?: { elapsedMs: number; durationMs: number; hour: number; activeUsers: number; targetUsers: number; requests: number; errors: number; clientErrors: number; pageViews: number; requestsPerSecond: number; p95LastMs: number };
  report?: Report;
  server: Server | null;
  error?: string;
  file?: string;
}

// --- Petits outils DOM (textContent : aucune donnée n'est interprétée comme du HTML) ---
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string | null, ...children: (Node | string | null | undefined | false)[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}
const tile = (label: string, value: string, hint?: string) => el('div', 'tile', el('div', 'tile-label', label), el('div', 'tile-value', value), hint ? el('div', 'tile-hint', hint) : null);
function table(headers: { label: string; num?: boolean }[], rows: (Node | string)[][]) {
  const head = el('tr', null, ...headers.map((h) => el('th', h.num ? 'num' : null, h.label)));
  const body = rows.map((cells) => el('tr', null, ...cells.map((cell, i) => el('td', headers[i]?.num ? 'num' : null, cell))));
  return el('div', 'table-scroll', el('table', 'data', el('thead', null, head), el('tbody', null, ...body)));
}
const percent = (value: number) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')} h`;
const errorText = (body: unknown) => {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : 'Action impossible';
};

export function initSimulationPanel(root: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const profile = el('select', null,
    new Option('Journée calme (15 visiteurs max)', 'calme'),
    new Option('Journée normale (50 visiteurs max)', 'normale', true, true),
    new Option('Jour de soldes (150 visiteurs max)', 'soldes'));
  profile.setAttribute('aria-label', 'Profil de trafic');
  profile.name = 'profile';
  const duration = el('select', null, new Option('1 min', '1'), new Option('2 min', '2', true, true), new Option('5 min', '5'), new Option('10 min', '10'));
  duration.setAttribute('aria-label', 'Durée');
  duration.name = 'duration';
  const start = el('button', 'btn btn-small', 'Lancer la journée');
  start.type = 'submit';
  const stop = el('button', 'btn btn-secondary btn-small', 'Arrêter');
  stop.type = 'button';
  const form = el('form', 'filters', el('label', null, 'Trafic ', profile), el('label', null, 'Durée ', duration), start, stop);

  const status = el('div');
  const results = el('div');

  root.replaceChildren(
    el('section', 'card',
      el('div', 'card-header',
        el('h2', null, 'Simuler une journée'),
        el('p', null, 'Visiteurs virtuels dans un processus séparé : navigation, recherche, panier, connexion, admin')),
      el('p', 'hint',
        'Une journée de 24 h est compressée dans la durée choisie : creux la nuit, pics à midi et le soir. ',
        'Chaque page envoie les requêtes d’un vrai navigateur pour cette version (page rendue par le serveur pour Astro, ',
        'coquille HTML puis appels d’API pour React et Electron). Aucune commande n’est passée (pas d’appel à Stripe). ',
        'Les requêtes sont aussi visibles en direct dans le panel Performance. Lancer une seule version à la fois pour comparer.'),
      form,
      status),
    results,
  );

  async function call(method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
    const res = await fetch('/api/admin/simulation', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(errorText(data));
    return data as Simulation;
  }

  function renderStatus(sim: Simulation) {
    const running = sim.status === 'running';
    start.disabled = running;
    profile.disabled = running;
    duration.disabled = running;
    stop.style.display = running ? '' : 'none'; // pas `hidden` : la classe .btn l'emporterait

    if (sim.status === 'error') return status.replaceChildren(el('p', 'error', sim.error ?? 'La simulation a échoué'));
    if (!running || !sim.progress) {
      return status.replaceChildren(running ? el('p', 'hint', 'Démarrage des visiteurs…') : el('p', 'hint', sim.status === 'idle' ? 'Aucune simulation lancée depuis le démarrage du serveur.' : ''));
    }
    const p = sim.progress;
    const share = Math.min(100, (p.elapsedMs / p.durationMs) * 100);
    const bar = el('div');
    Object.assign(bar.style, { height: '0.6rem', borderRadius: '999px', background: 'var(--grid)', overflow: 'hidden', margin: '0.25rem 0 1rem' });
    const fill = el('div');
    Object.assign(fill.style, { height: '100%', width: `${share}%`, background: 'var(--series-1)', transition: 'width 0.5s' });
    bar.append(fill);
    status.replaceChildren(
      el('p', 'hint', `${sim.profileLabel} · ${hourLabel(p.hour)} simulée · ${Math.round(share)} % (${Math.round(p.elapsedMs / 1000)} s / ${Math.round(p.durationMs / 1000)} s)`),
      bar,
      el('div', 'tiles',
        tile('Visiteurs actifs', count(p.activeUsers), `objectif à cette heure : ${count(p.targetUsers)}`),
        tile('Requêtes / s', p.requestsPerSecond.toLocaleString('fr-FR'), 'sur les 5 dernières secondes'),
        tile('Latence p95', ms(p.p95LastMs), 'sur les 5 dernières secondes'),
        tile('Requêtes envoyées', count(p.requests), `${count(p.pageViews)} pages vues`),
        tile('Erreurs serveur', count(p.errors), `${count(p.clientErrors)} réponses 4xx (normales)`)),
    );
  }

  function renderReport(sim: Simulation) {
    const r = sim.report;
    const s = sim.server;
    if (!r) return results.replaceChildren();
    const t = r.totals;
    const labels = r.hours.map((h) => hourLabel(h.hour));
    const charts = [el('div', 'chart'), el('div', 'chart'), el('div', 'chart')];

    results.replaceChildren(
      el('section', 'card section',
        el('div', 'card-header',
          el('h2', null, `Résultat : ${sim.profileLabel} (${sim.version})`),
          el('p', null, `${sim.durationMinutes} min${r.stopped ? ', arrêtée avant la fin' : ''} · ${r.architecture === 'ssr' ? 'pages rendues par le serveur' : 'SPA (coquille HTML + API)'} · serveur en ${sim.mode ?? 'mode inconnu'}`)),
        sim.mode !== 'production'
          ? el('p', 'error', 'Attention : serveur en mode développement. Les temps ne sont pas comparables à une version en production (npm run build && npm start).')
          : null,
        el('div', 'tiles',
          tile('Requêtes', count(t.requests), `${count(t.pageViews)} pages vues · ${count(t.sessions)} visites`),
          tile('Débit moyen', `${t.requestsPerSecond.toLocaleString('fr-FR')} req/s`, `pic : ${count(t.peakRequestsPerSecond)} req/s`),
          tile('Latence médiane', ms(r.latency.p50), `p95 ${ms(r.latency.p95)} · p99 ${ms(r.latency.p99)}`),
          tile('Latence max', ms(r.latency.max), 'requête la plus lente'),
          tile('Erreurs serveur', percent(t.errorRate), `${count(t.errors)} en 5xx ou réseau · ${count(t.clientErrors)} en 4xx`),
          s && tile('CPU du serveur', percent(s.cpuAvgPercent), `moyenne · max ${percent(s.cpuMaxPercent)}`),
          s && tile('Mémoire du serveur', `${s.rssMaxMb} Mo`, `max (RSS) · ${s.rssStartMb} Mo au départ`),
          s && tile('Boucle d’événements', ms(s.loopP99MaxMs), `retard p99 max · pire ${ms(s.loopMaxMs)}`),
        ),
        el('div', 'grid-2',
          el('section', 'card', el('div', 'card-header', el('h2', null, 'Débit par heure simulée'), el('p', null, 'requêtes par seconde')), charts[0]),
          el('section', 'card', el('div', 'card-header', el('h2', null, 'Latence p95 par heure'), el('p', null, 'page complète et requête seule')), charts[1])),
        el('section', 'card section', el('div', 'card-header', el('h2', null, 'Charge du serveur par heure'), el('p', null, 'CPU (%) et retard de la boucle d’événements (ms)')), charts[2]),
        el('section', 'card section',
          el('div', 'card-header', el('h2', null, 'Temps par page'), el('p', null, 'de la première requête à la dernière réponse')),
          table(
            [{ label: 'Page' }, { label: 'Vues', num: true }, { label: 'Moy.', num: true }, { label: 'p50', num: true }, { label: 'p95', num: true }, { label: 'p99', num: true }, { label: 'Max', num: true }],
            r.pages.map((p) => [p.label, count(p.count), ms(p.avg), ms(p.p50), ms(p.p95), ms(p.p99), ms(p.max)]),
          )),
        el('section', 'card section',
          el('div', 'card-header', el('h2', null, 'Requêtes HTTP'), el('p', null, 'regroupées par route')),
          table(
            [{ label: 'Requête' }, { label: 'Nb', num: true }, { label: 'p50', num: true }, { label: 'p95', num: true }, { label: 'p99', num: true }, { label: 'Max', num: true }, { label: '4xx', num: true }, { label: '5xx', num: true }],
            r.requests.map((q) => [el('code', null, q.label), count(q.count), ms(q.p50), ms(q.p95), ms(q.p99), ms(q.max), count(q.clientErrors), count(q.errors)]),
          )),
        el('section', 'card section',
          el('div', 'card-header', el('h2', null, 'Heure par heure')),
          table(
            [{ label: 'Heure' }, { label: 'Visiteurs', num: true }, { label: 'Req/s', num: true }, { label: 'p95 page', num: true }, { label: 'p95 requête', num: true }, { label: 'Erreurs', num: true }, { label: 'CPU', num: true }, { label: 'RSS', num: true }, { label: 'Boucle p99', num: true }],
            r.hours.map((h) => {
              const server = s?.hours[h.hour];
              return [hourLabel(h.hour), count(h.maxActive), h.requestsPerSecond.toLocaleString('fr-FR'), ms(h.p95PageMs), ms(h.p95RequestMs), count(h.errors),
                server?.cpuPercent == null ? '—' : percent(server.cpuPercent), server?.rssMb == null ? '—' : `${server.rssMb} Mo`, server?.loopP99Ms == null ? '—' : ms(server.loopP99Ms)];
            }),
          )),
        sim.file ? el('p', 'hint', 'Résultat complet enregistré : ', el('code', null, sim.file)) : null,
      ),
    );

    // Les graphiques se dessinent une fois dans la page (largeur connue)
    requestAnimationFrame(() => {
      renderChart(charts[0], { kind: 'column', title: 'Requêtes par seconde, par heure simulée', labels, format: (v) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }),
        series: [{ name: 'Requêtes / s', color: 'var(--series-1)', values: r.hours.map((h) => h.requestsPerSecond) }] });
      renderChart(charts[1], { kind: 'line', title: 'Latence p95 par heure simulée', labels, format: ms,
        series: [
          { name: 'Page complète', color: 'var(--series-2)', values: r.hours.map((h) => (h.requests ? h.p95PageMs : null)) },
          { name: 'Requête', color: 'var(--series-1)', values: r.hours.map((h) => (h.requests ? h.p95RequestMs : null)) },
        ] });
      if (s) renderChart(charts[2], { kind: 'line', title: 'CPU et boucle d’événements par heure simulée', labels, format: (v) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }),
        series: [
          { name: 'CPU (%)', color: 'var(--series-1)', values: s.hours.map((h) => h.cpuPercent) },
          { name: 'Retard de boucle p99 (ms)', color: 'var(--series-3)', values: s.hours.map((h) => h.loopP99Ms) },
        ] });
    });
  }

  // Le rapport n'est redessiné que s'il a changé (le suivi interroge l'API chaque seconde)
  let shownKey = '';
  function render(sim: Simulation) {
    renderStatus(sim);
    const key = sim.report ? `${sim.report.durationMs}-${sim.report.totals.requests}-${sim.file ?? ''}` : '';
    if (key !== shownKey) {
      shownKey = key;
      renderReport(sim);
    }
  }

  async function poll() {
    if (disposed) return;
    try {
      const sim = await call('GET');
      render(sim);
      if (sim.status === 'running') timer = setTimeout(poll, POLL_MS);
    } catch (error) {
      status.replaceChildren(el('p', 'error', (error as Error).message));
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    start.disabled = true;
    try {
      render(await call('POST', { profile: profile.value, durationMinutes: Number(duration.value) }));
      clearTimeout(timer);
      timer = setTimeout(poll, POLL_MS);
    } catch (error) {
      start.disabled = false;
      status.replaceChildren(el('p', 'error', (error as Error).message));
    }
  });
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    await call('DELETE').catch(() => null);
    stop.disabled = false;
  });

  poll();
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}
