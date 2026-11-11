import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { analysis, quota, csv } from '../src/test/fixtures';
import type { Analysis } from '../src/types';

interface Seed { username: string; password: string; analysis_id: string; image_url: string; other_token: string; admin_username: string; admin_password: string }
const test = base.extend<{}, { seed: Seed }>({ seed: [async ({}, use) => {
  const command = 'cd /mnt/c/Users/bq/Documents/ChatGPT/QuenarisTerranode/quenaris_mvp && docker compose -f compose.integration.yml run --rm --no-deps tests python scripts/security_seed.py --reset-login-throttle';
  const raw = execFileSync('wsl', ['-d', 'Ubuntu', '--', 'sh', '-lc', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  await use(JSON.parse(raw.slice(raw.indexOf('{'))));
}, { scope: 'worker' }] });

class App {
  constructor(readonly page: Page) {}
  async login(seed: Seed, audit = false) {
    await this.page.goto('/login');
    if (audit) {
      await expect(this.page.getByLabel('Usuario', { exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page: this.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.violations.map(v => v.id)).toEqual([]);
    }
    await this.page.getByLabel('Usuario', { exact: true }).fill(seed.username);
    await this.page.getByLabel('Contraseña', { exact: true }).fill(seed.password);
    await this.page.getByRole('button', { name: 'Entrar a mi cuenta' }).click();
    await expect(this.page).toHaveURL(/\/analisis$/);
    await expect(this.page.getByRole('heading', { name: 'Mis análisis', level: 1 })).toBeVisible();
  }
  async newAnalysis() {
    await this.page.getByRole('link', { name: 'Nuevo análisis', exact: true }).first().click();
    await this.page.getByLabel('Nombre del análisis').fill('Ejemplo controlado · Parcela CSV');
    await this.page.getByRole('button', { name: 'Continuar', exact: true }).click();
  }
  async importCsv() {
    await this.page.getByRole('button', { name: 'Importar CSV', exact: true }).click();
    await this.page.getByLabel('Archivo de coordenadas CSV').setInputFiles({ name: 'parcela.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(this.page.getByText(/Terreno cargado/)).toBeVisible();
    await this.page.getByRole('button', { name: 'Continuar', exact: true }).click();
  }
  async review() { await this.page.getByRole('button', { name: 'Continuar', exact: true }).click(); await expect(this.page.getByRole('heading', { name: 'Revisa antes de procesar' })).toBeVisible(); }
}

async function controlled(page: Page, seed: Seed, includeActive = false) {
  const complete: Analysis = structuredClone(analysis);
  complete.id = seed.analysis_id;
  complete.result!.heatmap_layers!.indices = ['ndvi'];
  complete.result!.heatmap_layers!.url_template = seed.image_url.replace('/ndvi/2025-06.png', '/{index}/{timestep}.png');
  complete.result!.heatmap_layers!.ranges!.ndvi = { vmin: -.2, vmax: .9 };
  let records: Analysis[] = [complete, { ...structuredClone(complete), id: '22222222-2222-4222-a222-222222222222', name: 'Ejemplo controlado · Sin datos', status: 'FAILED', error_message: 'No hay suficientes píxeles terrestres utilizables.', result: null }];
  if (includeActive) records.push({ ...structuredClone(complete), id: '33333333-3333-4333-a333-333333333333', name: 'Ejemplo controlado · En curso', status: 'PROCESSING', result: null });
  let submissions = 0;
  await page.route('**/api/auth/config/', route => route.fulfill({ json: { google_client_id: '' } }));
  await page.route('**/api/auth/quota/', route => route.fulfill({ json: quota }));
  await page.route('**/api/analyses/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') {
      submissions++; const submitted = { ...structuredClone(complete), ...request.postDataJSON(), id: '44444444-4444-4444-a444-444444444444', status: 'PENDING' as const, result: null };
      records = [submitted, ...records]; return route.fulfill({ status: 202, json: submitted });
    }
    if (url.pathname === '/api/analyses/') return route.fulfill({ json: records });
    const item = records.find(a => url.pathname === `/api/analyses/${a.id}/`);
    return item ? route.fulfill({ json: item }) : route.fulfill({ status: 404, json: { detail: 'No encontrado' } });
  });
  // Synthetic base tiles keep map tests deterministic without changing private PNG access.
  const tokenResponse = await page.request.post('/api/auth/token/', { data: { username: seed.username, password: seed.password } });
  const auth = await tokenResponse.json();
  const png = await page.request.get(seed.image_url, { headers: { Authorization: `Token ${auth.token}` } });
  const tile = await png.body();
  await page.route('https://server.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  return { complete, submissions: () => submissions };
}

for (const width of [360, 1440]) test(`study options stay inside their cards at ${width}px`, async ({ page, seed }) => {
  await page.setViewportSize({ width, height: 1000 });
  await controlled(page, seed); const app = new App(page); await app.login(seed);
  await page.goto('/analisis/nuevo');
  const choices = page.getByRole('radio', { name: /Salud general|Potencial de reforestación|Estado hídrico|Alerta fitosanitaria|Nutrición/ });
  await expect(choices).toHaveCount(5);
  for (const radio of await choices.all()) {
    const bounds = await radio.evaluate(el => {
      const card = el.closest('label')!.getBoundingClientRect();
      const control = el.getBoundingClientRect();
      const text = el.nextElementSibling!.getBoundingClientRect();
      return { card: { left: card.left, right: card.right }, control: { left: control.left, right: control.right, width: control.width }, text: { left: text.left, right: text.right, width: text.width } };
    });
    expect(bounds.control.width).toBeLessThan(30);
    expect(bounds.control.left).toBeGreaterThanOrEqual(bounds.card.left);
    expect(bounds.text.left).toBeGreaterThanOrEqual(bounds.control.right);
    expect(bounds.text.right).toBeLessThanOrEqual(bounds.card.right + 1);
    expect(bounds.text.width).toBeGreaterThan(100);
  }
});

test('recovers once when a lazy asset becomes unavailable after an update', async ({ page, seed }) => {
  const fixture = await controlled(page, seed), app = new App(page); await app.login(seed);
  let failed = false;
  await page.route('**/assets/Detail-*.js', route => {
    if (!failed) { failed = true; return route.abort('failed'); }
    return route.continue();
  });
  await page.getByRole('link', { name: 'Ejemplo controlado · Queñua', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/analisis/${fixture.complete.id}$`));
  await expect(page.getByRole('heading', { name: 'Ejemplo controlado · Queñua', level: 1 })).toBeVisible();
  expect(failed).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('quenaris:last-asset-reload'))).toBeTruthy();
  expect(fixture.submissions()).toBe(0);
});

test('CSV creation, single submission and recovery after reload', async ({ page, seed }) => {
  const fixture = await controlled(page, seed); const app = new App(page); await app.login(seed, true); await app.newAnalysis(); await app.importCsv();
  const start = await page.getByLabel('Desde (incluido)').inputValue(), end = await page.getByLabel('Hasta (excluido)').inputValue();
  expect((Date.parse(end) - Date.parse(start)) / 86400000).toBeLessThanOrEqual(31);
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Mis análisis', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '¿Descartar este borrador?' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Volver', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Descartar y salir' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  const wizardAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(wizardAudit.violations.map(v => v.id)).toEqual([]);
  await app.review(); await page.getByRole('button', { name: 'Procesar área', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Tu análisis está en cola' })).toBeVisible(); expect(fixture.submissions()).toBe(1);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Tu análisis está en cola' })).toBeVisible();
});

test('drawing a polygon updates the reviewable area', async ({ page, seed }) => {
  page.on('pageerror', error => console.log('Map runtime error:', error.message));
  page.on('console', message => { if (message.text().startsWith('Quenaris map:')) console.log(message.text()); });
  await controlled(page, seed); const app = new App(page); await app.login(seed); await app.newAnalysis();
  const draw = page.getByRole('button', { name: 'Dibujar polígono', exact: true }); await expect(draw).toBeEnabled();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Acercar', exact: true }).click();
  await draw.click();
  const expanded = page.getByRole('dialog', { name: 'Dibujar terreno en mapa ampliado' });
  await expect(expanded).toBeVisible(); await expect(expanded.getByRole('button', { name: 'Listo, volver al análisis' })).toBeFocused();
  const canvas = page.getByLabel('Mapa para dibujar el área de interés; también puedes cargar un CSV');
  const box = await canvas.boundingBox(); expect(box).toBeTruthy(); const x = box!.width * .43, y = box!.height * .4, size = 20;
  await canvas.click({ position: { x, y } }); await canvas.click({ position: { x: x + size, y } }); await canvas.click({ position: { x: x + size, y: y + size } }); await canvas.click({ position: { x, y: y + size } }); await canvas.click({ position: { x, y } });
  await expect(page.getByText(/Terreno cargado/)).toBeVisible();
  await expanded.getByRole('button', { name: 'Listo, volver al análisis' }).click();
  await expect(expanded).not.toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await expect(page.getByLabel('Desde (incluido)')).toBeVisible();
});

for (const width of [360, 1440]) test(`expanded result maps retain controls and legend at ${width}px`, async ({ page, seed }) => {
  await page.setViewportSize({ width, height: 900 });
  const fixture = await controlled(page, seed), app = new App(page); await app.login(seed);
  for (const view of ['?vista=mapa', '/3d']) {
    await page.goto(`/analisis/${fixture.complete.id}${view}`);
    const button = page.getByRole('button', { name: 'Ampliar mapa' }); await button.click();
    const dialog = page.getByRole('dialog', { name: view === '/3d' ? 'Exploración en 3D' : 'Mapa de resultados' });
    await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Salir de vista ampliada' })).toBeFocused();
    await expect(dialog.getByText('Grupos espectrales')).toBeVisible();
    const map = dialog.getByTestId('geo-map'), bounds = await map.boundingBox(); expect(bounds!.height).toBeGreaterThan(400);
    await dialog.getByLabel('Capa', { exact: true }).selectOption('ndvi');
    await expect(dialog.getByText('Leyenda de colores no registrada en este análisis histórico.')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    await expect(button).toBeFocused(); await expect(page.getByLabel('Capa', { exact: true })).toHaveValue('ndvi');
    await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  }
});

test('real protected image, foreign access denied and no external token', async ({ page, seed }) => {
  page.on('pageerror', error => console.log('Map runtime error:', error.message));
  page.on('console', message => { if (message.text().startsWith('Quenaris map:')) console.log(message.text()); });
  const fixture = await controlled(page, seed), leaked: string[] = [];
  page.on('request', request => { if (new URL(request.url()).origin !== 'http://localhost:8080' && request.headers().authorization) leaked.push(request.url()); });
  const app = new App(page); await app.login(seed); await page.goto(`/analisis/${fixture.complete.id}?vista=mapa`);
  const response = page.waitForResponse(r => r.url().endsWith(seed.image_url));
  await page.getByRole('combobox', { name: 'Capa', exact: true }).selectOption('ndvi');
  const png = await response; expect(png.status()).toBe(200); expect(png.headers()['cache-control']).toContain('no-store'); expect(png.request().headers().authorization).toMatch(/^Token /);
  expect((await page.request.get(seed.image_url)).status()).toBe(401);
  expect((await page.request.get(seed.image_url, { headers: { Authorization: `Token ${seed.other_token}` } })).status()).toBe(404);
  expect(leaked).toEqual([]); await expect(page.getByText('Leyenda de colores no registrada en este análisis histórico.')).toBeVisible();
  await page.getByRole('link', { name: 'Datos técnicos', exact: true }).click(); await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  await page.getByRole('link', { name: 'Mapa', exact: true }).click(); await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  fixture.complete.result!.heatmap_layers!.legends = { ndvi: { vmin: -.2, vmax: .9, colors: ['#a50026', '#ffffbf', '#006837'] } };
  await page.reload(); await page.getByRole('combobox', { name: 'Capa', exact: true }).selectOption('ndvi');
  await expect(page.getByRole('img', { name: 'Escala de -0.2 a 0.9', exact: true })).toBeVisible();
  const mapAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(mapAudit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
});

test('failure, partial result, missing values and legacy links', async ({ page, seed }) => {
  const fixture = await controlled(page, seed), app = new App(page); await app.login(seed);
  await page.getByRole('link', { name: 'Ejemplo controlado · Sin datos', exact: true }).click(); await expect(page.getByText('No hay suficientes píxeles terrestres utilizables.')).toBeVisible();
  await page.goto(`/informes.html?id=${fixture.complete.id}`); await expect(page).toHaveURL(new RegExp(`/analisis/${fixture.complete.id}/informe$`));
  await expect(page.getByRole('heading', { name: 'Informe factual del análisis' })).toBeVisible();
  await page.goto(`/analisis/${fixture.complete.id}?vista=datos`); await expect(page.getByRole('cell', { name: '—', exact: true }).first()).toBeVisible(); await expect(page.getByRole('cell', { name: '0 /100', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Valores por grupo' })).toBeVisible();
  fixture.complete.result!.heatmap_layers = null;
  await page.goto(`/analisis/${fixture.complete.id}`);
  await expect(page.getByText('No se generaron capas mensuales. Las estadísticas de grupos y el informe siguen disponibles.')).toBeVisible();
});

test('3D is loaded on demand and releases its map on navigation', async ({ page, seed }) => {
  const fixture = await controlled(page, seed), app = new App(page); await app.login(seed);
  await page.goto(`/analisis/${fixture.complete.id}/3d`);
  await expect(page.getByRole('heading', { name: 'El terreno en perspectiva' })).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  await page.getByRole('link', { name: 'Datos técnicos', exact: true }).click();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
});

test('session expiry clears the UI and logout revokes the server token', async ({ page, seed }) => {
  await controlled(page, seed); const app = new App(page); await app.login(seed);
  const oldToken = await page.evaluate(() => sessionStorage.getItem('gi_token'));
  await page.goto('/perfil'); await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem('gi_token'))).toBeNull();
  expect((await page.request.get('/api/analyses/', { headers: { Authorization: `Token ${oldToken}` } })).status()).toBe(401);
  await app.login(seed);
  await page.route('**/api/analyses/**', route => route.fulfill({ status: 401, json: { detail: 'Sesión caducada' } }));
  await page.goto('/analisis'); await expect(page).toHaveURL(/\/login$/); expect(await page.evaluate(() => sessionStorage.getItem('gi_token'))).toBeNull();
});

for (const width of [360, 768, 1440]) test(`responsive, keyboard and accessibility at ${width}px`, async ({ page, seed }) => {
  const fixture = await controlled(page, seed), app = new App(page); await page.setViewportSize({ width, height: 1000 }); await app.login(seed);
  await expect(page.getByRole('link', { name: 'Nuevo análisis', exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  const evidence = resolve('../../docs/frontend/evidence'); mkdirSync(evidence, { recursive: true });
  await page.getByRole('heading', { name: 'Mis análisis', level: 1 }).focus();
  await page.screenshot({ path: resolve(evidence, `analyses-${width}.png`), fullPage: true });
  if (width === 1440) { const { writeFileSync } = await import('node:fs'); writeFileSync(resolve(evidence, 'rendered-analyses.html'), await page.content()); }
  await page.goto(`/analisis/${fixture.complete.id}/informe`); await expect(page.getByRole('heading', { name: 'Informe factual del análisis' })).toBeVisible();
  const reportAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(reportAudit.violations.map(v => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: resolve(evidence, `report-${width}.png`), fullPage: true });
  if (width === 1440) {
    await expect(page.locator('canvas')).toHaveCount(2);
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).not.toBeVisible();
    await page.pdf({ path: resolve(evidence, 'report-controlled.pdf'), format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  }
});
