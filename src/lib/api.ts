import { hc } from 'hono/client';
import type { AppType } from '../server/app';

// Client RPC typé : api.api.products.$get(), etc.
export const createApi = (baseUrl: string) => hc<AppType>(baseUrl);
