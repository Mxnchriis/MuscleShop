// Mini-bibliothèque de graphiques SVG pour l'espace admin (côté navigateur, sans dépendance).
// Règles suivies : barres fines (≤ 24 px) à bout arrondi, lignes de 2 px, grille discrète,
// légende dès 2 séries, infobulle au survol ET au clavier, tableau des données toujours disponible.

export interface ChartSeries {
  name: string;
  color: string; // ex. 'var(--series-1)'
  values: (number | null)[]; // null : pas de donnée (trou dans la courbe)
}

export interface ChartOptions {
  kind: 'column' | 'line';
  title: string; // décrit le graphique (lecteurs d'écran)
  labels: string[];
  series: ChartSeries[];
  format: (value: number) => string;
  stacked?: boolean; // colonnes empilées
  height?: number;
}

const SVG = 'http://www.w3.org/2000/svg';
const MARGIN = { top: 8, right: 12, bottom: 24, left: 52 };
const lastOptions = new WeakMap<HTMLElement, ChartOptions>();
const observed = new WeakSet<HTMLElement>();

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent : les libellés ne sont jamais interprétés comme du HTML
  return node;
}

// Graduations « rondes » : 0, 5, 10, 15… ou 0, 2 000, 4 000…
function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: 1, step: 0.25 };
  const rough = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!;
  return { max: Math.ceil(max / step) * step, step };
}

// Rectangle arrondi en haut (côté donnée), carré sur la ligne de base
function roundedTop(x: number, y: number, width: number, height: number, radius = 4) {
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

export function renderChart(root: HTMLElement, options: ChartOptions) {
  lastOptions.set(root, options);
  if (!observed.has(root)) {
    observed.add(root);
    // Redessine à la bonne largeur quand le conteneur change de taille
    new ResizeObserver(() => draw(root, lastOptions.get(root)!)).observe(root);
  }
  draw(root, options);
}

function draw(root: HTMLElement, options: ChartOptions) {
  const width = Math.max(root.clientWidth, 280);
  const height = options.height ?? 220;
  const { labels, series, format } = options;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const wasOpen = root.querySelector('details')?.open ?? false;
  const display = (value: number | null | undefined) => (value === null || value === undefined ? '—' : format(value));

  // Échelle verticale
  const totals = labels.map((_, i) =>
    options.stacked ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0) : Math.max(...series.map((s) => s.values[i] ?? 0)),
  );
  const scale = niceScale(Math.max(0, ...totals));
  const y = (value: number) => MARGIN.top + plotH - (value / scale.max) * plotH;
  const band = plotW / Math.max(labels.length, 1);
  const xCenter = (i: number) => MARGIN.left + band * i + band / 2;

  const chart = svg('svg', { width, height, role: 'img', 'aria-label': options.title });

  // Grille et graduations (discrètes)
  for (let value = 0; value <= scale.max + 1e-9; value += scale.step) {
    chart.append(svg('line', { x1: MARGIN.left, x2: width - MARGIN.right, y1: y(value), y2: y(value), class: value === 0 ? 'chart-axis' : 'chart-grid' }));
    const tick = svg('text', { x: MARGIN.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-tick' });
    tick.textContent = format(value);
    chart.append(tick);
  }
  // Une étiquette sur « every », comptée depuis la dernière : la plus récente est toujours affichée
  const every = Math.ceil(labels.length / Math.max(1, Math.floor(plotW / 64)));
  labels.forEach((label, i) => {
    if ((labels.length - 1 - i) % every !== 0) return;
    const text = svg('text', { x: xCenter(i), y: height - 6, 'text-anchor': 'middle', class: 'chart-tick' });
    text.textContent = label;
    chart.append(text);
  });

  // Marques
  if (options.kind === 'column') {
    const barW = Math.min(24, band * 0.6);
    labels.forEach((_, i) => {
      let base = 0;
      const drawn = series.filter((s) => (s.values[i] ?? 0) > 0);
      drawn.forEach((s, index) => {
        const value = s.values[i] ?? 0;
        const top = y(base + value);
        const bottom = y(base);
        const gap = index > 0 ? 2 : 0; // 2 px de vide entre segments empilés
        const isTop = index === drawn.length - 1;
        const h = Math.max(0, bottom - top - gap);
        const shape = isTop
          ? svg('path', { d: roundedTop(xCenter(i) - barW / 2, top, barW, h) })
          : svg('rect', { x: xCenter(i) - barW / 2, y: top, width: barW, height: h });
        shape.style.fill = s.color;
        chart.append(shape);
        base += options.stacked ? value : 0;
      });
    });
  } else {
    series.forEach((s) => {
      // Une polyligne par suite de valeurs présentes : les minutes sans donnée restent des trous
      const runs: [number, number][][] = [[]];
      s.values.forEach((value, i) => {
        if (value === null) runs.push([]);
        else runs.at(-1)!.push([xCenter(i), y(value)]);
      });
      for (const points of runs) {
        if (points.length === 1) {
          const point = svg('circle', { cx: points[0][0], cy: points[0][1], r: 2 });
          point.style.fill = s.color;
          chart.append(point);
        } else if (points.length > 1) {
          const line = svg('polyline', { points: points.map((p) => p.join(',')).join(' '), fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
          line.style.stroke = s.color;
          chart.append(line);
        }
      }
      const last = s.values.findLastIndex((value) => value !== null);
      if (last >= 0) {
        const dot = svg('circle', { cx: xCenter(last), cy: y(s.values[last]!), r: 4, 'stroke-width': 2, class: 'chart-dot' });
        dot.style.fill = s.color;
        chart.append(dot);
      }
    });
  }

  // Couche de survol : une zone par position X (plus large que la marque), focusable au clavier
  const crosshair = svg('line', { y1: MARGIN.top, y2: MARGIN.top + plotH, class: 'chart-crosshair', visibility: 'hidden' });
  chart.append(crosshair);
  const tooltip = html('div', 'chart-tooltip');
  tooltip.hidden = true;

  const show = (i: number) => {
    tooltip.replaceChildren(html('div', 'chart-tooltip-title', labels[i]));
    for (const s of series) {
      const row = html('div', 'chart-tooltip-row');
      const key = html('span', 'chart-key');
      key.style.background = s.color;
      row.append(key, html('strong', undefined, display(s.values[i])), html('span', undefined, s.name));
      tooltip.append(row);
    }
    tooltip.hidden = false;
    const left = Math.min(Math.max(xCenter(i) + 12, 0), width - 180);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${MARGIN.top}px`;
    crosshair.setAttribute('x1', String(xCenter(i)));
    crosshair.setAttribute('x2', String(xCenter(i)));
    crosshair.setAttribute('visibility', options.kind === 'line' ? 'visible' : 'hidden');
  };
  const hide = () => {
    tooltip.hidden = true;
    crosshair.setAttribute('visibility', 'hidden');
  };

  labels.forEach((label, i) => {
    const hit = svg('rect', { x: MARGIN.left + band * i, y: MARGIN.top, width: band, height: plotH, class: 'chart-hit', tabindex: 0 });
    hit.setAttribute('aria-label', `${label} : ${series.map((s) => `${s.name} ${display(s.values[i])}`).join(', ')}`);
    hit.addEventListener('pointerenter', () => show(i));
    hit.addEventListener('focus', () => show(i));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    chart.append(hit);
  });

  // Légende (dès 2 séries) : la couleur n'est jamais le seul repère
  const parts: HTMLElement[] = [];
  if (series.length > 1) {
    const legend = html('div', 'chart-legend');
    for (const s of series) {
      const item = html('span', 'chart-legend-item');
      const key = html('span', options.kind === 'line' ? 'chart-key chart-key-line' : 'chart-key');
      key.style.background = s.color;
      item.append(key, document.createTextNode(s.name));
      legend.append(item);
    }
    parts.push(legend);
  }

  const plot = html('div', 'chart-plot');
  plot.append(chart, tooltip);
  parts.push(plot);

  // Tableau des données : accessible sans survol
  const details = html('details', 'chart-data');
  details.open = wasOpen;
  details.append(html('summary', undefined, 'Voir les données'));
  const table = html('table');
  const head = html('tr');
  head.append(html('th', undefined, ''), ...series.map((s) => html('th', undefined, s.name)));
  table.append(head);
  labels.forEach((label, i) => {
    const row = html('tr');
    row.append(html('td', undefined, label), ...series.map((s) => html('td', undefined, display(s.values[i]))));
    table.append(row);
  });
  details.append(table);
  parts.push(details);

  root.replaceChildren(...parts);
}
