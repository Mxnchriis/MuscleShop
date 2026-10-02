# Arborescence du projet : boutique de compléments alimentaires sportifs (Astro + Hono)

## Choix d'intégration

**Un seul projet Astro, avec Hono monté sur `/api`** via une route catch-all Astro
(`src/pages/api/[...path].ts`) qui délègue chaque requête à `app.fetch()` de Hono.

Pourquoi ce choix plutôt qu'un monorepo (deux apps séparées) :
- Un seul serveur, un seul `npm run dev`, un seul déploiement : idéal pour un projet de cours.
- Pas de CORS, front et API partagent le même domaine et les mêmes cookies (panier, session).
- Les types TypeScript sont partagés directement, et le client RPC de Hono (`hc`) donne un appel d'API typé côté Astro.
- C'est précisément le point d'étude intéressant pour TechLab : voir jusqu'où les deux outils cohabitent.

Le monorepo (`apps/web` + `apps/api`) reste pertinent si l'API devait être déployée seule
(ex. Hono sur Cloudflare Workers), ou consommée par une app mobile. On le garde comme
alternative à documenter dans le rapport.

## Arborescence

```
muscle-shop/
├── astro.config.mjs          # Config Astro : output "server" + adapter Node (SSR nécessaire pour /api)
├── package.json
├── tsconfig.json
├── .env.example              # Variables d'env (URL BDD, clé Stripe test, secret JWT)
├── README.md
│
├── public/                   # Fichiers statiques servis tels quels
│   ├── favicon.svg
│   └── images/products/      # Photos produits (whey, créatine, BCAA…)
│
├── docs/                     # Livrables TechLab : notes, benchmarks, bénéfices/limites
│   └── analyse-astro-hono.md
│
├── src/
│   ├── pages/                # Routage Astro basé sur les fichiers
│   │   ├── index.astro               # Accueil (mise en avant, catégories)
│   │   ├── produits/
│   │   │   ├── index.astro           # Catalogue avec filtres
│   │   │   └── [slug].astro          # Fiche produit
│   │   ├── categories/[slug].astro   # Protéines, pré-workout, vitamines…
│   │   ├── panier.astro
│   │   ├── commande/
│   │   │   ├── index.astro           # Tunnel de commande
│   │   │   └── confirmation.astro
│   │   ├── compte/
│   │   │   ├── connexion.astro
│   │   │   ├── inscription.astro
│   │   │   └── commandes.astro       # Historique client
│   │   └── api/
│   │       └── [...path].ts          # Point de jonction : passe toute requête /api/* à Hono
│   │
│   ├── server/               # Tout le back-end Hono, indépendant d'Astro
│   │   ├── app.ts                    # Instance Hono, basePath('/api'), montage des routes, export du type AppType
│   │   ├── routes/                   # Un fichier par ressource REST
│   │   │   ├── products.ts           # GET liste / détail, recherche, filtres
│   │   │   ├── categories.ts
│   │   │   ├── cart.ts               # Ajout, retrait, mise à jour des quantités
│   │   │   ├── orders.ts             # Création et suivi des commandes
│   │   │   └── auth.ts               # Inscription, connexion, déconnexion
│   │   ├── middlewares/              # auth (JWT/cookie), logger, gestion d'erreurs, CORS si besoin
│   │   ├── validators/               # Schémas Zod utilisés avec @hono/zod-validator
│   │   ├── services/                 # Logique métier (calcul du panier, stock, paiement)
│   │   └── db/
│   │       ├── schema.ts             # Tables (produits, catégories, users, commandes)
│   │       ├── client.ts             # Connexion BDD (ex. Drizzle + SQLite)
│   │       └── seed.ts               # Jeu de données de démo
│   │
│   ├── components/           # Composants Astro réutilisables
│   │   ├── layout/                   # Header, Footer, Navigation
│   │   ├── product/                  # ProductCard, ProductGrid, NutritionTable
│   │   ├── cart/                     # CartItem, CartSummary
│   │   └── islands/                  # Composants interactifs hydratés (bouton panier, filtres)
│   │
│   ├── layouts/              # Gabarits de page (BaseLayout, ShopLayout)
│   ├── lib/                  # Code partagé front : client RPC Hono (hc<AppType>), helpers prix/format
│   ├── types/                # Types communs front/back (Product, Order, CartItem…)
│   ├── styles/               # CSS global, variables de thème
│   └── env.d.ts              # Types d'environnement Astro
│
└── tests/
    ├── api/                  # Tests des routes Hono via app.request() (sans serveur)
    └── e2e/                  # Parcours utilisateur (Playwright) : catalogue → panier → commande
```

## Rôle des dossiers clés

- **`src/pages/`** : chaque fichier devient une URL ; c'est le domaine d'Astro (rendu HTML, SEO).
- **`src/pages/api/[...path].ts`** : le seul endroit où Astro et Hono se touchent, quelques lignes.
- **`src/server/`** : l'API Hono, isolée pour pouvoir être extraite en service autonome sans réécriture.
- **`src/server/routes/`** : une ressource par fichier, chaque fichier exporte un sous-routeur Hono.
- **`src/server/validators/`** : validation des entrées (Zod) branchée sur Hono, pour des routes typées de bout en bout.
- **`src/server/services/`** : la logique métier, séparée des routes pour être testable seule.
- **`src/server/db/`** : schéma, connexion et données de démo.
- **`src/components/islands/`** : les seuls composants qui envoient du JavaScript au navigateur (architecture en îlots d'Astro).
- **`src/lib/`** : le client RPC typé qui permet aux pages Astro d'appeler l'API Hono avec autocomplétion.
- **`src/types/`** : le contrat partagé entre front et back.
- **`docs/`** : la matière du rapport TechLab, alimentée au fil du projet.
- **`tests/api/`** : Hono se teste sans démarrer de serveur, un bénéfice à mesurer.

## Choix par défaut (modifiables)

- Rendu : SSR avec `@astrojs/node` (requis pour exposer l'API).
- BDD : SQLite + Drizzle ORM (zéro installation, suffisant pour une démo).
- Paiement : Stripe en mode test, ou paiement simulé si on veut rester simple.
- Îlots interactifs : composants Astro + un peu de JS, ou Preact si besoin de plus d'état.
