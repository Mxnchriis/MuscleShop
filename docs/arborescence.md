# Arborescence du projet : boutique de compléments alimentaires sportifs (Astro + Hono)

## Choix d'intégration

**Un seul projet Astro, avec Hono monté sur `/api`** via une route catch-all Astro
(`src/pages/api/[...path].ts`) qui délègue chaque requête à `app.fetch()` de Hono.

Pourquoi ce choix plutôt qu'un monorepo (deux apps séparées) :
- Un seul serveur, un seul `npm run dev`, un seul déploiement : idéal pour des projets rapides.
- Pas de CORS, front et API partagent le même domaine et les mêmes cookies (panier, session).
- Les types TypeScript sont partagés directement, et le client RPC de Hono (`hc`) donne un appel d'API typé côté Astro.
- C'est précisément le point d'étude intéressant pour TechLab : voir jusqu'où les deux outils cohabitent.

Le monorepo (`apps/web` + `apps/api`) reste pertinent si l'API devait être déployée seule
(ex. Hono sur Cloudflare Workers), ou consommée par une app mobile. On le garde comme
alternative à documenter dans le rapport.

## Arborescence

```
muscle-shop/
├── astro.config.mjs          # Config Astro : output "server" + adaptateur Node (SSR nécessaire pour /api)
├── drizzle.config.ts         # Schéma et base pour drizzle-kit (db:push, db:studio)
├── vitest.config.ts          # Tests de l'API sur une base dédiée (test.db)
├── playwright.config.ts      # Tests E2E
├── package.json
├── tsconfig.json
├── .env.example              # Variables d'env : DATABASE_URL, STRIPE_SECRET_KEY, JWT_SECRET
├── README.md
│
├── public/                   # Fichiers statiques servis tels quels
│   ├── favicon.svg
│   └── images/products/
│       └── placeholder.svg           # Image par défaut des produits sans photo
│
├── docs/                     # Livrables TechLab
│   ├── analyse-astro-hono.md         # Bénéfices, limites, benchmarks, alternative monorepo
│   ├── arborescence.md               # Ce fichier
│   ├── Config.md                     # Initialisation du projet
│   └── paiement.md                   # Cartes Stripe de test
│
├── src/
│   ├── pages/                # ASTRO : routage basé sur les fichiers
│   │   ├── index.astro               # Accueil : catégories en briques, meilleures ventes, promos, nouveautés
│   │   ├── produits/
│   │   │   ├── index.astro           # Catalogue : recherche, ?promo=true, ?sort=
│   │   │   └── [slug].astro          # Fiche produit
│   │   ├── categories/[slug].astro   # Produits d'une catégorie
│   │   ├── panier.astro
│   │   ├── commande/
│   │   │   ├── index.astro           # Récapitulatif (connexion obligatoire) → paiement Stripe
│   │   │   ├── confirmation.astro    # Retour de Stripe : statut vérifié, panier vidé
│   │   │   └── annulee.astro         # « Retour » depuis Stripe : commande annulée
│   │   ├── compte/
│   │   │   ├── connexion.astro
│   │   │   ├── inscription.astro
│   │   │   └── commandes.astro       # Mes commandes : payer, annuler, recommander
│   │   └── api/
│   │       └── [...path].ts          # ★ Point de jonction : toute requête /api/* passe à Hono
│   │
│   ├── middleware.ts         # Middleware Astro : session et taille du panier → Astro.locals
│   │
│   ├── server/               # HONO : tout le back-end, indépendant d'Astro
│   │   ├── app.ts                    # Instance Hono, basePath('/api'), montage des routes, type AppType
│   │   ├── env.ts                    # Charge .env dans process.env et vérifie les secrets
│   │   ├── routes/                   # Un fichier par ressource REST (routes fines : valider → service → JSON)
│   │   │   ├── products.ts           # Liste (filtres, tris, promos), détail
│   │   │   ├── categories.ts         # Liste avec nombre de produits, détail
│   │   │   ├── cart.ts               # Ajout, modification, retrait (cookie)
│   │   │   ├── orders.ts             # Commander, payer, annuler, recommander
│   │   │   └── auth.ts               # Inscription, connexion, déconnexion, /me
│   │   ├── middlewares/
│   │   │   ├── auth.ts               # requireAuth : vérifie le JWT
│   │   │   └── error-handler.ts      # Erreurs → JSON { error }
│   │   ├── validators/               # Schémas Zod (produits, panier, auth)
│   │   ├── services/                 # Logique métier, testable seule
│   │   │   ├── catalog.ts            # Requêtes produits et catégories, meilleures ventes
│   │   │   ├── cart.ts               # Lecture et écriture du cookie, calcul du panier
│   │   │   ├── auth.ts               # scrypt, JWT
│   │   │   ├── orders.ts             # Commandes, statut, stock
│   │   │   └── payment.ts            # Seul fichier qui parle à Stripe
│   │   └── db/
│   │       ├── schema.ts             # Tables : categories, products, users, orders, order_items
│   │       ├── client.ts             # Connexion Drizzle + SQLite
│   │       └── seed.ts               # 7 catégories, 28 produits (relançable)
│   │
│   ├── components/           # Composants Astro réutilisables
│   │   ├── layout/                   # Header, Navigation, Footer
│   │   ├── home/                     # CategoryGrid (grille décalée), ProductSection
│   │   ├── product/                  # ProductCard (badge promo), ProductGrid, NutritionTable
│   │   ├── cart/                     # CartItem, CartSummary
│   │   └── islands/                  # Seuls composants avec du JS navigateur
│   │       ├── AddToCartButton.astro
│   │       ├── AuthForm.astro
│   │       └── OrderActions.astro
│   │
│   ├── layouts/              # Gabarits de page (BaseLayout, ShopLayout)
│   ├── lib/                  # Côté front : client RPC (api.ts), prix, images, redirections sûres
│   ├── types/                # Types communs front/back (Product, Cart, Order, SessionUser…)
│   ├── styles/               # CSS global : variables de thème, .btn, .btn-secondary, formulaires
│   └── env.d.ts              # Types des variables d'env et de Astro.locals
│
└── tests/
    ├── api/                  # Tests Hono via app.request() (sans serveur)
    │   ├── setup.ts                  # Recrée test.db avant les tests
    │   ├── health.test.ts
    │   ├── catalog.test.ts
    │   └── shop.test.ts              # Panier, auth, commandes (Stripe simulé)
    └── e2e/                  # Parcours utilisateur (Playwright)
```

## Rôle des dossiers clés

- **`src/pages/`** : chaque fichier devient une URL. C'est le domaine d'Astro (rendu HTML, SEO).
- **`src/pages/api/[...path].ts`** : le seul endroit où Astro passe la main à Hono, en 3 lignes.
- **`src/middleware.ts`** : le middleware Astro. Il réutilise les services Hono pour lire la session et le panier.
- **`src/server/`** : l'API Hono, isolée pour pouvoir être extraite en service autonome sans réécriture.
- **`src/server/routes/`** : une ressource par fichier. Chaque fichier exporte un sous-routeur Hono.
- **`src/server/validators/`** : validation des entrées (Zod) branchée sur Hono, pour des routes typées de bout en bout.
- **`src/server/services/`** : la logique métier, séparée des routes pour être testable seule et réutilisable par Astro.
- **`src/server/db/`** : schéma, connexion et données de démo.
- **`src/components/islands/`** : les seuls composants qui envoient du JavaScript au navigateur (architecture en îlots d'Astro). Moins de 1 Ko par page.
- **`src/lib/api.ts`** : le client RPC typé. Les pages appellent Hono dans le même processus (`app.request`), sans réseau.
- **`src/types/`** : le contrat partagé entre front et back.
- **`docs/`** : la matière du rapport TechLab.
- **`tests/api/`** : Hono se teste sans démarrer de serveur.

## Choix retenus

- **Rendu :** SSR avec `@astrojs/node`, requis pour exposer l'API.
- **Base de données :** SQLite + Drizzle ORM. Rien à installer, suffisant pour une démo.
- **Appels des pages vers l'API :** client RPC `hc` + `app.request()`, sans réseau. Environ 1,8 fois plus rapide que HTTP sur l'accueil.
- **Panier :** cookie `httpOnly` validé par Zod, utilisable sans compte.
- **Authentification :** scrypt + JWT (`hono/jwt`) dans un cookie `httpOnly`.
- **Paiement :** Stripe Checkout en mode test. Le statut est vérifié auprès de Stripe au retour.
- **Îlots interactifs :** composants Astro + un peu de JavaScript, sans framework client.
