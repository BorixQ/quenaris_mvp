import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Detail from './Detail';
import SharedLayout from '../components/SharedLayout';
import { TOKEN_KEY } from '../lib/api';
import { AuthProvider } from '../auth/Auth';
import { analysis } from '../test/fixtures';

vi.mock('../maps/GeoMap', () => ({ default: () => <div aria-label="Mapa de prueba" /> }));
const shareToken = '22222222-2222-4222-a222-222222222222';
const path = `/compartido/${shareToken}`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function mount(shared = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/analisis/:id/*', element: <Detail /> },
    { element: <SharedLayout />, children: [{ path: '/compartido/:id/*', element: <Detail shared /> }] },
  ], { initialEntries: [shared ? path : `/analisis/${analysis.id}`] });
  render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>);
  return { client, router };
}

describe('Sharing an analysis', () => {
  it('activates and revokes through the owner switch, retaining state from the API', async () => {
    const user = userEvent.setup(); let enabled = false;
    const fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith('/sharing/')) {
        enabled = JSON.parse(String(init.body)).enabled;
        return Promise.resolve(json({ sharing_enabled: enabled, share_path: enabled ? path : null }));
      }
      return Promise.resolve(json(url === '/api/analyses/' ? [] : { ...analysis, sharing_enabled: enabled, share_path: enabled ? path : null }));
    });
    vi.stubGlobal('fetch', fetch); mount();
    const toggle = await screen.findByRole('switch', { name: 'Compartir por enlace' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByLabelText('Enlace para compartir')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(await screen.findByLabelText('Enlace para compartir')).toHaveValue(new URL(path, location.origin).href);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(await navigator.clipboard.readText()).toBe(new URL(path, location.origin).href);
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(screen.queryByLabelText('Enlace para compartir')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('El enlace anterior dejó de funcionar');
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/sharing/'))).toHaveLength(2);
  });

  it('keeps the switch unchanged when saving fails and prevents duplicate submissions', async () => {
    const user = userEvent.setup(); let finish: (value: Response) => void = () => {};
    const fetch = vi.fn().mockImplementation((url: string) => url.endsWith('/sharing/')
      ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(json(analysis)));
    vi.stubGlobal('fetch', fetch); mount();
    const toggle = await screen.findByRole('switch', { name: 'Compartir por enlace' });
    await user.dblClick(toggle);
    expect(toggle).toBeDisabled();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/sharing/'))).toHaveLength(1);
    await act(async () => finish(json({ detail: 'No se pudo guardar el cambio.' }, 503)));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el cambio.');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).not.toBeDisabled();
  });

  it('opens anonymously with read-only controls and stays within the shared routes', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn().mockResolvedValue(json(analysis)); vi.stubGlobal('fetch', fetch);
    const { router } = mount(true);
    expect(await screen.findByRole('heading', { level: 1, name: analysis.name })).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar este análisis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Crear una copia' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Informe' })).toHaveAttribute('href', `${path}/informe`);
    await user.click(screen.getByRole('link', { name: 'Mapa' }));
    await screen.findByLabelText('Mapa de prueba');
    expect(router.state.location.pathname).toBe(path);
    expect(router.state.location.search).toBe('?vista=mapa');
    expect(document.querySelector('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow, noarchive');
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(`/api/shared/${shareToken}/`);
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
    }
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('hides loaded results when a shared link is revoked', async () => {
    let revoked = false;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(revoked ? json({ detail: 'No encontrado.' }, 404) : json(analysis))));
    const { client } = mount(true);
    await screen.findByRole('heading', { name: analysis.name });
    revoked = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['shared-analysis', shareToken] }); });
    expect(await screen.findByRole('heading', { name: 'Análisis no disponible' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: analysis.name })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Vistas del resultado' })).not.toBeInTheDocument();
  });
});
