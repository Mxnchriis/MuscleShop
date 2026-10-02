import { expect, test } from '@playwright/test';

test("l'accueil mène au catalogue", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Voir le catalogue' }).click();
  await expect(page.getByRole('heading', { name: 'Catalogue' })).toBeVisible();
});
