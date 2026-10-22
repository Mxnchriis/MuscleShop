# Analyse : Astro + Hono

> Document de travail pour le rapport TechLab, complété au fil du projet.
> Mesures réalisées le 20/10/2026 (voir la section Benchmarks pour la méthode).

## Contexte

**Objectif de l'étude :** évaluer la combinaison **Astro**, framework orienté contenu et rendu serveur, et **Hono**, framework d'API léger basé sur les standards Web, pour construire une application complète. La question principale : jusqu'où ces deux outils peuvent-ils cohabiter dans un seul projet, et à quel prix ?

**Cas d'usage :** MuscleShop, une boutique de compléments alimentaires sportifs. Elle couvre les besoins classiques d'un e-commerce : catalogue (28 produits, 7 catégories), recherche et filtres, panier, comptes utilisateurs, commande et paiement Stripe en mode test, historique des commandes.

**Pile technique :**

| Rôle | Outil | Version |
| --- | --- | --- |
| Pages, rendu serveur | Astro + `@astrojs/node` | 7.3 / 11.1 |
| API REST | Hono + `@hono/zod-validator` | 4.13 / 0.9 |
| Validation | Zod | 4.6 |
| Base de données | SQLite (`better-sqlite3`) + Drizzle ORM | 13.0 / 0.45 |
| Paiement | Stripe (Checkout) | SDK 23.0 |
| Tests | Vitest | 5.0 |
| Exécution | Node.js | 22.22 |

## Intégration (route catch-all `/api/[...path].ts`)

### Principe

Un seul projet Astro, en mode `output: 'server'`, avec Hono monté sur `/api`. L'intégration tient en une route Astro « attrape-tout » :

```ts
// src/pages/api/[...path].ts
export const prerender = false;
export const ALL: APIRoute = ({ request }) => app.fetch(request);
```

Il n'y a ni adaptateur ni conversion : Astro et Hono manipulent tous les deux les objets standards du Web, `Request` et `Response`. Astro reçoit toutes les requêtes, rend les pages et confie celles qui commencent par `/api` à Hono.

```
Navigateur ─► Node.js (serveur Astro)
                ├─ /produits, /panier…  → pages .astro → HTML
                └─ /api/*  → [...path].ts → app.fetch() → Hono → services → SQLite
```

### Séparation des responsabilités

- **`src/pages/`, `src/components/`** : Astro (HTML, mise en page, îlots interactifs).
- **`src/server/`** : Hono (routes, validation Zod, middlewares, logique métier, base de données). Ce dossier **n'importe rien d'Astro** : il peut être extrait tel quel.
- **`src/types/`** : types partagés entre les deux.

### Communication entre pages et API

| Appelant | Mécanisme |
| --- | --- |
| Navigateur (îlots) | `fetch('/api/…')`, en HTTP |
| Pages Astro (rendu serveur) | Client RPC Hono `hc<AppType>`, avec `fetch` remplacé par `app.request()` : appel dans le même processus, sans réseau |

Le client RPC tire ses types du type `AppType` exporté par l'application Hono. Les pages Astro bénéficient ainsi de l'autocomplétion sur les routes, les paramètres et les réponses, sans générer de code ni écrire de schéma OpenAPI.

## Bénéfices observés

### 1. Une intégration minimale et lisible

- **Taille :** la jonction tient en **3 lignes**.
- **Déploiement :** un seul serveur, un seul `npm run dev`, un seul déploiement.
- **Pas de CORS :** pages et API partagent le même domaine.
- **Pas d'échange de jetons entre deux applications :** les cookies du panier et de la session sont communs.

### 2. Un typage de bout en bout, sans générateur

Une modification d'une route Hono est immédiatement visible dans les pages Astro. Exemple concret rencontré pendant le développement : quand une route a reçu un validateur Zod, le client RPC a ajouté la réponse d'erreur 400 au type de retour. `astro check` a alors signalé les pages qui lisaient la réponse sans vérifier `res.ok`. **Le compilateur a forcé la gestion des erreurs.**

### 3. Le back-end se teste sans serveur

`app.request()` permet d'appeler l'API comme une fonction. Les **38 tests** de l'API ne démarrent aucun serveur HTTP, et s'exécutent en **3,5 s au total**, en comptant la recréation complète de la base de test (schéma et données). Les dépendances externes se remplacent facilement : Stripe est simulé avec `vi.mock` sur un seul module.

### 4. Très peu de JavaScript côté client

Grâce à l'architecture en îlots d'Astro, seuls 3 composants (ajout au panier, formulaire de connexion, actions sur une commande) envoient du JavaScript. Ces scripts, petits, sont intégrés au HTML par Astro, sans aucun fichier `.js` séparé dans le build. Le détail est donné dans la section Benchmarks.

### 5. Une API découplée, prête à être extraite

`src/server/` ne dépend pas d'Astro. Pour passer à une API séparée (voir l'alternative monorepo), il suffit de :

1. démarrer Hono seul avec `@hono/node-server` ;
2. retirer l'option `fetch` du client RPC, qui repasse alors en HTTP.

Aucune route ni aucune page n'est à réécrire.

### 6. Une logique partagée entre les deux middlewares

Le middleware Astro (`src/middleware.ts`), qui donne aux pages l'utilisateur connecté et la taille du panier, et le middleware Hono (`requireAuth`) réutilisent les mêmes fonctions de `src/server/services/`. La vérification du JWT n'est écrite qu'une fois.

### 7. Une instrumentation commune, sans outil externe

Comme Astro et Hono partagent le processus, leurs deux middlewares alimentent **le même module de mesures en mémoire** (`src/server/services/metrics.ts`) :

- le middleware Astro chronomètre les pages, par gabarit `Astro.routePattern` ;
- le middleware Hono chronomètre les routes, par gabarit `routePath()` ;
- le client RPC compte les appels internes faits pendant le rendu.

On obtient, pour chaque page, la part du temps passée dans Hono et celle passée dans Astro. L'en-tête standard `Server-Timing` expose ces durées dans les outils de développement du navigateur. Le panel admin (`/admin/performance`) affiche le tout en direct, avec un benchmark intégré. Aucun service externe (APM, OpenTelemetry) n'a été nécessaire.

## Limites observées

### 1. Variables d'environnement : une friction liée à Vite

Astro, via Vite, ne charge `.env` que dans `import.meta.env`, qui n'existe que dans le code passé par Vite. Or le code Hono doit aussi tourner hors d'Astro : tests Vitest, script de seed (`tsx`), `drizzle-kit`, et production (`node dist/server/entry.mjs`, qui ne lit pas `.env`).

**Solution retenue :** `process.loadEnvFile()`, intégré à Node, dans `src/server/env.ts`. **Alternatives :** `node --env-file`, `dotenv`, ou `astro:env`, ce dernier étant inaccessible hors de Vite. La friction est mineure, ne vient pas de Hono, et se règle en une ligne. Il faut cependant la connaître dès le départ.

### 2. Deux middlewares et deux systèmes de « contexte »

Astro (`Astro.locals`) et Hono (`c.get('user')`) ont chacun leur middleware et leur contexte de requête. Ils ne se partagent pas automatiquement : la session est lue deux fois, une fois par chaque middleware. C'est acceptable, puisque les fonctions sont communes, mais c'est une duplication de structure.

### 3. Les cookies ne traversent pas seuls les appels internes

Quand une page Astro appelle l'API par le client RPC, les cookies du visiteur ne sont pas transmis par défaut : il faut les passer explicitement (`headers: { cookie }`). À l'inverse, un cookie posé par Hono pendant un appel interne n'atteint pas le navigateur. C'est pourquoi la page de confirmation vide le panier avec `Astro.cookies`, et non par un appel API.

### 4. Le client RPC a ses contraintes de typage

- **Paramètres d'URL en texte :** les paramètres de requête circulent en texte (`limit: '4'`, `promo: 'true'`). On a choisi des conversions explicites dans les validateurs Zod (`z.stringbool()`, `transform(Number)`), pour que le client RPC attende bien des chaînes en entrée et que l'API reçoive des nombres et des booléens.
- **Valeurs venues de l'URL :** une valeur lue dans l'URL d'une page doit parfois être validée dans la page avant d'être passée au client typé. C'est le cas du paramètre `sort` du catalogue, qui n'accepte que `name`, `best-sellers` ou `newest`.

### 5. Le SSR est obligatoire

L'API impose `output: 'server'` : toutes les pages sont rendues à la demande. Les pages qui pourraient être statiques, comme les fiches produits, doivent être explicitement pré-rendues si on veut un site hybride. On perd par défaut une partie de l'intérêt d'Astro pour les sites de contenu.

### 6. Protection CSRF d'Astro

Astro bloque les `POST` sans en-tête `Origin` correspondant. C'est une bonne chose en production, mais déroutant lors des tests manuels avec `curl` : le message « Cross-site POST form submissions are forbidden » vient d'Astro, pas de Hono. Il n'apparaît pas avec `app.request()` dans les tests, qui ne passent pas par Astro.

### 7. Mesures en mémoire, propres à un processus

Les mesures du panel vivent en mémoire : elles disparaissent au redémarrage, et ne seraient pas agrégées si l'application tournait sur plusieurs processus ou serveurs. Pour la production réelle, il faudrait les exporter (OpenTelemetry, Prometheus). L'en-tête `Server-Timing` et le découpage par gabarit de route resteraient utiles.

## Benchmarks

### Méthode

- **Machine et build :** portable sous Linux, Node.js 22.22.1, **build de production** (`npm run build`, puis `node dist/server/entry.mjs`).
- **Base :** SQLite locale, 28 produits.
- **Mesure :** pour chaque URL, 30 requêtes d'échauffement, puis 300 requêtes successives (latence moyenne, médiane, 95e centile), puis 300 requêtes avec 10 en parallèle (débit).
- **Limites :** une seule série de mesures, en local (client et serveur sur la même machine). Les ordres de grandeur sont significatifs, mais les valeurs exactes dépendent de la machine.

### 1. Appel interne (`app.request`) ou appel HTTP depuis les pages

Seule différence entre les deux builds : l'option `fetch: app.request` du client RPC (`src/lib/api.ts`).

| Page | Mode | Latence moyenne | Médiane | 95e centile | Débit (10 en parallèle) |
| --- | --- | --- | --- | --- | --- |
| `/produits` (1 appel API) | HTTP | 2,69 ms | 2,36 ms | 4,98 ms | 560 req/s |
| | **Interne** | **1,70 ms** | **1,55 ms** | **2,66 ms** | **814 req/s** |
| `/` accueil (4 appels API) | HTTP | 4,44 ms | 4,08 ms | 6,46 ms | 300 req/s |
| | **Interne** | **2,41 ms** | **2,14 ms** | **3,91 ms** | **540 req/s** |

**Lecture :** l'appel interne réduit la latence de **37 %** sur le catalogue et de **46 %** sur l'accueil. Il augmente le débit de **45 %** et de **80 %**. Le gain croît avec le nombre d'appels API par page. Chaque appel HTTP local coûte environ 0,5 ms (connexion, sérialisation de la requête, passage dans la pile HTTP d'Astro).

### 2. Coût de l'API seule

| Route | Latence moyenne | Médiane | 95e centile | Débit (10 en parallèle) |
| --- | --- | --- | --- | --- |
| `GET /api/health` (sans base) | 0,68 ms | 0,61 ms | 0,98 ms | 2 661 req/s |
| `GET /api/products` (28 produits, avec jointure) | 1,08 ms | 0,97 ms | 1,74 ms | 1 370 req/s |

**Lecture :** le passage Astro → Hono ajoute très peu. Une requête complète vers `/api/health`, qui traverse Astro, la route attrape-tout et Hono, reste sous la milliseconde.

### 3. Poids des pages envoyées au navigateur

| Page | JavaScript (intégré au HTML) | HTML | HTML compressé (gzip) |
| --- | --- | --- | --- |
| `/` accueil (12 produits) | 724 o | 18,4 Ko | 3,6 Ko |
| `/produits` (28 produits) | 724 o | 23,1 Ko | 3,1 Ko |
| `/produits/whey-chocolat-1kg` | 724 o | 4,9 Ko | 1,9 Ko |
| `/panier` (vide) | 145 o | 3,3 Ko | 1,3 Ko |
| `/compte/connexion` | 640 o | 3,5 Ko | 1,6 Ko |

**Lecture :** **moins de 1 Ko de JavaScript par page**, et aucun framework côté client. Le build serveur complet pèse 612 Ko.

### 4. Tests

| Indicateur | Valeur |
| --- | --- |
| Nombre de tests de l'API | 51 (38 lors de la première mesure) |
| Durée totale de `npm test` | 3,8 s |
| Dont exécution des tests | ≈ 44 % |
| Dont préparation (recréation de `test.db`, import, transformation) | ≈ 56 % |
| Serveur HTTP démarré | aucun |

### 5. Mesures du panel de performance (build de production)

**Contexte :** mesures prises le 22/10/2026 avec le panel `/admin/performance` (`npm start`, `NODE_ENV=production`), sur environ 400 requêtes de navigation, puis avec le benchmark intégré (300 requêtes en série par mode, après 5 d'échauffement).

**Benchmark : la même route appelée en interne (Hono seul) et en HTTP (Node → Astro → Hono)**

| Cible | Mode | Médiane | p95 | Débit (en série) |
| --- | --- | --- | --- | --- |
| `GET /api/health` | Interne | 0,04 ms | 0,07 ms | 23 801 req/s |
| | HTTP | 0,67 ms | 1,02 ms | 1 395 req/s |
| `GET /api/products` (28 produits) | Interne | 0,36 ms | 0,60 ms | 2 507 req/s |
| | HTTP | 1,00 ms | 2,08 ms | 870 req/s |
| Page d'accueil (4 appels API) | HTTP | 2,08 ms | 3,29 ms | 438 req/s |

**Surcoût d'Astro sur `/api`** (durée totale mesurée par Astro moins la durée annoncée par Hono, 51 appels) : médiane **0,08 ms**, moyenne 0,15 ms, p95 0,19 ms.

**Répartition du temps des pages** (moyennes) :

| Page | Appels API | Temps Hono | Temps Astro | Part de Hono |
| --- | --- | --- | --- | --- |
| `/` | 4 | 2,22 ms | 0,83 ms | 73 % |
| `/categories/[slug]` | 1 | 0,84 ms | 0,51 ms | 62 % |
| `/produits` | 1 | 0,77 ms | 0,57 ms | 57 % |
| `/produits/[slug]` | 1 | 0,52 ms | 0,45 ms | 54 % |

**Lecture :**

- **Ce n'est pas Astro qui coûte cher.** Sur `/api/health`, l'appel HTTP prend environ 0,63 ms de plus que l'appel interne, mais seulement 0,08 à 0,15 ms viennent d'Astro (middleware et route attrape-tout). Le reste, environ 0,5 ms, est le coût de la pile HTTP de Node et de l'aller-retour local. Monter Hono derrière Astro est donc presque gratuit. C'est l'appel HTTP qui coûte, d'où l'intérêt de `app.request` pour les pages.
- **Le rendu Astro est léger.** Sur toutes les pages, le temps est dominé par Hono, c'est-à-dire par les requêtes SQLite, et non par la génération du HTML. Pour accélérer l'accueil, il faudrait d'abord optimiser ou mettre en cache ses 4 appels API.
- **Hono seul est extrêmement rapide** : 0,04 ms pour une route sans base. Le framework est négligeable devant le moindre accès aux données.

### À compléter

- [ ] Répéter les mesures (plusieurs séries) et indiquer l'écart-type. Le benchmark du panel admin permet de les relancer en un clic.
- [ ] Comparer avec une API Hono séparée (`@hono/node-server`) appelée en HTTP : c'est le coût réel du monorepo.
- [ ] Mesurer le temps de démarrage à froid (`npm start` jusqu'à la première réponse).
- [ ] Lighthouse sur l'accueil et le catalogue (performance, accessibilité).

## Alternative : monorepo (`apps/web` + `apps/api`)

### Principe

Deux applications distinctes dans un même dépôt :

- `apps/api` : Hono seul (`@hono/node-server`, ou Cloudflare Workers, Bun, Deno) ;
- `apps/web` : Astro, qui appelle l'API en HTTP ;
- un paquet partagé `packages/types`, ou l'export de `AppType`, pour garder le client RPC typé.

### Comparaison

| Critère | Projet unique (choix actuel) | Monorepo |
| --- | --- | --- |
| Mise en place | Immédiate (3 lignes) | Outil de workspace (npm/pnpm workspaces, Turborepo), 2 configurations |
| Déploiement | 1 serveur | 2 services à déployer et superviser |
| Appels des pages vers l'API | Internes, sans réseau (−46 % de latence sur l'accueil) | HTTP obligatoire |
| Cookies, session | Partagés naturellement | Domaine commun ou CORS et cookies inter-domaines à configurer |
| Typage RPC | Direct (`import type { AppType }`) | Possible, via un paquet partagé |
| Mise à l'échelle | Pages et API montent en charge ensemble | Chaque partie monte en charge séparément |
| API consommée par d'autres clients (app mobile…) | Possible, mais liée au cycle de vie du site | Naturel |
| Choix du runtime de l'API | Celui d'Astro (Node) | Libre (Workers, Bun…), l'un des atouts de Hono |

### Quand basculer ?

Le projet unique convient tant que l'API ne sert que le site. Le monorepo devient pertinent dans trois cas :

1. une application mobile ou un partenaire consomme l'API ;
2. l'API doit être déployée en périphérie, par exemple sur Cloudflare Workers ;
3. les équipes front et back livrent à des rythmes différents.

Grâce au découplage de `src/server/`, la bascule reste peu coûteuse : on déplace le dossier et on retire l'option `fetch` du client RPC.

## Conclusion (provisoire)

Astro et Hono se combinent avec **très peu de friction**, parce qu'ils reposent tous les deux sur les standards Web `Request` et `Response`. L'intégration tient en 3 lignes, et le typage traverse la frontière entre front et back sans outil supplémentaire. Le back-end reste indépendant et testable sans serveur.

Les principaux points d'attention sont la gestion des variables d'environnement hors de Vite, la transmission explicite des cookies dans les appels internes, et l'obligation de rendu serveur.

Choisir l'appel interne (`app.request`) plutôt que HTTP pour les pages est la décision qui pèse le plus sur les performances : **jusqu'à 1,8 fois plus rapide** sur l'accueil, sans sacrifier la possibilité d'extraire l'API plus tard.

Les mesures fines du panel de performance le confirment : le surcoût propre à Astro autour de Hono est inférieur à 0,2 ms. Le temps des pages est dominé par l'accès aux données, pas par l'un ou l'autre framework.
