import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import PublicHeader from './PublicHeader';
import s from '../styles/App.module.css';

export default function SharedLayout() {
  const location = useLocation();
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);
  useEffect(() => {
    document.title = 'Análisis compartido · Queñaris';
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('#page-title')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);
  return <><a href="#main-content" className={s.skip}>Saltar al contenido</a><PublicHeader /><main className={s.sharedMain} id="main-content" tabIndex={-1}><Outlet /></main></>;
}
