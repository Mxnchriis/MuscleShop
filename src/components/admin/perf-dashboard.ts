// Tableau de bord de performance (navigateur). Données : GET /api/admin/metrics,
// alimenté par les middlewares Astro (pages) et Hono (API) qui partagent le même processus.
import { renderChart } from '../../lib/charts';
import { chartFormats } from '../../lib/admin';
import type { getMetricsReport, MetricSource } from '../../server/services/metrics';
import type { getSystemReport } from '../../server/services/system';
import type { benchmarkTargets, runBenchmark } from '../../server/services/benchmark';

export type PerfData = { report: ReturnType<typeof getMetricsReport>; system: ReturnType<typeof getSystemReport> };
type Targets = typeof benchmarkTargets;
type BenchmarkResult = Awaited<ReturnType<typeof runBenchmark>>;

const ms = chartFormats.ms;
const count = chartFormats.count;
const REFRESH_MS = 5000;

const sources: Record<MetricSource, { label: string; color: string }> = {
  page: { label: 'Page Astro', color: 'var(--series-1)' },
  'api-http': { label: 'API · HTTP', color: 'var(--series-2)' },
  'api-internal': { label: 'API · interne', color: 'var(--series-3)' },
};

// --- Petits outils DOM (textContent : aucune donnée n'est interprétée comme du HTML) ---

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string | null, ...children: (Node | string | null | undefined)[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

function key(color: string) {
  const swatch = el('span', 'chart-key');
  swatch.style.background = color;
  return swatch;
}

function sourceCell(source: MetricSource) {
  return el('span', 'source', key(sources[source].color), sources[source].label);
}

function table(headers: { label: string; num?: boolean }[], rows: (Node | string)[][], empty = 'Aucune donnée pour l’instant.') {
  if (rows.length === 0) return el('p', 'hint', empty);
  const head = el('tr', null, ...headers.map((h) => el('th', h.num ? 'num' : null, h.label)));
  const body = rows.map((cells) => el('tr', null, ...cells.map((cell, i) => el('td', headers[i]?.num ? 'num' : null, cell))));
  return el('div', 'table-scroll', el('table', 'data', el('thead', null, head), el('tbody', null, ...body)));
}

function tile(label: string, value: string, hint?: string) {
  return el('div', 'tile', el('div', 'tile-label', label), el('div', 'tile-value', value), hint ? el('div', 'tile-hint', hint) : null);
}

function definitionList(entries: [string, string][]) {
  return el('dl', 'facts', ...entries.flatMap(([term, value]) => [el('dt', null, term), el('dd', null, value)]));
}

const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const minute = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${seconds % 60} s` : `${seconds} s`;
}

// --- Rendu ---

function render(root: HTMLElement, { report, system }: PerfData) {
  const $ = (selector: string) => root.querySelector<HTMLElement>(selector)!;
  const { summary } = report;

  $('[data-updated]').textContent = `Mis à jour à ${time.format(new Date())}`;
  $('[data-mode]').hidden = system.process.mode === 'production';

  $('[data-tiles]').replaceChildren(
    tile(`Requêtes (${report.windowMinutes} min)`, count(summary.count), `${count(summary.requestsLastMinute)} dans la dernière minute`),
    tile('Latence médiane', ms(summary.p50), `p95 ${ms(summary.p95)} · p99 ${ms(summary.p99)}`),
    tile('Page Astro (médiane)', ms(summary.bySource.page.p50), `${count(summary.bySource.page.count)} pages · p95 ${ms(summary.bySource.page.p95)}`),
    tile('API interne (médiane)', ms(summary.bySource['api-internal'].p50), `${count(summary.bySource['api-internal'].count)} appels depuis les pages`),
    tile('API HTTP (médiane)', ms(summary.bySource['api-http'].p50), `${count(summary.bySource['api-http'].count)} appels du navigateur`),
    tile('Surcoût Astro sur /api', ms(report.astroOverhead.avg), `moyenne · p95 ${ms(report.astroOverhead.p95)} (${count(report.astroOverhead.count)} mesures)`),
    tile('Erreurs serveur (5xx)', `${summary.errorRate.toLocaleString('fr-FR')} %`, `${count(summary.statusClasses['4xx'])} réponses 4xx (client)`),
    tile('Boucle d’événements', `${system.eventLoop.utilizationPercent.toLocaleString('fr-FR')} %`, `retard p99 ${ms(system.eventLoop.delayP99Ms)}`),
  );

  const labels = report.timeline.map((point) => minute.format(new Date(point.minute)));
  renderChart($('[data-chart-requests]'), {
    kind: 'column',
    stacked: true,
    title: 'Requêtes par minute, par source',
    labels,
    format: count,
    series: (Object.keys(sources) as MetricSource[]).map((source) => ({
      name: sources[source].label,
      color: sources[source].color,
      values: report.timeline.map((point) => point.counts[source] ?? 0),
    })),
  });
  renderChart($('[data-chart-latency]'), {
    kind: 'line',
    title: 'Latence p95 par minute : pages Astro et API Hono',
    labels,
    format: ms,
    series: [
      { name: 'Pages Astro', color: sources.page.color, values: report.timeline.map((point) => point.p95Page) },
      { name: 'API Hono', color: sources['api-http'].color, values: report.timeline.map((point) => point.p95Api) },
    ],
  });

  // Répartition du temps d'une page : Hono (appels internes) / Astro (rendu + middleware)
  const pages = report.routes.filter((route) => route.source === 'page');
  $('[data-split]').replaceChildren(
    table(
      [
        { label: 'Page' },
        { label: 'Requêtes', num: true },
        { label: 'p50', num: true },
        { label: 'p95', num: true },
        { label: 'Appels API', num: true },
        { label: 'Hono (moy.)', num: true },
        { label: 'Astro (moy.)', num: true },
        { label: 'Répartition' },
      ],
      pages.map((page) => {
        const hono = page.avgApiMs ?? 0;
        const astro = Math.max(0, page.avgRenderMs ?? 0);
        const honoShare = hono + astro ? (hono / (hono + astro)) * 100 : 0;
        const bar = el('div', 'split-bar', el('span', null), el('span', null));
        const [honoPart, astroPart] = bar.children as HTMLCollectionOf<HTMLElement>;
        honoPart.style.width = `${honoShare}%`;
        honoPart.style.background = sources['api-internal'].color;
        astroPart.style.width = `${100 - honoShare}%`;
        astroPart.style.background = sources.page.color;
        bar.title = `Hono ${Math.round(honoShare)} % · Astro ${Math.round(100 - honoShare)} %`;
        return [
          el('code', null, page.route),
          count(page.count),
          ms(page.p50),
          ms(page.p95),
          (page.avgApiCalls ?? 0).toLocaleString('fr-FR'),
          ms(hono),
          ms(astro),
          el('div', 'split-cell', bar, `${Math.round(honoShare)} %`),
        ];
      }),
      'Aucune page visitée dans la fenêtre : naviguez sur la boutique pour générer des mesures.',
    ),
  );

  $('[data-routes]').replaceChildren(
    table(
      [
        { label: 'Source' },
        { label: 'Méthode' },
        { label: 'Route' },
        { label: 'Req.', num: true },
        { label: 'Moy.', num: true },
        { label: 'p50', num: true },
        { label: 'p95', num: true },
        { label: 'p99', num: true },
        { label: 'Max', num: true },
        { label: '4xx', num: true },
        { label: '5xx', num: true },
      ],
      report.routes.map((route) => [
        sourceCell(route.source),
        route.method,
        el('code', null, route.route),
        count(route.count),
        ms(route.avg),
        ms(route.p50),
        ms(route.p95),
        ms(route.p99),
        ms(route.max),
        count(route.clientErrors),
        count(route.errors),
      ]),
    ),
  );

  const requestRows = (entries: PerfData['report']['latest']) =>
    entries.map((entry) => [
      time.format(new Date(entry.at)),
      sourceCell(entry.source),
      entry.method,
      el('code', null, entry.path),
      String(entry.status),
      ms(entry.durationMs),
      entry.apiMs === undefined ? '' : `${ms(entry.apiMs)} (${entry.apiCalls})`,
    ]);
  const requestHeaders = [
    { label: 'Heure' },
    { label: 'Source' },
    { label: 'Méthode' },
    { label: 'Chemin' },
    { label: 'Statut', num: true },
    { label: 'Durée', num: true },
    { label: 'dont Hono (appels)', num: true },
  ];
  $('[data-slowest]').replaceChildren(table(requestHeaders, requestRows(report.slowest)));
  $('[data-latest]').replaceChildren(table(requestHeaders, requestRows(report.latest)));

  const p = system.process;
  const db = system.database;
  $('[data-system]').replaceChildren(
    el('section', 'card', el('h2', null, 'Processus Node'), definitionList([
      ['Mode', p.mode],
      ['Node.js', p.node],
      ['Plateforme', p.platform],
      ['PID', String(p.pid)],
      ['Démarré depuis', duration(p.uptimeSeconds)],
      ['CPU du processus', `${p.cpuPercent.toLocaleString('fr-FR')} %`],
      ['Mémoire (RSS)', `${p.memory.rssMb} Mo`],
      ['Tas JS utilisé / alloué', `${p.memory.heapUsedMb} / ${p.memory.heapTotalMb} Mo`],
    ])),
    el('section', 'card', el('h2', null, 'Boucle d’événements'), definitionList([
      ['Utilisation', `${system.eventLoop.utilizationPercent.toLocaleString('fr-FR')} %`],
      ['Retard médian', ms(system.eventLoop.delayP50Ms)],
      ['Retard p99', ms(system.eventLoop.delayP99Ms)],
      ['Retard max', ms(system.eventLoop.delayMaxMs)],
    ]), el('p', 'hint', 'Un retard élevé signifie qu’un traitement synchrone bloque toutes les requêtes.')),
    el('section', 'card', el('h2', null, 'Machine'), definitionList([
      ['Processeurs', `${system.os.cpus} × ${system.os.cpuModel}`],
      ['Charge (1 / 5 / 15 min)', system.os.loadAverage.map((v) => v.toLocaleString('fr-FR')).join(' / ')],
      ['Mémoire libre', `${count(system.os.freeMemoryMb)} / ${count(system.os.totalMemoryMb)} Mo`],
    ])),
    el('section', 'card', el('h2', null, 'Base de données'), definitionList([
      ['Moteur', `${db.engine} ${db.version}`],
      ['Fichier', `${db.file} (${count(db.sizeKb)} Ko)`],
      ['Produits / catégories', `${db.rows.products} / ${db.rows.categories}`],
      ['Utilisateurs', String(db.rows.users)],
      ['Commandes / lignes', `${db.rows.orders} / ${db.rows.orderItems}`],
    ])),
    el('section', 'card', el('h2', null, 'Versions'), definitionList(Object.entries(system.versions))),
    el('section', 'card', el('h2', null, 'Collecte'), definitionList([
      ['Mesures en mémoire', `${count(report.stored)} / ${count(report.capacity)}`],
      ['Depuis', new Date(report.collectingSince).toLocaleString('fr-FR')],
      ['Fenêtre affichée', `${report.windowMinutes} min`],
    ])),
  );
}

function renderBenchmark(container: HTMLElement, result: BenchmarkResult) {
  const colors: Record<string, string> = { internal: sources['api-internal'].color, http: sources['api-http'].color };
  const maxP50 = Math.max(...result.results.map((r) => r.p50), 0.001);

  const rows = result.results.map((r) => {
    const bar = el('span', 'bench-bar');
    bar.style.width = `${(r.p50 / maxP50) * 100}%`;
    bar.style.background = colors[r.mode];
    return [el('span', 'source', key(colors[r.mode]), r.label), ms(r.avg), ms(r.p50), ms(r.p95), ms(r.p99), ms(r.max), count(r.requestsPerSecond), el('div', 'bench-track', bar)];
  });

  const internal = result.results.find((r) => r.mode === 'internal');
  const http = result.results.find((r) => r.mode === 'http');
  const conclusion = internal && http
    ? `Médiane : HTTP ${ms(http.p50)} contre ${ms(internal.p50)} en appel interne, soit ${(http.p50 / internal.p50).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} fois plus. ` +
      `L'écart (${ms(http.p50 - internal.p50)}) est le coût de la pile HTTP de Node et de la traversée d'Astro (middleware + route attrape-tout).`
    : `Médiane ${ms(http!.p50)} pour ${result.label.toLowerCase()} : temps complet vu par un visiteur (Node → Astro → Hono → rendu HTML).`;

  container.replaceChildren(
    el('p', 'hint', `${result.label} · ${result.path} · ${count(result.iterations)} requêtes par mode, en série`),
    table(
      [{ label: 'Mode' }, { label: 'Moy.', num: true }, { label: 'p50', num: true }, { label: 'p95', num: true }, { label: 'p99', num: true }, { label: 'Max', num: true }, { label: 'Req/s', num: true }, { label: 'p50 comparé' }],
      rows,
    ),
    el('p', 'bench-conclusion', conclusion),
  );
}

// --- Initialisation ---

export function initPerfDashboard(root: HTMLElement, initial: PerfData, targets: Targets) {
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  let windowMinutes = initial.report.windowMinutes;
  let timer: ReturnType<typeof setInterval> | undefined;

  render(root, initial);

  async function refresh() {
    root.classList.add('is-loading'); // l'affichage précédent reste visible, atténué
    try {
      const res = await fetch(`/api/admin/metrics?window=${windowMinutes}`);
      if (res.ok) render(root, await res.json());
    } finally {
      root.classList.remove('is-loading');
    }
  }

  const auto = $<HTMLInputElement>('[data-auto]');
  const schedule = () => {
    clearInterval(timer);
    if (auto.checked) timer = setInterval(refresh, REFRESH_MS);
  };
  auto.addEventListener('change', schedule);
  schedule();

  $<HTMLSelectElement>('[data-window]').addEventListener('change', (event) => {
    windowMinutes = Number((event.target as HTMLSelectElement).value);
    refresh();
  });
  $('[data-refresh]').addEventListener('click', refresh);
  $('[data-reset]').addEventListener('click', async () => {
    if (!confirm('Effacer toutes les mesures collectées ?')) return;
    await fetch('/api/admin/metrics', { method: 'DELETE' });
    refresh();
  });

  // Benchmark
  const form = $<HTMLFormElement>('[data-bench-form]');
  const select = form.querySelector('select')!;
  for (const [id, target] of Object.entries(targets)) select.append(new Option(`${target.label} (${target.path})`, id));
  const output = $('[data-bench-results]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button')!;
    const data = new FormData(form);
    button.disabled = true;
    output.replaceChildren(el('p', 'hint', 'Mesure en cours…'));
    try {
      const res = await fetch('/api/admin/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: data.get('target'), iterations: Number(data.get('iterations')) }),
      });
      const body = await res.json();
      if (res.ok) renderBenchmark(output, body);
      else output.replaceChildren(el('p', 'error', body.error ?? 'Benchmark impossible (paramètres invalides ?)'));
    } catch {
      output.replaceChildren(el('p', 'error', 'Le benchmark a échoué.'));
    } finally {
      button.disabled = false;
    }
  });
}
