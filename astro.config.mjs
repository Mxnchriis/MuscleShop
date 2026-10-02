// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// SSR obligatoire : l'API Hono est servie par Astro sur /api
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
