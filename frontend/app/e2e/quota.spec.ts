import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { quota } from '../src/test/fixtures';

for (const width of [360, 1440]) test(`trial balance and brand at ${width}px`, async ({ page }) => {
  const trial = { ...quota, analyses_allowed: 1, analyses_used: 1, max_area_ha: 10, max_date_range_days: 124,
    area_allowance_ha: 10, area_used_ha: 3, area_remaining_ha: 7 };
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => sessionStorage.setItem('gi_token', 'controlled-test-token'));
  await page.route('**/api/auth/quota/', route => route.fulfill({ json: trial }));
  await page.route('**/api/analyses/', route => route.fulfill({ json: [] }));
  await page.goto('/perfil');
  await expect(page.getByRole('link', { name: 'Queñaris, mis análisis' })).toBeVisible();
  await expect(page.getByText('ha disponibles')).toBeVisible();
  await expect(page.getByText('3 de 10 ha')).toBeVisible();
  await expect(page.getByText('124 días (aproximadamente 4 meses)')).toBeVisible();
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(v => v.id)).toEqual([]);
  await page.goto('/analisis/nuevo');
  await expect(page.getByText('ha disponibles')).toBeVisible();
  await expect(page.getByText('124 días (aproximadamente 4 meses)')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Define el área de interés' })).toBeVisible();
});
