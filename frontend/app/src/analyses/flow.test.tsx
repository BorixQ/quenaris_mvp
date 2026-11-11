import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AnalysisList from './List';
import Wizard from './Wizard';
import { ClusterTable } from './ResultData';
import MapPanel from '../maps/MapPanel';
import { AuthProvider, useAuth } from '../auth/Auth';
import { EXPIRED_EVENT, TOKEN_KEY } from '../lib/api';
import { dayCount } from '../lib/format';
import { analysis, csv, quota } from '../test/fixtures';

vi.mock('../maps/GeoMap', () => ({ default: () => <div aria-label="Mapa simulado para prueba de formulario" /> }));
function renderPage(element: React.ReactNode, path = '/analisis', seed: unknown[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(['quota'], quota); client.setQueryData(['analyses'], seed);
  const router = createMemoryRouter([{ path, element }, { path: '/analisis/:id', element: <h1>Estado del trabajo</h1> }], { initialEntries: [path] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router };
}
describe('analysis workflows', () => {
  it('shows all states and filters by name', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(quota), { headers: { 'content-type': 'application/json' } })));
    renderPage(<AnalysisList />, '/analisis', [{ ...analysis, name: 'Sector uno' }, { ...analysis, id: '2', name: 'Trabajo en espera', status: 'PENDING', result: null }, { ...analysis, id: '3', name: 'Trabajo fallido', status: 'FAILED', result: null }]);
    expect(await screen.findByRole('link', { name: 'Trabajo en espera' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trabajo fallido' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Buscar análisis por nombre' }), 'Sector');
    expect(screen.queryByRole('link', { name: 'Trabajo fallido' })).not.toBeInTheDocument();
  });
  it('creates a CSV-based analysis once, with defaults inside the date quota', async () => {
    const user = userEvent.setup(); let resolve: (value: Response) => void = () => {};
    const fetch = vi.fn().mockImplementation((url, init) => init.method === 'POST' ? new Promise<Response>(r => { resolve = r; }) : Promise.resolve(new Response(JSON.stringify(url.includes('quota') ? quota : [{ ...analysis, status: 'PENDING', result: null }]), { headers: { 'content-type': 'application/json' } }))); vi.stubGlobal('fetch', fetch);
    const { router } = renderPage(<Wizard />, '/analisis/nuevo');
    await user.type(screen.getByLabelText('Nombre del análisis'), 'Parcela de prueba'); await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Importar CSV' })); await user.click(screen.getByText('Pegar coordenadas en vez de cargar un archivo'));
    await user.type(screen.getByLabelText('Coordenadas CSV'), csv); await user.click(screen.getByRole('button', { name: 'Cargar coordenadas' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    const start = screen.getByLabelText('Desde (incluido)') as HTMLInputElement, end = screen.getByLabelText('Hasta (excluido)') as HTMLInputElement;
    expect(dayCount(start.value, end.value)).toBeLessThanOrEqual(31);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.dblClick(screen.getByRole('button', { name: 'Procesar área' }));
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    await act(async () => resolve(new Response(JSON.stringify({ ...analysis, status: 'PENDING', result: null }), { status: 202, headers: { 'content-type': 'application/json' } })));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/analisis/${analysis.id}`));
  });
  it('keeps absent values distinct from zero in a result table', () => {
    renderPage(<ClusterTable analysis={analysis} full />);
    expect(screen.getAllByText('0 /100')).toHaveLength(1); expect(screen.getByText('—')).toBeInTheDocument();
  });
  it('falls back to a numeric range for historical legends', async () => {
    const user = userEvent.setup(); renderPage(<MapPanel analysis={analysis} />);
    await user.selectOptions(screen.getByLabelText('Capa'), 'ndmi');
    expect(screen.getByText('Leyenda de colores no registrada en este análisis histórico.')).toBeInTheDocument(); expect(screen.getByText('-0.3')).toBeInTheDocument();
  });
  it('clears private cached data on session expiry', () => {
    sessionStorage.setItem(TOKEN_KEY, 'test-only-token');
    const client = new QueryClient(); client.setQueryData(['private-data'], analysis);
    function Session() { return <p>{useAuth().token ? 'Con sesión' : 'Sin sesión'}</p>; }
    render(<QueryClientProvider client={client}><AuthProvider><Session /></AuthProvider></QueryClientProvider>);
    sessionStorage.removeItem(TOKEN_KEY); act(() => window.dispatchEvent(new Event(EXPIRED_EVENT)));
    expect(screen.getByText('Sin sesión')).toBeInTheDocument(); expect(client.getQueryData(['private-data'])).toBeUndefined();
  });
});
