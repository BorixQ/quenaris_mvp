import { test as base, expect, type Browser } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Account { username: string; password: string }
interface ProjectAccount extends Account { analysis_id: string; analysis_name: string }
interface Seed extends ProjectAccount { admin: ProjectAccount; reader: Account }
const test = base.extend<{}, { seed: Seed }>({ seed: [async ({}, use) => {
  const raw = execFileSync('wsl', ['-d', 'Ubuntu', '--cd', '/mnt/c/Users/bq/Documents/ChatGPT/QuenarisTerranode/quenaris_mvp', '--',
    'docker', 'compose', '-f', 'compose.integration.yml', 'run', '--rm', '--no-deps', 'tests', 'python', 'scripts/sharing_seed.py', '--discovery'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  await use(JSON.parse(raw.slice(raw.indexOf('{'))) as Seed);
}, { scope: 'worker' }] });

async function signed(browser: Browser, baseURL: string, account: Account, width: number) {
  const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 } });
  const response = await context.request.post('/api/auth/token/', { data: { username: account.username, password: account.password } });
  expect(response.status()).toBe(200);
  const { token } = await response.json();
  await context.addInitScript(value => sessionStorage.setItem('gi_token', value), token);
  const page = await context.newPage();
  return { context, page, headers: { Authorization: `Token ${token}` } };
}

for (const width of [1440, 360]) test(`public home, saved incoming projects and staff curation at ${width}px`, async ({ browser, baseURL, seed }) => {
  test.setTimeout(120000);
  const owner = await signed(browser, baseURL!, seed, width), admin = await signed(browser, baseURL!, seed.admin, width), reader = await signed(browser, baseURL!, seed.reader, width);
  const visitor = await browser.newContext({ baseURL, viewport: { width, height: 1000 } }), publicPage = await visitor.newPage();
  const evidence = resolve('../../docs/frontend/evidence'); mkdirSync(evidence, { recursive: true });
  const local = resolve('../../.local-backups'); mkdirSync(local, { recursive: true });
  // Each pass resets only these synthetic links, never real user analyses.
  for (const target of [{ actor: owner, id: seed.analysis_id }, { actor: admin, id: seed.admin.analysis_id }]) {
    expect((await target.actor.context.request.post(`/api/analyses/${target.id}/sharing/`, { headers: target.actor.headers, data: { enabled: false } })).status()).toBe(200);
  }
  await owner.page.goto(`/analisis/${seed.analysis_id}`);
  await owner.page.getByRole('switch', { name: 'Compartir por enlace' }).click();
  const sharedURL = await owner.page.getByLabel('Enlace para compartir').inputValue();
  await admin.page.goto(sharedURL);
  await admin.page.getByRole('button', { name: 'Guardar en Compartidos conmigo' }).click();
  await admin.page.getByRole('link', { name: 'Ver mi colección' }).click();
  await expect(admin.page.getByRole('heading', { name: 'Compartidos conmigo', exact: true })).toBeVisible();
  await admin.page.getByRole('link', { name: seed.analysis_name, exact: true }).click();
  await admin.page.getByLabel('Descripción para la portada (opcional)').fill('Datos simulados para explorar la función de compartir y la selección de proyectos recibidos.');
  await admin.page.getByRole('button', { name: 'Destacar proyecto', exact: true }).click();
  await expect(admin.page.getByRole('button', { name: 'Quitar de destacados' })).toBeVisible();
  await admin.page.getByLabel('Imagen de la tarjeta (opcional)').setInputFiles({ name: 'muestra.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXkAAAAASUVORK5CYII=', 'base64') });
  await expect(admin.page.getByAltText('Vista previa de la imagen del proyecto destacado')).toBeVisible();
  await admin.page.screenshot({ path: resolve(evidence, `discovery-curate-received-${width}.png`), fullPage: true });
  await admin.page.goto(`/analisis/${seed.admin.analysis_id}`);
  await expect(admin.page.getByRole('button', { name: 'Destacar proyecto' })).toBeDisabled();
  await admin.page.getByRole('switch', { name: 'Compartir por enlace' }).click();
  await admin.page.getByLabel('Descripción para la portada (opcional)').fill('Ejemplo simulado de un proyecto propio destacado por una cuenta administradora.');
  await admin.page.getByRole('button', { name: 'Destacar proyecto', exact: true }).click();
  await expect(admin.page.getByRole('button', { name: 'Quitar de destacados' })).toBeVisible();
  await admin.page.screenshot({ path: resolve(evidence, `discovery-admin-${width}.png`), fullPage: true });

  await publicPage.goto('/');
  await expect(publicPage.getByRole('heading', { level: 1 })).toHaveText(/Explora el territorio/);
  await expect(publicPage.getByRole('link', { name: seed.analysis_name, exact: true })).toBeVisible();
  await expect(publicPage.getByRole('link', { name: seed.admin.analysis_name, exact: true })).toBeVisible();
  await expect(publicPage.locator('article').filter({ hasText: seed.analysis_name }).locator('img')).toBeVisible();
  expect(await publicPage.evaluate(() => sessionStorage.getItem('gi_token'))).toBeNull();
  await publicPage.screenshot({ path: resolve(evidence, `discovery-home-${width}.png`), fullPage: true });
  const audit = await new AxeBuilder({ page: publicPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(v => v.id)).toEqual([]);
  expect(await publicPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await publicPage.goto('/login');
  await publicPage.getByRole('link', { name: 'Ver proyectos destacados', exact: true }).click();
  await expect(publicPage.getByRole('heading', { name: 'Proyectos destacados', exact: true })).toBeVisible();
  await publicPage.screenshot({ path: resolve(evidence, `discovery-gallery-${width}.png`), fullPage: true });

  await reader.page.goto(sharedURL);
  await reader.page.getByRole('button', { name: 'Guardar en Compartidos conmigo' }).click();
  await reader.page.getByRole('link', { name: 'Ver mi colección' }).click();
  await expect(reader.page.getByRole('heading', { name: 'Compartidos conmigo', exact: true })).toBeVisible();
  await expect(reader.page.getByRole('link', { name: seed.analysis_name, exact: true })).toBeVisible();
  await reader.page.screenshot({ path: resolve(evidence, `discovery-received-${width}.png`), fullPage: true });
  const receivedAudit = await new AxeBuilder({ page: reader.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(receivedAudit.violations.map(v => v.id)).toEqual([]);
  expect(await reader.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await reader.page.getByRole('link', { name: seed.analysis_name, exact: true }).click();
  await expect(reader.page.getByText('Guardado en Compartidos conmigo', { exact: true })).toBeVisible();
  await expect(reader.page.getByRole('button', { name: 'Destacar proyecto' })).toHaveCount(0);

  await owner.page.getByRole('switch', { name: 'Compartir por enlace' }).click();
  await expect(owner.page.getByRole('switch', { name: 'Compartir por enlace' })).not.toBeChecked();
  const after = await (await visitor.request.get('/api/featured/')).json();
  expect(after.results.some((item: { analysis_id: string }) => item.analysis_id === seed.analysis_id)).toBe(false);
  expect(after.results.some((item: { analysis_id: string }) => item.analysis_id === seed.admin.analysis_id)).toBe(true);
  await reader.page.goto('/compartidos-conmigo');
  await expect(reader.page.getByText(/Acceso retirado/)).toBeVisible();
  await expect(reader.page.getByRole('link', { name: seed.analysis_name, exact: true })).toHaveCount(0);
  await owner.page.getByRole('switch', { name: 'Compartir por enlace' }).click();
  const newURL = await owner.page.getByLabel('Enlace para compartir').inputValue();
  expect(newURL).not.toBe(sharedURL);
  await reader.page.reload();
  await expect(reader.page.getByText(/Acceso retirado/)).toBeVisible();
  // Leave a complete synthetic preview for the user's local review.
  await reader.page.goto(newURL);
  await reader.page.getByRole('button', { name: 'Guardar en Compartidos conmigo' }).click();
  await admin.page.goto(newURL);
  await admin.page.getByLabel('Descripción para la portada (opcional)').fill('Datos simulados para explorar la función de compartir y la selección de proyectos recibidos.');
  await admin.page.getByRole('button', { name: 'Destacar proyecto', exact: true }).click();
  await expect(admin.page.getByRole('button', { name: 'Quitar de destacados' })).toBeVisible();
  writeFileSync(resolve(local, 'discovery-preview.json'), JSON.stringify({ ...seed, shared_url: newURL }, null, 2));
  writeFileSync(resolve(evidence, 'discovery-preview.json'), JSON.stringify({ home: baseURL, featured: `${baseURL}/destacados`, received: `${baseURL}/compartidos-conmigo`, shared: newURL, synthetic: true }, null, 2));
  await owner.context.close(); await admin.context.close(); await reader.context.close(); await visitor.close();
});
