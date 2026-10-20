import { sql } from 'drizzle-orm';
import { db } from './client';
import { categories, products } from './schema';

// Upsert sur le slug : le seed peut être relancé sans erreur UNIQUE
const [proteines, creatine, vitamines] = db
  .insert(categories)
  .values([
    { slug: 'proteines', name: 'Protéines' },
    { slug: 'creatine', name: 'Créatine' },
    { slug: 'vitamines', name: 'Vitamines' },
  ])
  .onConflictDoUpdate({ target: categories.slug, set: { name: sql`excluded.name` } })
  .returning()
  .all();

db.insert(products)
  .values([
    { slug: 'whey-vanille-1kg', name: 'Whey Vanille 1 kg', description: 'Protéine de lactosérum.', price: 2990, stock: 50, categoryId: proteines.id },
    { slug: 'creatine-monohydrate-300g', name: 'Créatine monohydrate 300 g', description: 'Créatine pure.', price: 1990, stock: 80, categoryId: creatine.id },
    { slug: 'multivitamines-90', name: 'Multivitamines x90', description: 'Complexe vitamines et minéraux.', price: 1490, stock: 40, categoryId: vitamines.id },
  ])
  .onConflictDoUpdate({
    target: products.slug,
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      price: sql`excluded.price`,
      stock: sql`excluded.stock`,
      categoryId: sql`excluded.category_id`,
    },
  })
  .run();

console.log('Seed terminé');
