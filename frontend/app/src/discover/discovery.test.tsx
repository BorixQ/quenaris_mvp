import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/Auth';
import { TOKEN_KEY } from '../lib/api';
import { sharedTokenFromLink } from '../lib/sharing';
import Home from './Home';
import Received from '../analyses/Received';
import SharedActions from '../analyses/SharedActions';
import OwnerFeaturedControl from '../analyses/FeaturedControl';
import { analysis, quota } from '../test/fixtures';
import type { ProjectSummary } from '../types';

const token = '22222222-2222-4222-a222-222222222222';
const project: ProjectSummary = { name: 'Parcela compartida', analysis_id: analysis.id, aoi: analysis.aoi, share_path: `/compartido/${token}`, study_type: 'agro', area_ha: 1.3, date_start: '2025-06-01', date_end: '2025-08-01', description: 'Un ejemplo destacado por la administración.' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function mount(element: React.ReactNode, path = '/') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: '*', element }, { path: '/login', element: <h1>Iniciar sesión</h1> }], { initialEntries: [path] });
  render(<QueryClientProvider client={cache}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>);
  return { cache, router };
}

describe('Public discovery', () => {
  it('shows projects without sign-in or account requests and offers access to the workspace', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json({ count: 1, next: null, previous: null, results: [project] })));
    vi.stubGlobal('fetch', fetch); mount(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Explora el territorio.');
    expect(await screen.findByRole('link', { name: project.name })).toHaveAttribute('href', project.share_path);
    expect(screen.getByRole('link', { name: /Crear mi análisis/ })).toHaveAttribute('href', '/analisis/nuevo');
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe('/api/featured/?page=1'); expect(new Headers(init.headers).has('Authorization')).toBe(false);
    }
  });

  it('paginates the public gallery and explains an empty collection', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(json(url.endsWith('page=2') ? { count: 10, previous: '?page=1', next: null, results: [{ ...project, name: 'Segunda página' }] } : { count: 10, previous: null, next: '?page=2', results: [project] }))));
    mount(<Home gallery />, '/destacados');
    await screen.findByRole('link', { name: project.name });
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('link', { name: 'Segunda página' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('does not invent example projects when no one has selected any', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ count: 0, next: null, previous: null, results: [] })));
    mount(<Home />);
    expect(await screen.findByRole('heading', { name: 'Los primeros destacados están por llegar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Explorar análisis' })).not.toBeInTheDocument();
  });
});

describe('Incoming shared links', () => {
  it('parses a local link and rejects arbitrary or other-server URLs', () => {
    expect(sharedTokenFromLink(`/compartido/${token}?vista=mapa`, 'http://localhost')).toBe(token);
    expect(sharedTokenFromLink(`http://localhost/compartido/${token}/informe`, 'http://localhost')).toBe(token);
    for (const text of [`https://other.invalid/compartido/${token}`, 'javascript:alert(1)', '/analisis/123', '/compartido/not-a-token']) expect(() => sharedTokenFromLink(text, 'http://localhost')).toThrow();
  });

  it('asks anonymous visitors to sign in and preserves the shared destination', async () => {
    const user = userEvent.setup(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const path = `/compartido/${token}?vista=mapa`;
    const { router } = mount(<SharedActions shareToken={token} analysisId={analysis.id} />, path);
    await user.click(screen.getByRole('link', { name: /Entrar para guardar/ }));
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state.from).toBe(path);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves an incoming analysis only after an explicit click', async () => {
    const user = userEvent.setup(); sessionStorage.setItem(TOKEN_KEY, 'test-only-token');
    const fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => Promise.resolve(json(init.method === 'POST' ? { is_saved: true, id: 1 } : { is_saved: false, is_owner: false, can_feature: false, is_featured: false, featured_description: '' })));
    vi.stubGlobal('fetch', fetch); mount(<SharedActions shareToken={token} analysisId={analysis.id} />);
    const button = await screen.findByRole('button', { name: 'Guardar en Compartidos conmigo' });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(fetch.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
    await user.click(button);
    expect(await screen.findByRole('status')).toHaveTextContent('Guardado en Compartidos conmigo');
    expect(screen.queryByRole('button', { name: 'Destacar proyecto' })).not.toBeInTheDocument();
  });

  it('retains a withdrawn link as unavailable and removes only its saved entry', async () => {
    const user = userEvent.setup(); let removed = false;
    const fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (init.method === 'DELETE') { removed = true; return Promise.resolve(new Response(null, { status: 204 })); }
      return Promise.resolve(json({ count: removed ? 0 : 1, next: null, previous: null, results: removed ? [] : [{ id: 7, name: 'Acceso anterior', saved_at: '2026-11-13T12:00:00Z', available: false, share_path: null }] }));
    });
    vi.stubGlobal('fetch', fetch); mount(<Received />, '/compartidos-conmigo');
    expect(await screen.findByRole('heading', { name: 'Acceso anterior' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Acceso anterior' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quitar Acceso anterior de mi colección' }));
    expect(await screen.findByRole('heading', { name: 'Aún no has guardado análisis recibidos' })).toBeInTheDocument();
    expect(fetch.mock.calls.find(([, init]) => init.method === 'DELETE')?.[0]).toBe('/api/received/7/');
  });
});

describe('Administrator selections', () => {
  it('lets staff without superuser privileges feature their shared project', async () => {
    const user = userEvent.setup(); let featured = false;
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/quota/')) return Promise.resolve(json({ ...quota, is_staff: true }));
      featured = true; return Promise.resolve(json({ is_featured: true, featured_description: 'Texto público' }));
    });
    vi.stubGlobal('fetch', fetch);
    const { cache } = mount(<OwnerFeaturedControl analysis={{ ...analysis, sharing_enabled: true }} />);
    cache.setQueryData(['analysis', analysis.id], { ...analysis, sharing_enabled: true });
    await user.type(await screen.findByLabelText('Descripción para la portada (opcional)'), 'Texto público');
    await user.click(screen.getByRole('button', { name: 'Destacar proyecto' }));
    expect(await screen.findByRole('status')).toHaveTextContent('El proyecto ya aparece');
    expect(featured).toBe(true);
    expect(cache.getQueryData(['analysis', analysis.id])).toMatchObject({ is_featured: true, featured_description: 'Texto público' });
  });

  it('requires the owner switch before showing their private project to the public', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...quota, is_staff: true })));
    mount(<OwnerFeaturedControl analysis={{ ...analysis, sharing_enabled: false }} />);
    expect(await screen.findByRole('button', { name: 'Destacar proyecto' })).toBeDisabled();
    expect(screen.getByText(/Activa «Compartir por enlace»/)).toBeInTheDocument();
  });
});
