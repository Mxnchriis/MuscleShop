import { z } from 'zod';

export const cartItemBody = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1),
});
