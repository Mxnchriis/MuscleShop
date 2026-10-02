import { z } from 'zod';

export const productListQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
});
