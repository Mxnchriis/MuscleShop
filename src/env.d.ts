/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly STRIPE_SECRET_KEY: string;
  readonly JWT_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    user: import('./types').SessionUser | null;
    cartCount: number;
  }
}
