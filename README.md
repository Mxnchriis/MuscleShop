# MuscleShop

Boutique de compléments alimentaires sportifs : **Astro** (pages, rendu serveur) + **Hono** (API montée sur `/api`), dans un seul projet. Projet TechLab : étude de la cohabitation des deux frameworks.

**Fonctionnalités :**

- **Catalogue :** 28 produits, 7 catégories, recherche, promos, meilleures ventes, nouveautés.
- **Panier :** stocké dans un cookie, utilisable sans compte.
- **Comptes :** session JWT.
- **Paiement :** Stripe Checkout en mode test.
- **Mes commandes :** payer, annuler ou recommander une commande.
- **Espace admin (`/admin`) :** tableau de bord des ventes, stocks modifiables, historique des commandes, et panel de **performance** en direct (répartition Astro / Hono, latences par route, état du serveur, benchmark).

## Démarrage

```bash
npm install
cp .env.example .env   # puis renseigner STRIPE_SECRET_KEY (clé de test) et JWT_SECRET
npm run db:push        # crée les tables SQLite
npm run db:seed        # catégories et produits de démo
npm run dev            # http://localhost:4321
```

Pour générer `JWT_SECRET` : `openssl rand -base64 48`.

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` | Serveur de dev Astro (pages + API) |
| `npm run build` / `npm start` | Build et lancement en production (Node) |
| `npm run check` | Vérification des types (TypeScript + `.astro`) |
| `npm test` | Tests de l'API Hono (Vitest, sans serveur, base `test.db` dédiée) |
| `npm run test:e2e` | Parcours utilisateur (Playwright) |
| `npm run db:push` | Applique le schéma à la base |
| `npm run db:seed` | (Re)charge les données de démo |
| `npm run db:studio` | Interface web pour parcourir la base |
| `npm run admin:promote -- <email>` | Donne le rôle admin à un compte existant (`admin:demote` pour le retirer) |

## Documentation

| Document | Contenu |
| --- | --- |
| [`docs/analyse-astro-hono.md`](docs/analyse-astro-hono.md) | Analyse TechLab : intégration, bénéfices, limites, benchmarks, alternative monorepo |
| [`docs/arborescence.md`](docs/arborescence.md) | Organisation des dossiers et rôle de chaque partie |
| [`docs/Config.md`](docs/Config.md) | Initialisation du projet : dépendances, configuration |
| [`docs/paiement.md`](docs/paiement.md) | Cartes Stripe de test (paiement accepté ou refusé) |
