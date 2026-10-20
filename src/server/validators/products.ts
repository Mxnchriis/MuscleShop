import { z } from 'zod';

export const productSorts = ['name', 'best-sellers', 'newest'] as const;

// Paramètres d'URL : tout arrive en texte, d'où stringbool et la conversion de limit
export const productListQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  promo: z.stringbool().optional(), // ?promo=true : seulement les produits avec un prix barré
  sort: z.enum(productSorts).optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(50))
    .optional(),
});
