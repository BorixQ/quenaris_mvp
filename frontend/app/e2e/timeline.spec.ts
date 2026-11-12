import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { analysis, quota } from '../src/test/fixtures';

const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');

for (const width of [360, 1440]) for (const terrain of [false, true]) {
  test(`monthly timeline at ${width}px, 3D=${terrain}`, async ({ page }) => {
    const sample = structuredClone(analysis);
    sample.result!.heatmap_layers!.timesteps = ['2025-06', '2025-08', '2026-01'];
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => sessionStorage.setItem('gi_token', 'controlled-test-token'));
    await page.route('**/api/auth/quota/', route => route.fulfill({ json: quota }));
    await page.route('**/api/analyses/**', route => route.fulfill({ json: sample }));
    await page.route('**/media/heatmaps/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
    await page.route('https://server.arcgisonline.com/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
    await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
    await page.goto(`/analisis/${sample.id}${terrain ? '/3d' : '?vista=mapa'}`);
    await page.getByLabel('Capa', { exact: true }).selectOption('ndmi');
    const timeline = page.getByRole('slider', { name: /Mes:/ });
    await expect(timeline).toHaveAttribute('aria-valuetext', 'junio de 2025');
    await timeline.focus();
    await page.keyboard.press('ArrowRight');
    await expect(timeline).toHaveAttribute('aria-valuetext', 'agosto de 2025');
    await page.getByRole('button', { name: 'Mes disponible siguiente' }).click();
    await expect(timeline).toHaveAttribute('aria-valuetext', 'enero de 2026');
    await expect(page.getByRole('button', { name: 'Mes disponible siguiente' })).toBeDisabled();
    await page.getByRole('button', { name: 'Ampliar mapa' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(timeline).toBeVisible();
    const audit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByLabel('Capa', { exact: true }).selectOption('__zones__');
    await expect(page.getByRole('slider', { name: /Mes:/ })).toHaveCount(0);
  });
}
