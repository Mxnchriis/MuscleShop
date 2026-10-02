import { db } from './client';
import { categories, products } from './schema';

const [proteines, creatine, vitamines] = db
  .insert(categories)
  .values([
    { slug: 'proteines', name: 'Protéines' },
    { slug: 'creatine', name: 'Créatine' },
    { slug: 'vitamines', name: 'Vitamines' },
  ])
  .returning()
  .all();

db.insert(products)
  .values([
    { slug: 'whey-vanille-1kg', name: 'Whey Vanille 1 kg', description: 'Protéine de lactosérum.', price: 2990, stock: 50, categoryId: proteines.id },
    { slug: 'creatine-monohydrate-300g', name: 'Créatine monohydrate 300 g', description: 'Créatine pure.', price: 1990, stock: 80, categoryId: creatine.id },
    { slug: 'multivitamines-90', name: 'Multivitamines x90', description: 'Complexe vitamines et minéraux.', price: 1490, stock: 40, categoryId: vitamines.id },
  ])
  .run();

console.log('Seed terminé');
