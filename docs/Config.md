# Configuration du projet MuscleShop

Ce document explique comment le projet a été initialisé : le dépôt Git, les dépendances installées, les fichiers de configuration et le code de départ. L'organisation des dossiers est décrite dans [`arborescence.md`](arborescence.md).

---

## 1. Dépôt Git

Le dépôt local avait déjà le remote `origin` (`git@github.com:Mxnchriis/MuscleShop.git`) et la branche `main`, mais **aucun commit**. Un `git push` aurait donc échoué (`src refspec main does not match any`).

Ce qui a été fait :

```bash
echo "# MuscleShop" > README.md
git add README.md
git commit -m "Initial commit"
git push -u origin main
```

La branche `main` locale suit maintenant `origin/main`.

---

## 2. Dépendances installées

Le `package.json` a été écrit à la main plutôt que généré par `npm create astro`, qui est interactif. Les paquets ont ensuite été ajoutés avec `npm install`.

### Dépendances de production

| Paquet | Version | Rôle |
| --- | --- | --- |
| `astro` | 7.x | Framework front, rendu des pages |
| `@astrojs/node` | 11.x | Adaptateur Node : permet le rendu serveur (SSR), indispensable pour exposer l'API |
| `hono` | 4.x | Framework de l'API REST |
| `@hono/zod-validator` | 0.9.x | Branche les schémas Zod sur les routes Hono |
| `zod` | 4.x | Validation des données entrantes |
| `drizzle-orm` | 0.45.x | ORM typé pour la base de données |
| `better-sqlite3` | 13.x | Pilote SQLite (la base est un simple fichier, rien à installer) |

### Dépendances de développement

| Paquet | Rôle |
| --- | --- |
| `typescript` **6.x** | Compilateur TypeScript |
| `@astrojs/check` | Vérification des types dans les fichiers `.astro` |
| `drizzle-kit` | Crée les tables à partir du schéma (`db:push`) |
| `@types/better-sqlite3` | Types TypeScript du pilote SQLite |
| `tsx` | Exécute directement un fichier `.ts` (utilisé pour le seed) |
| `vitest` | Tests de l'API |
| `@playwright/test` | Tests de bout en bout dans un navigateur |

**Pourquoi TypeScript 6 et pas 7 ?** `npm` a d'abord installé TypeScript 7, mais `astro check` ne le supporte pas encore et refuse de se lancer. TypeScript a donc été ramené à la version 6.

**Avertissement `npm audit`.** Il signale 4 vulnérabilités « moderate » dans `esbuild`, embarqué par `drizzle-kit`. Ce paquet ne sert qu'en développement et n'entre pas dans le build de production. La correction proposée (`npm audit fix --force`) rétrograderait `drizzle-kit` vers une version très ancienne : elle n'a pas été appliquée.

---

## 3. Scripts npm

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run dev` | Lance le serveur de dev Astro (front + API) sur http://localhost:4321 |
| `npm run build` | Construit le site pour la production dans `dist/` |
| `npm start` | Lance le build de production avec Node |
| `npm run preview` | Prévisualise le build |
| `npm run check` | Vérifie les types (TypeScript + fichiers `.astro`) |
| `npm run db:push` | Crée ou met à jour les tables SQLite à partir du schéma |
| `npm run db:seed` | Insère les données de démo |
| `npm test` | Lance les tests de l'API (Vitest) |
| `npm run test:e2e` | Lance les tests navigateur (Playwright) |

---

## 4. Fichiers de configuration

| Fichier | Contenu |
| --- | --- |
| `astro.config.mjs` | `output: 'server'` et adaptateur `@astrojs/node` en mode `standalone`. Sans SSR, la route `/api` ne pourrait pas répondre dynamiquement. |
| `tsconfig.json` | Hérite du preset `astro/tsconfigs/strict` (TypeScript strict). |
| `drizzle.config.ts` | Indique à `drizzle-kit` où trouver le schéma (`src/server/db/schema.ts`) et la base (`DATABASE_URL`, par défaut `sqlite.db`). |
| `vitest.config.ts` | Limite Vitest aux fichiers `tests/api/**/*.test.ts`. |
| `playwright.config.ts` | Tests dans `tests/e2e`, URL de base `localhost:4321`, démarre `npm run dev` automatiquement si besoin. |
| `.env.example` | Modèle des variables d'environnement : `DATABASE_URL`, `STRIPE_SECRET_KEY`, `JWT_SECRET`. |
| `.gitignore` | Exclut `node_modules/`, `dist/`, `.astro/`, `.env`, les fichiers `*.db` et les rapports de tests. |
| `src/env.d.ts` | Types des variables d'environnement pour l'autocomplétion. |

Un fichier `.env` local a été créé en copiant `.env.example`. Il n'est **pas** versionné : chacun doit faire `cp .env.example .env` de son côté.

---

## 5. Le point clé : la jonction Astro ↔ Hono

Toute l'intégration tient dans deux fichiers.

**`src/server/app.ts`** crée l'application Hono avec le préfixe `/api`, ajoute le logger et la gestion d'erreurs, puis monte chaque routeur :

```ts
const app = new Hono().basePath('/api');

const routes = app
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/products', products)
  .route('/categories', categories)
  .route('/cart', cart)
  .route('/orders', orders)
  .route('/auth', auth);

export default app;
export type AppType = typeof routes;
```

**`src/pages/api/[...path].ts`** est une route Astro « attrape-tout » : toute requête vers `/api/*` est transmise à Hono.

```ts
export const prerender = false;
export const ALL: APIRoute = ({ request }) => app.fetch(request);
```

Le type `AppType` exporté permet à **`src/lib/api.ts`** de créer un client RPC typé (`hc<AppType>`). Les pages Astro peuvent ainsi appeler l'API avec l'autocomplétion sur les routes et les réponses.

---

## 6. Code de départ créé

Chaque dossier de l'arborescence contient un fichier minimal qui fonctionne déjà. Ce sont des **squelettes** : la logique métier reste à écrire.

### Back-end (`src/server/`)

| Dossier / fichier | Contenu actuel |
| --- | --- |
| `routes/products.ts` | `GET /` (avec filtres `q` et `category` validés) et `GET /:slug` |
| `routes/categories.ts` | `GET /` et `GET /:slug` |
| `routes/cart.ts` | `GET /`, `POST /items`, `PATCH /items/:productId`, `DELETE /items/:productId` |
| `routes/orders.ts` | `GET /`, `POST /`, `GET /:id`, protégées par `requireAuth` |
| `routes/auth.ts` | `POST /register`, `POST /login`, `POST /logout` |
| `validators/` | Schémas Zod : filtres produits, ligne de panier, connexion / inscription |
| `middlewares/auth.ts` | `requireAuth` : refuse la requête (401) s'il n'y a pas de cookie `session`. La vérification du JWT reste à faire. |
| `middlewares/error-handler.ts` | Renvoie les erreurs HTTP proprement, sinon une erreur 500 générique |
| `services/cart.ts` | `cartTotal()` : calcule le total du panier |
| `db/schema.ts` | Tables `categories`, `products`, `users`, `orders`, `order_items` |
| `db/client.ts` | Connexion Drizzle + SQLite |
| `db/seed.ts` | 3 catégories (Protéines, Créatine, Vitamines) et 3 produits de démo |

> Pour l'instant, les routes renvoient des données fictives : elles ne lisent pas encore la base. Il faudra importer `db` depuis `db/client.ts` pour les brancher.

Les prix sont stockés **en centimes** (entiers) pour éviter les erreurs d'arrondi des nombres décimaux. `src/lib/format.ts` les affiche en euros (`2990` → `29,90 €`).

### Front-end

| Dossier | Contenu |
| --- | --- |
| `src/pages/` | Toutes les pages prévues : accueil, catalogue, fiche produit, catégorie, panier, commande, confirmation, connexion, inscription, historique |
| `src/layouts/` | `BaseLayout` (structure HTML, favicon, CSS global) et `ShopLayout` (ajoute le Header et le Footer) |
| `src/components/layout/` | `Header`, `Navigation`, `Footer` |
| `src/components/product/` | `ProductCard`, `ProductGrid`, `NutritionTable` |
| `src/components/cart/` | `CartItem`, `CartSummary` |
| `src/components/islands/` | `AddToCartButton` : seul composant qui envoie du JavaScript au navigateur (appel `POST /api/cart/items`) |
| `src/types/` | Types partagés front/back : `Product`, `Category`, `CartItem`, `Order` |
| `src/styles/global.css` | Variables de thème (couleurs, rayon, police) et styles de base |
| `public/` | `favicon.svg` et dossier `images/products/` (vide) |

### Tests et documentation

| Fichier | Contenu |
| --- | --- |
| `tests/api/health.test.ts` | Vérifie que `/api/health` répond `ok` et que le panier rejette un corps invalide (400). Tourne **sans démarrer de serveur**, grâce à `app.request()`. |
| `tests/e2e/parcours.spec.ts` | Ouvre l'accueil, clique sur « Voir le catalogue » et vérifie que la page Catalogue s'affiche |
| `docs/analyse-astro-hono.md` | Plan du rapport TechLab (bénéfices, limites, benchmarks, alternative monorepo) |

---

## 7. Base de données

La base a été initialisée en local :

```bash
cp .env.example .env
npx drizzle-kit push    # crée les tables dans sqlite.db
npm run db:seed         # insère les données de démo
```

Le fichier `sqlite.db` est ignoré par Git : chaque développeur doit relancer ces commandes de son côté.

---

## 8. Vérifications effectuées

| Vérification | Résultat |
| --- | --- |
| `npm test` | 2 tests passés |
| `npm run check` | 0 erreur, 0 avertissement |
| `npm run build` | Build terminé |
| Serveur de dev | `/api/health` → `{"status":"ok"}`, `/` → 200, `/produits/whey` → 200 |

Une correction a été nécessaire pendant ces vérifications : `astro check` signalait que `Astro.params.slug` peut être `undefined` dans les pages `[slug].astro`. On a écrit `Astro.params.slug!`, puisque le paramètre est toujours présent sur ces routes.

---

## 9. Démarrer le projet après un clone

```bash
npm install
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

Avant les premiers tests Playwright, il faut télécharger les navigateurs :

```bash
npx playwright install
```

---

## 10. Prochaines étapes

- Brancher les routes Hono sur la base (`db` dans `src/server/db/client.ts`).
- Implémenter l'authentification : hachage des mots de passe, JWT avec `hono/jwt`, cookie `session`.
- Afficher les vraies données dans les pages, via le client RPC de `src/lib/api.ts`.
- Stocker le panier (cookie ou table dédiée).
- Ajouter le paiement : Stripe en mode test, ou paiement simulé.
- Remplir `docs/analyse-astro-hono.md` au fil du projet.
