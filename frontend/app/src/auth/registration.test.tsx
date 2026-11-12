import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './Auth';
import Login from './Login';
import { TOKEN_KEY } from '../lib/api';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
function renderLogin(fetch: typeof globalThis.fetch) {
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/login', element: <Login /> },
    { path: '/analisis', element: <h1>Mis análisis</h1> },
  ], { initialEntries: ['/login'] });
  render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>);
}

describe('self-service email access', () => {
  it('requests a code, reports a failure, and signs in after a valid retry', async () => {
    const user = userEvent.setup(); let verifyAttempts = 0;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith('/auth/config/')) return json({ google_client_id: '', public_signup: true, email_code_enabled: true });
      if (path.endsWith('/auth/email/request/')) return json({ detail: 'Si el correo puede usar este acceso, recibirá instrucciones.' });
      if (path.endsWith('/auth/email/verify/')) return ++verifyAttempts === 1 ? json({ detail: 'Código inválido.' }, 400) : json({ token: 'test-only-token' });
      return json({}, 404);
    });
    renderLogin(fetch);
    await user.click(await screen.findByRole('button', { name: 'Recibir un código por correo' }));
    await user.type(screen.getByLabelText('Correo electrónico'), 'tecnico@unsa.edu.pe');
    await user.click(screen.getByRole('button', { name: 'Enviar código' }));
    const input = await screen.findByLabelText('Código de 8 dígitos');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await user.type(input, '12345678'); await user.click(screen.getByRole('button', { name: 'Verificar y entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido.');
    await user.click(screen.getByRole('button', { name: 'Verificar y entrar' }));
    expect(await screen.findByRole('heading', { name: 'Mis análisis' })).toBeInTheDocument();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('test-only-token');
    expect(verifyAttempts).toBe(2);
  });

  it('keeps local login usable when email access is disabled', async () => {
    renderLogin(vi.fn(async () => json({ google_client_id: '', public_signup: false, email_code_enabled: false })));
    await waitFor(() => expect(screen.getByLabelText('Correo o usuario')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Recibir un código por correo' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'current-password');
  });
});
