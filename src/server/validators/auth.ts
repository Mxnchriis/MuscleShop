import { z } from 'zod';

export const loginBody = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const registerBody = loginBody.extend({
  name: z.string().min(1),
});
