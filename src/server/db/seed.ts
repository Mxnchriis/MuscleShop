import { sql } from 'drizzle-orm';
import { db } from './client';
import { categories, products } from './schema';

// Upsert sur le slug : le seed peut être relancé sans erreur UNIQUE.
// Relancer le seed remet aussi les prix et les stocks à ces valeurs.

const categoryData = [
  { slug: 'proteines', name: 'Protéines' },
  { slug: 'creatine', name: 'Créatine' },
  { slug: 'vitamines', name: 'Vitamines & minéraux' },
  { slug: 'barres-snacks', name: 'Barres & snacks' },
  { slug: 'pre-workout', name: 'Pré-workout' },
  { slug: 'acides-amines', name: 'Acides aminés' },
  { slug: 'accessoires', name: 'Accessoires' },
];

// Prix en centimes ; originalPrice = prix barré (produit en promo). Les 3 premiers produits existent depuis le début du projet : ne pas changer leur ordre.
const productData = [
  { category: 'proteines', slug: 'whey-vanille-1kg', name: 'Whey Vanille 1 kg', description: 'Protéine de lactosérum.', price: 2990, stock: 50 },
  { category: 'creatine', slug: 'creatine-monohydrate-300g', name: 'Créatine monohydrate 300 g', description: 'Créatine pure.', price: 1990, stock: 80 },
  { category: 'vitamines', slug: 'multivitamines-90', name: 'Multivitamines x90', description: 'Complexe vitamines et minéraux.', price: 1490, stock: 40 },

  // Protéines
  { category: 'proteines', slug: 'whey-chocolat-300g', name: 'Whey Chocolat 300 g', description: 'Protéine de lactosérum saveur chocolat, format découverte. 24 g de protéines par dose.', price: 1290, stock: 60 },
  { category: 'proteines', slug: 'whey-chocolat-500g', name: 'Whey Chocolat 500 g', description: 'Protéine de lactosérum saveur chocolat. 24 g de protéines par dose.', price: 1990, stock: 45 },
  { category: 'proteines', slug: 'whey-chocolat-1kg', name: 'Whey Chocolat 1 kg', description: 'Protéine de lactosérum saveur chocolat. 24 g de protéines par dose.', price: 3290, originalPrice: 3990, stock: 35 },
  { category: 'proteines', slug: 'whey-fraise-1kg', name: 'Whey Fraise 1 kg', description: 'Protéine de lactosérum saveur fraise. 24 g de protéines par dose.', price: 2990, stock: 25 },
  { category: 'proteines', slug: 'whey-isolate-neutre-1kg', name: 'Whey Isolate Neutre 1 kg', description: 'Isolat de lactosérum sans arôme, pauvre en lactose. 27 g de protéines par dose.', price: 3990, stock: 20 },
  { category: 'proteines', slug: 'caseine-vanille-1kg', name: 'Caséine Vanille 1 kg', description: 'Protéine à digestion lente, idéale avant le coucher.', price: 3490, stock: 0 },
  { category: 'proteines', slug: 'proteine-vegetale-chocolat-750g', name: 'Protéine végétale Chocolat 750 g', description: 'Mélange pois et riz, 100 % végétal. 21 g de protéines par dose.', price: 2790, stock: 30 },

  // Créatine
  { category: 'creatine', slug: 'creatine-monohydrate-500g', name: 'Créatine monohydrate 500 g', description: 'Créatine pure micronisée, sans arôme. 3 g par jour.', price: 2790, stock: 50 },
  { category: 'creatine', slug: 'creatine-gelules-120', name: 'Créatine gélules x120', description: 'Créatine monohydrate en gélules, pratique à emporter.', price: 1790, stock: 40 },

  // Vitamines & minéraux
  { category: 'vitamines', slug: 'vitamine-d3-k2-60', name: 'Vitamine D3 + K2 x60', description: 'Contribue au maintien d’une ossature normale.', price: 1290, stock: 70 },
  { category: 'vitamines', slug: 'magnesium-b6-60', name: 'Magnésium + B6 x60', description: 'Contribue à réduire la fatigue et au fonctionnement musculaire.', price: 990, stock: 90 },
  { category: 'vitamines', slug: 'omega-3-120', name: 'Oméga-3 x120', description: 'Huile de poisson riche en EPA et DHA.', price: 1690, originalPrice: 1990, stock: 55 },
  { category: 'vitamines', slug: 'zinc-60', name: 'Zinc x60', description: 'Bisglycinate de zinc, forme bien assimilée.', price: 790, stock: 65 },

  // Barres & snacks
  { category: 'barres-snacks', slug: 'barre-proteinee-chocolat', name: 'Barre protéinée Chocolat', description: 'Barre de 60 g, 20 g de protéines. À l’unité.', price: 250, stock: 200 },
  { category: 'barres-snacks', slug: 'barre-proteinee-chocolat-x12', name: 'Barre protéinée Chocolat x12', description: 'Boîte de 12 barres de 60 g, 20 g de protéines chacune.', price: 2490, originalPrice: 2990, stock: 40 },
  { category: 'barres-snacks', slug: 'barre-proteinee-cookie-x12', name: 'Barre protéinée Cookie x12', description: 'Boîte de 12 barres saveur cookie dough, 20 g de protéines chacune.', price: 2490, stock: 35 },
  { category: 'barres-snacks', slug: 'beurre-cacahuete-500g', name: 'Beurre de cacahuète 500 g', description: '100 % cacahuètes grillées, sans sucre ni huile ajoutés.', price: 890, stock: 60 },

  // Pré-workout
  { category: 'pre-workout', slug: 'pre-workout-fruits-rouges-300g', name: 'Pré-workout Fruits rouges 300 g', description: 'Caféine, citrulline et bêta-alanine pour l’énergie à l’entraînement.', price: 2990, originalPrice: 3490, stock: 30 },
  { category: 'pre-workout', slug: 'cafeine-200mg-100', name: 'Caféine 200 mg x100', description: 'Comprimés de caféine anhydre.', price: 990, stock: 50 },

  // Acides aminés
  { category: 'acides-amines', slug: 'bcaa-211-400g', name: 'BCAA 2:1:1 Citron 400 g', description: 'Leucine, isoleucine et valine, saveur citron.', price: 2290, stock: 40 },
  { category: 'acides-amines', slug: 'eaa-peche-400g', name: 'EAA Pêche 400 g', description: 'Les 9 acides aminés essentiels, saveur pêche.', price: 2690, stock: 25 },
  { category: 'acides-amines', slug: 'glutamine-500g', name: 'L-Glutamine 500 g', description: 'Glutamine en poudre, sans arôme.', price: 1990, stock: 35 },

  // Accessoires
  { category: 'accessoires', slug: 'shaker-700ml', name: 'Shaker 700 ml', description: 'Shaker avec grille mélangeuse, sans BPA.', price: 690, stock: 150 },
  { category: 'accessoires', slug: 'shaker-inox-750ml', name: 'Shaker inox 750 ml', description: 'Shaker isotherme en acier inoxydable.', price: 1990, originalPrice: 2490, stock: 40 },
  { category: 'accessoires', slug: 'pilulier-hebdomadaire', name: 'Pilulier hebdomadaire', description: 'Pilulier 7 jours pour gélules et comprimés.', price: 490, stock: 80 },
];

const insertedCategories = db
  .insert(categories)
  .values(categoryData)
  .onConflictDoUpdate({ target: categories.slug, set: { name: sql`excluded.name` } })
  .returning()
  .all();

const categoryIds = new Map(insertedCategories.map((category) => [category.slug, category.id]));

db.insert(products)
  .values(productData.map(({ category, ...product }) => ({ ...product, categoryId: categoryIds.get(category)! })))
  .onConflictDoUpdate({
    target: products.slug,
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      price: sql`excluded.price`,
      originalPrice: sql`excluded.original_price`,
      stock: sql`excluded.stock`,
      categoryId: sql`excluded.category_id`,
    },
  })
  .run();

console.log(`Seed terminé : ${categoryData.length} catégories, ${productData.length} produits`);
