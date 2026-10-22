import { z } from 'zod';

export const stockBody = z.object({
  stock: z.number().int().min(0).max(100_000),
});

// Seule transition faite à la main par l'admin : une commande payée part en expédition
export const orderStatusBody = z.object({
  status: z.literal('shipped'),
});

export const adminOrdersQuery = z.object({
  status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).optional(),
  q: z.string().trim().optional(), // n° de commande, email ou nom du client
});

// Fenêtre d'analyse des métriques, en minutes
export const metricsQuery = z.object({
  window: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(5).max(180)).optional(),
});

export const benchmarkTargetIds = [
  'api-health',
  'api-products',
  'api-product',
  'api-categories',
  'page-home',
  'page-catalog',
  'page-product',
] as const;

export const benchmarkBody = z.object({
  target: z.enum(benchmarkTargetIds),
  iterations: z.number().int().min(10).max(500).default(100),
});
