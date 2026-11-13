import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Check } from 'lucide-react';
import { useAuth } from '../auth/Auth';
import { api } from '../lib/api';
import { Button, Notice } from '../components/UI';
import { FeaturedControl } from './FeaturedControl';
import type { SharedAccount } from '../types';
import s from '../styles/App.module.css';

export default function SharedActions({ shareToken, analysisId }: { shareToken: string; analysisId: string }) {
  const auth = useAuth(), cache = useQueryClient(), location = useLocation();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const query = useQuery({ queryKey: ['shared-account', shareToken], queryFn: ({ signal }) => api<SharedAccount>(`/shared/${shareToken}/account/`, { signal }), enabled: !!auth.token, staleTime: 0, retry: false });
  async function save() {
    setBusy(true); setError('');
    try {
      await api(`/shared/${shareToken}/account/`, { method: 'POST' });
      cache.setQueryData<SharedAccount>(['shared-account', shareToken], current => current ? { ...current, is_saved: true } : current);
      await cache.invalidateQueries({ queryKey: ['received'] });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el enlace.'); }
    finally { setBusy(false); }
  }
  return <div className={s.sharedActions} data-no-print><div className={s.buttonRow}>
    {!auth.token ? <Link className={`${s.button} ${s.secondary}`} to="/login" state={{ from: location.pathname + location.search }}><Bookmark size={16} />Entrar para guardar en mi cuenta</Link>
      : query.data?.is_owner ? <Link className={`${s.button} ${s.secondary}`} to={`/analisis/${analysisId}`}>Abrir en Mis análisis</Link>
      : query.data?.is_saved ? <><span className={s.savedLabel} role="status"><Check size={16} />Guardado en Compartidos conmigo</span><Link className={s.textButton} to="/compartidos-conmigo">Ver mi colección</Link></>
      : <Button variant="secondary" disabled={busy || !query.data} onClick={save}><Bookmark aria-hidden="true" />{busy ? 'Guardando…' : 'Guardar en Compartidos conmigo'}</Button>}
  </div>
    {query.isError && auth.token && <p className={s.small}>No se pudieron consultar las opciones de tu cuenta. <button className={s.textButton} onClick={() => query.refetch()}>Reintentar</button></p>}
    {error && <Notice tone="error">{error}</Notice>}
    {query.data?.can_feature && <FeaturedControl state={query.data} endpoint={`/shared/${shareToken}/featured/`} saved={value => cache.setQueryData<SharedAccount>(['shared-account', shareToken], current => current ? { ...current, ...value } : current)} />}
  </div>;
}
