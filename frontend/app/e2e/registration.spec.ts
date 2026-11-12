import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { quota } from '../src/test/fixtures';

for (const width of [360, 1440]) test(`email sign-in with controlled service at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/auth/config/', route => route.fulfill({ json: { google_client_id: '', public_signup: true, email_code_enabled: true } }));
  await page.route('**/api/auth/email/request/', route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'demo@example.invalid' });
    return route.fulfill({ json: { detail: 'Mensaje de prueba.' } });
  });
  await page.route('**/api/auth/email/verify/', route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'demo@example.invalid', code: '12345678' });
    return route.fulfill({ json: { token: 'test-only-token' } });
  });
  await page.route('**/api/auth/quota/', route => route.fulfill({ json: quota }));
  await page.route('**/api/analyses/', route => route.fulfill({ json: [] }));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Recibir un código por correo' }).click();
  await page.getByLabel('Correo electrónico').fill('demo@example.invalid');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  const code = page.getByLabel('Código de 8 dígitos');
  await expect(code).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await code.fill('12345678');
  await page.getByRole('button', { name: 'Verificar y entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Mis análisis', level: 1 })).toBeVisible();
});
