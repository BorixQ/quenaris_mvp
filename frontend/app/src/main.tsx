import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Navigate, RouterProvider, useLocation, useRouteError } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/Auth';
import { ApiError } from './lib/api';
import Layout from './components/Layout';
import SharedLayout from './components/SharedLayout';
import { Loading, ErrorState } from './components/UI';
import './styles/global.css';
import s from './styles/App.module.css';

const Login = lazy(() => import('./auth/Login'));
const List = lazy(() => import('./analyses/List'));
const Wizard = lazy(() => import('./analyses/Wizard'));
const Detail = lazy(() => import('./analyses/Detail'));
const Profile = lazy(() => import('./profile/Profile'));
const Home = lazy(() => import('./discover/Home'));
const Received = lazy(() => import('./analyses/Received'));
// A tab opened before an update can refer to assets removed by the new build.
// Reload at most once per minute; persistent failures remain visible and retryable.
window.addEventListener('vite:preloadError', event => {
  const key = 'quenaris:last-asset-reload';
  const last = Number(sessionStorage.getItem(key) || 0);
  if (navigator.onLine && Date.now() - last > 60_000) {
    event.preventDefault();
    sessionStorage.setItem(key, String(Date.now()));
    window.location.reload();
  }
});
function Legacy() {
  const { pathname, search } = useLocation(), id = new URLSearchParams(search).get('id');
  const validId = id && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);
  const target = pathname.includes('login') ? '/login' : pathname.includes('perfil') ? '/perfil' : validId && pathname.includes('informes') ? `/analisis/${id}/informe` : validId && pathname.includes('viewer3d') ? `/analisis/${id}/3d` : validId ? `/analisis/${id}` : pathname.includes('geoanalisis') ? '/analisis/nuevo' : '/analisis';
  return <Navigate to={target} replace />;
}
function RouteError() { const error = useRouteError(); return <main className={s.pad}><ErrorState error={error instanceof Error ? error : new Error('No se encontró esta pantalla.')} retry={() => window.location.reload()} /><Link to="/analisis">Volver a mis análisis</Link></main>; }
const page = (element: React.ReactNode) => <Suspense fallback={<Loading text="Preparando la pantalla…" />}>{element}</Suspense>;
const router = createBrowserRouter([
  { path: '/', element: page(<Home />), errorElement: <RouteError /> },
  { path: '/destacados', element: page(<Home gallery />), errorElement: <RouteError /> },
  { path: '/login', element: page(<Login />), errorElement: <RouteError /> },
  { element: <SharedLayout />, errorElement: <RouteError />, children: [
    { path: '/compartido/:id', element: page(<Detail shared />) },
    { path: '/compartido/:id/informe', element: page(<Detail shared />) },
    { path: '/compartido/:id/3d', element: page(<Detail shared />) },
  ] },
  { element: <Layout />, errorElement: <RouteError />, children: [
    { path: '/analisis', element: page(<List />) }, { path: '/analisis/nuevo', element: page(<Wizard />) },
    { path: '/compartidos-conmigo', element: page(<Received />) },
    { path: '/analisis/:id', element: page(<Detail />) }, { path: '/analisis/:id/informe', element: page(<Detail />) }, { path: '/analisis/:id/3d', element: page(<Detail />) }, { path: '/perfil', element: page(<Profile />) },
  ] },
  ...['/index.html', '/login.html', '/inicio.html', '/geoanalisis.html', '/informes.html', '/viewer3d.html', '/perfil.html'].map(path => ({ path, element: <Legacy /> })),
  { path: '*', element: <RouteError /> },
]);
const cache = new QueryClient({ defaultOptions: { queries: { staleTime: 10000, refetchOnWindowFocus: true, retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500), retryDelay: 1000 }, mutations: { retry: false } } });
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={cache}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider></StrictMode>);
