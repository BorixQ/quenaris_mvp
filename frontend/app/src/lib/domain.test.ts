import { describe, expect, it, vi } from 'vitest';
import { defaultDates, dayCount, limaToday, number, percent } from './format';
import { hectares, parseCsv, polygonError, validateDraft } from './validation';
import { api, ApiError, EXPIRED_EVENT, privateMapRequest, TOKEN_KEY } from './api';
import { analysis, csv, quota } from '../test/fixtures';
import type { Draft } from '../types';

const draft: Draft = { name: '', aoi: analysis.aoi, date_start: '2025-06-01', date_end: '2025-06-15', study_type: 'agro', indices: null, algorithm: 'kmeans', n_clusters: 4, use_pca: false };
describe('dates and actual values', () => {
  it('uses Lima dates before midnight UTC and respects the assigned quota', () => {
    const now = new Date('2026-11-11T02:00:00Z');
    expect(limaToday(now)).toBe('2026-11-10');
    const dates = defaultDates(7, now);
    expect(dates).toEqual({ date_start: '2026-11-03', date_end: '2026-11-10' });
    expect(dayCount(dates.date_start, dates.date_end)).toBe(7);
    expect(dayCount(defaultDates(31, now).date_start, defaultDates(31, now).date_end)).toBe(30);
  });
  it('distinguishes missing and non-finite values from zero', () => {
    expect(number(0)).toBe('0'); expect(percent(0)).toBe('0 %');
    expect(number(null)).toBe('—'); expect(number(NaN)).toBe('—'); expect(number(Infinity)).toBe('—'); expect(percent(undefined)).toBe('No registrada');
  });
});
describe('geometry and operational validation', () => {
  it('imports CSV aliases and closes a ring once', () => {
    const p = parseCsv(csv.replace('lon,lat', 'longitud,latitud'));
    expect(p.coordinates[0]).toHaveLength(5); expect(polygonError(p)).toBeNull(); expect(hectares(p)).toBeGreaterThan(0);
    expect(validateDraft({ ...draft, aoi: p }, quota)).toEqual({});
  });
  it.each(['lon,lat\nNaN,-16\n-72,-16\n-72,-17', 'lon,lat\n0,0\n1,1\n0,1\n1,0', 'x,y\n200,0\n200,1\n201,1', 'foo,bar\n1,2\n2,3\n3,4'])('rejects invalid coordinates: %s', text => expect(() => parseCsv(text)).toThrow());
  it('rejects excessive period, exhausted quota and invalid custom scoring selection', () => {
    expect(validateDraft({ ...draft, date_end: '2026-01-01' }, quota).date_end).toBeTruthy();
    expect(validateDraft(draft, { ...quota, analyses_used: 5 }).quota).toBeTruthy();
    expect(validateDraft({ ...draft, indices: ['Slope'] }, quota).indices).toBeTruthy();
    expect(validateDraft({ ...draft, n_clusters: 13 }, quota).n_clusters).toBeTruthy();
    expect(validateDraft({ ...draft, aoi: null }, quota).aoi).toBeTruthy();
    expect(validateDraft(draft, { ...quota, max_area_ha: .1 }).aoi).toBeTruthy();
  });
  it('accepts periods over one year only when the account quota permits them', () => {
    const extended = { ...draft, date_start: '2024-01-01', date_end: '2025-02-04' };
    expect(dayCount(extended.date_start, extended.date_end)).toBe(400);
    expect(validateDraft(extended, { ...quota, max_date_range_days: 400 }).date_end).toBeUndefined();
    expect(validateDraft(extended, { ...quota, max_date_range_days: 399 }).date_end).toContain('399 días');
  });
});
describe('authenticated requests', () => {
  it('sends credentials only to same-origin private image endpoints', () => {
    sessionStorage.setItem(TOKEN_KEY, 'test-only-token');
    expect(privateMapRequest('/media/heatmaps/a/ndvi/2025-06.png').headers).toEqual({ Authorization: 'Token test-only-token' });
    expect(privateMapRequest('https://example.invalid/media/heatmaps/a.png').headers).toBeUndefined();
    expect(privateMapRequest('/media/heatmaps-other/a.png').headers).toBeUndefined();
    expect(privateMapRequest('http://localhost:9999/media/heatmaps/a.png').headers).toBeUndefined();
  });
  it('expires the session on a 401 and retains field errors', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'test-only-token'); const expired = vi.fn(); window.addEventListener(EXPIRED_EVENT, expired, { once: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Sesión caducada' }), { status: 401, headers: { 'content-type': 'application/json' } })));
    await expect(api('/analyses/')).rejects.toBeInstanceOf(ApiError); expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull(); expect(expired).toHaveBeenCalledOnce();
  });
  it('does not retry a failed creation request', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('network')); vi.stubGlobal('fetch', fetch);
    await expect(api('/analyses/', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 0 }); expect(fetch).toHaveBeenCalledOnce();
  });
});
