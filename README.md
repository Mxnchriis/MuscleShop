# MuscleShop

Boutique de compléments alimentaires sportifs : **Astro** (front, SSR) + **Hono** (API montée sur `/api`).

## Démarrage

```bash
npm install
cp .env.example .env
npm run db:push    # crée les tables SQLite
npm run db:seed    # données de démo
npm run dev        # http://localhost:4321
```

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` | Serveur de dev Astro (front + API) |
| `npm run build` / `npm start` | Build et lancement en production (Node) |
| `npm test` | Tests de l'API Hono (Vitest, sans serveur) |
| `npm run test:e2e` | Parcours utilisateur (Playwright) |

Voir [`arborescence.md`](arborescence.md) pour l'organisation du projet.
