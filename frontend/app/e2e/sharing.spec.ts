import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const width of [1440, 360]) test(`real sharing switch and anonymous revocation at ${width}px`, async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  const raw = execFileSync('wsl', ['-d', 'Ubuntu', '--cd', '/mnt/c/Users/bq/Documents/ChatGPT/QuenarisTerranode/quenaris_mvp', '--',
    'docker', 'compose', '-f', 'compose.integration.yml', 'run', '--rm', '--no-deps', 'tests', 'python', 'scripts/sharing_seed.py'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const seed = JSON.parse(raw.slice(raw.indexOf('{'))) as { username: string; password: string; analysis_id: string };
  const evidence = resolve('../../docs/frontend/evidence'); mkdirSync(evidence, { recursive: true });
  const local = resolve('../../.local-backups'); mkdirSync(local, { recursive: true });
  await page.setViewportSize({ width, height: 1000 });
  const login = await page.request.post('/api/auth/token/', { data: { username: seed.username, password: seed.password } });
  expect(login.status()).toBe(200);
  const { token } = await login.json();
  await page.addInitScript(value => sessionStorage.setItem('gi_token', value), token);
  await page.goto(`/analisis/${seed.analysis_id}`);
  const toggle = page.getByRole('switch', { name: 'Compartir por enlace' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByLabel('Enlace para compartir')).toHaveCount(0);
  await toggle.click(); await expect(toggle).toBeChecked();
  const sharedURL = await page.getByLabel('Enlace para compartir').inputValue();
  expect(sharedURL.startsWith(`${baseURL}/compartido/`)).toBe(true);
  await expect(page.getByRole('link', { name: 'Abrir enlace' })).toHaveAttribute('href', sharedURL);
  await page.screenshot({ path: resolve(evidence, `sharing-owner-${width}.png`), fullPage: true });
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(a11y.violations.map(item => item.id)).toEqual([]);

  const visitor = await browser.newContext({ viewport: { width, height: 1000 } });
  const publicPage = await visitor.newPage();
  await publicPage.goto(sharedURL);
  await expect(publicPage.getByRole('heading', { level: 1, name: 'Demostración · compartir análisis' })).toBeVisible();
  await expect(publicPage.getByRole('switch')).toHaveCount(0);
  await expect(publicPage.getByRole('button', { name: 'Eliminar este análisis' })).toHaveCount(0);
  expect(await publicPage.evaluate(() => sessionStorage.getItem('gi_token'))).toBeNull();
  await publicPage.screenshot({ path: resolve(evidence, `sharing-public-${width}.png`), fullPage: true });
  const publicAudit = await new AxeBuilder({ page: publicPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(publicAudit.violations.map(item => item.id)).toEqual([]);
  await publicPage.getByRole('link', { name: 'Informe', exact: true }).click();
  await expect(publicPage.getByText('No representan un estudio real de Seal ni una evaluación agronómica.')).toBeVisible();
  const apiPath = new URL(sharedURL).pathname.replace('/compartido/', '/api/shared/') + '/';
  const response = await visitor.request.get(apiPath);
  expect(response.status()).toBe(200);
  const data = await response.json(); expect(data.user_email).toBeUndefined();
  const imageURL = data.result.heatmap_layers.url_template.replace('{index}', 'ndvi').replace('{timestep}', '2025-06');
  const image = await visitor.request.get(imageURL); expect(image.status()).toBe(200);
  expect(image.headers()['cache-control']).toContain('no-store');
  const tile = await image.body();
  await publicPage.route('https://server.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await publicPage.getByRole('link', { name: 'Mapa', exact: true }).click();
  const loaded = publicPage.waitForResponse(r => r.url().includes('/heatmaps/ndvi/') && r.status() === 200);
  await publicPage.getByLabel('Capa', { exact: true }).selectOption('ndvi');
  await loaded;
  await expect(publicPage.getByRole('slider', { name: /Mes:/ })).toBeVisible();
  await expect(publicPage.getByText('junio de 2025', { exact: true }).first()).toBeVisible();
  await publicPage.screenshot({ path: resolve(evidence, `sharing-map-${width}.png`), fullPage: true });
  await page.getByRole('switch', { name: 'Compartir por enlace' }).click();
  await expect(toggle).not.toBeChecked();
  expect((await visitor.request.get(apiPath)).status()).toBe(404);
  expect((await visitor.request.get(imageURL)).status()).toBe(404);
  // The already-open visitor also drops the result when it next rechecks access.
  await expect(publicPage.getByRole('heading', { name: 'Análisis no disponible' })).toBeVisible({ timeout: 22000 });
  await publicPage.reload();
  await expect(publicPage.getByRole('heading', { name: 'Análisis no disponible' })).toBeVisible();
  await page.reload(); await expect(toggle).not.toBeChecked();
  await toggle.click(); await expect(toggle).toBeChecked();
  const newURL = await page.getByLabel('Enlace para compartir').inputValue();
  expect(newURL).not.toBe(sharedURL);
  expect((await visitor.request.get(apiPath)).status()).toBe(404);
  await publicPage.goto(newURL);
  await expect(publicPage.getByRole('heading', { level: 1, name: 'Demostración · compartir análisis' })).toBeVisible();
  const overflow = await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  if (width === 1440) {
    writeFileSync(resolve(local, 'sharing-preview.json'), JSON.stringify({ ...seed, owner_url: `${baseURL}/analisis/${seed.analysis_id}`, shared_url: newURL }, null, 2));
    writeFileSync(resolve(evidence, 'sharing-preview.json'), JSON.stringify({ owner_path: `/analisis/${seed.analysis_id}`, shared_url: newURL, synthetic: true }, null, 2));
  }
  await visitor.close();
});
