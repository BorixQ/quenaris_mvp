import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Layers3, Plus, ArrowUpRight, Inbox, Star } from 'lucide-react';
import { useAuth } from '../auth/Auth';
import { useQuota } from '../lib/queries';
import { date, limaToday } from '../lib/format';
import { ErrorState, Loading } from './UI';
import s from '../styles/App.module.css';

export function Brand({ home = false }: { home?: boolean }) { return <Link to={home ? '/' : '/analisis'} className={s.brand} aria-label={home ? 'Queñaris, inicio' : 'Queñaris, mis análisis'}><img src="/quenaris.svg" alt="" />Queñaris</Link>; }
export default function Layout() {
  const auth = useAuth(), location = useLocation();
  const quota = useQuota(!!auth.token);
  useEffect(() => {
    const names = location.pathname.includes('/compartidos-conmigo') ? 'Compartidos conmigo' : location.pathname.includes('/nuevo') ? 'Nuevo análisis' : location.pathname.includes('/perfil') ? 'Mi cuenta' : location.pathname.includes('/informe') ? 'Informe' : location.pathname.includes('/3d') ? 'Vista 3D' : 'Mis análisis';
    document.title = `${names} · Queñaris`;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('#page-title')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);
  if (!auth.token) return <Navigate to="/login" replace state={{ from: auth.signedOut ? '/analisis' : location.pathname + location.search }} />;
  if (quota.isPending) return <Loading text="Comprobando tu sesión…" />;
  if (quota.isError) return <main className={s.pad}><ErrorState error={quota.error} retry={() => quota.refetch()} /></main>;
  const user = quota.data;
  const name = user.first_name || user.email.split('@')[0] || 'Mi cuenta';
  return <div className={s.shell}><a href="#main-content" className={s.skip}>Saltar al contenido</a>
    <aside className={s.sidebar} data-no-print><Brand /><p className={s.brandSub}>OBSERVACIÓN DEL TERRITORIO</p>
      <nav className={s.nav} aria-label="Navegación principal"><NavLink to="/analisis" end><Layers3 />Mis análisis</NavLink><NavLink to="/compartidos-conmigo"><Inbox />Compartidos conmigo</NavLink><NavLink to="/analisis/nuevo"><Plus />Nuevo análisis</NavLink><NavLink to="/destacados"><Star />Proyectos destacados</NavLink></nav>
      <div className={s.sidebarBottom}><div className={s.sidebarNote}><strong>La observación es el inicio.</strong>Interpreta los datos satelitales junto con el conocimiento del terreno.</div>
        <Link to="/perfil" className={s.account} aria-label="Mi cuenta"><span className={s.avatar} aria-hidden="true">{name[0]?.toUpperCase()}</span><span className={s.accountText}><strong>{name}</strong><span>Ver mi cuenta</span></span></Link>
      </div>
    </aside>
    <header className={s.topbar}><div className={s.topbarStatus}>Análisis geoespacial exploratorio</div><div className={s.topbarRight}><span>{date(limaToday())}</span><Link to="/perfil">Mi cuenta <ArrowUpRight size={12} aria-hidden="true" /></Link></div></header>
    <main className={s.main} id="main-content" tabIndex={-1}><Outlet /></main>
  </div>;
}
