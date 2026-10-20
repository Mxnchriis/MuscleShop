import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

// Erreurs renvoyées en JSON { error } pour que le front puisse afficher le message
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Erreur interne' }, 500);
};
