import { randomBytes, scryptSync } from 'node:crypto';
import { inArray, like, or, eq } from 'drizzle-orm';
import { db } from './client';
import { orderItems, orders, products, users } from './schema';

// Données fictives « vrai site » pour comparer les espaces admin des trois versions
// (Astro + Hono, Electron + node:http, React + Express). Fichier identique dans les trois projets.
//
//   npm run db:mock        (après db:push et db:seed)
//
// - 40 clients (prenom.nom@client.muscleshop.fr) et 1 admin (admin@muscleshop.fr), mot de passe : password123
// - environ 220 commandes sur les 60 derniers jours, plus nombreuses récemment, avec 1 à 4 produits chacune
// - statuts réalistes : anciennes commandes expédiées, récentes payées, quelques-unes en attente ou annulées
//
// Déterministe : même graine → mêmes clients, mêmes commandes, mêmes montants dans les trois bases.
// Les dates sont calculées à partir du jour du lancement (pour remplir le graphique des 14 derniers jours).
// Relançable : les données fictives précédentes sont supprimées avant d'être recréées.
// Le stock n'est pas modifié (sinon chaque relance le diminuerait) : relancer db:seed le remet à zéro de toute façon.

const PASSWORD = 'password123';
const CUSTOMER_DOMAIN = '@client.muscleshop.fr';
const ADMIN_EMAIL = 'admin@muscleshop.fr';
const CUSTOMERS = 40;
const DAYS = 60;

// Générateur pseudo-aléatoire à graine (mulberry32) : pas de Math.random()
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(20261112);
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];

const firstNames = ['Lucas', 'Emma', 'Hugo', 'Léa', 'Louis', 'Chloé', 'Gabriel', 'Manon', 'Arthur', 'Camille', 'Jules', 'Inès', 'Nathan', 'Sarah', 'Théo', 'Jade', 'Raphaël', 'Lina', 'Tom', 'Zoé'];
const lastNames = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'Roux', 'Fournier', 'Girard', 'Bonnet', 'Mercier'];
const slugify = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Produits les plus vendus en vrai dans une boutique de compléments : la whey et la créatine d'abord
const popularity: Record<string, number> = {
  'whey-chocolat-1kg': 10, 'whey-vanille-1kg': 9, 'creatine-monohydrate-300g': 9, 'creatine-monohydrate-500g': 7,
  'barre-proteinee-chocolat-x12': 6, 'whey-isolate-neutre-1kg': 5, 'shaker-700ml': 5, 'omega-3-120': 4,
  'magnesium-b6-60': 4, 'pre-workout-fruits-rouges-300g': 4, 'multivitamines-90': 3, 'bcaa-211-400g': 3,
};

// Même format de mot de passe que services/auth.ts (« sel:hash », scrypt). Un seul hash, partagé : c'est un jeu de test.
const salt = randomBytes(16).toString('hex');
const passwordHash = `${salt}:${scryptSync(PASSWORD, salt, 64).toString('hex')}`;

const catalog = db.select({ id: products.id, slug: products.slug, price: products.price }).from(products).orderBy(products.slug).all();
if (catalog.length === 0) {
  console.error('Aucun produit en base : lancer `npm run db:seed` d’abord.');
  process.exit(1);
}
// Tirage pondéré par la popularité (1 pour les produits non listés)
const weighted = catalog.flatMap((product) => Array.from({ length: popularity[product.slug] ?? 1 }, () => product));

const now = new Date();
const dayStart = (daysAgo: number) => {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
};

db.transaction((tx) => {
  // 1. Suppression des données fictives précédentes
  const previous = tx
    .select({ id: users.id })
    .from(users)
    .where(or(like(users.email, `%${CUSTOMER_DOMAIN}`), eq(users.email, ADMIN_EMAIL)))
    .all()
    .map((user) => user.id);
  if (previous.length) {
    const previousOrders = tx.select({ id: orders.id }).from(orders).where(inArray(orders.userId, previous)).all().map((o) => o.id);
    if (previousOrders.length) tx.delete(orderItems).where(inArray(orderItems.orderId, previousOrders)).run();
    tx.delete(orders).where(inArray(orders.userId, previous)).run();
    tx.delete(users).where(inArray(users.id, previous)).run();
  }

  // 2. Comptes : 1 admin + 40 clients, dont une partie de clients fidèles qui commandent souvent
  tx.insert(users).values({ email: ADMIN_EMAIL, name: 'Admin MuscleShop', passwordHash, role: 'admin' }).run();
  const customers = Array.from({ length: CUSTOMERS }, (_, index) => {
    const first = firstNames[index % firstNames.length];
    const last = lastNames[(index * 7 + Math.floor(index / firstNames.length)) % lastNames.length];
    const email = `${slugify(first)}.${slugify(last)}${index >= firstNames.length ? index : ''}${CUSTOMER_DOMAIN}`;
    return tx.insert(users).values({ email, name: `${first} ${last}`, passwordHash, role: 'customer' }).returning({ id: users.id }).get();
  });
  const loyal = customers.slice(0, 10);

  // 3. Commandes jour par jour : 1 à 3 par jour il y a 2 mois, 3 à 7 par jour ces deux dernières semaines
  const counts = { pending: 0, paid: 0, shipped: 0, cancelled: 0 };
  let orderCount = 0;
  let revenue = 0;
  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
    const perDay = daysAgo < 14 ? int(3, 7) : daysAgo < 30 ? int(2, 5) : int(1, 3);
    for (let n = 0; n < perDay; n++) {
      const customer = random() < 0.45 ? pick(loyal) : pick(customers);
      const createdAt = new Date(dayStart(daysAgo).getTime() + int(7 * 3600, 23 * 3600) * 1000);
      if (createdAt > now) continue; // pas de commande dans le futur (heures restantes d'aujourd'hui)

      // Statut selon l'ancienneté : une commande payée part en expédition après quelques jours
      const roll = random();
      const status: keyof typeof counts =
        roll < 0.08 ? 'cancelled' : daysAgo <= 1 && roll < 0.2 ? 'pending' : daysAgo > 4 || (daysAgo > 1 && roll < 0.5) ? 'shipped' : 'paid';

      // 1 à 4 produits différents, 1 à 3 unités chacun (prix actuel du catalogue)
      const lines = new Map<number, { productId: number; quantity: number; unitPrice: number }>();
      for (let i = 0, size = int(1, 4); i < size; i++) {
        const product = pick(weighted);
        if (!lines.has(product.id)) lines.set(product.id, { productId: product.id, quantity: random() < 0.75 ? 1 : int(2, 3), unitPrice: product.price });
      }
      const total = [...lines.values()].reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

      // Pas de session Stripe : une commande en attente ne déclenche aucun appel à Stripe
      const order = tx.insert(orders).values({ userId: customer.id, status, total, createdAt: createdAt.toISOString() }).returning({ id: orders.id }).get();
      tx.insert(orderItems).values([...lines.values()].map((line) => ({ ...line, orderId: order.id }))).run();

      counts[status]++;
      orderCount++;
      if (status === 'paid' || status === 'shipped') revenue += total;
    }
  }

  const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(revenue / 100);
  console.log(`Mock terminé : ${CUSTOMERS} clients + 1 admin (${ADMIN_EMAIL} / ${PASSWORD}), ${orderCount} commandes`);
  console.log(`  payées ${counts.paid}, expédiées ${counts.shipped}, en attente ${counts.pending}, annulées ${counts.cancelled} · CA fictif ${euros}`);
});
