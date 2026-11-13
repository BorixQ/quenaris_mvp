import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import { useReceived } from '../lib/queries';
import { sharedTokenFromLink } from '../lib/sharing';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { Button, ErrorState, Loading, Notice, ScienceNote } from '../components/UI';
import ProjectCard from '../components/ProjectCard';
import s from '../styles/App.module.css';

export default function Received() {
  const [page, setPage] = useState(1), query = useReceived(page), cache = useQueryClient();
  const [link, setLink] = useState(''), [busy, setBusy] = useState(false), [removing, setRemoving] = useState<number | null>(null), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      const token = sharedTokenFromLink(link);
      await api(`/shared/${token}/account/`, { method: 'POST' });
      setPage(1); await cache.invalidateQueries({ queryKey: ['received'] });
      await cache.invalidateQueries({ queryKey: ['shared-account', token] });
      setLink(''); setMessage('El análisis se guardó en Compartidos conmigo.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el enlace.'); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    setRemoving(id); setError(''); setMessage('');
    try {
      await api(`/received/${id}/`, { method: 'DELETE' });
      if (query.data?.results.length === 1 && page > 1) setPage(page - 1);
      await cache.invalidateQueries({ queryKey: ['received'] });
      await cache.invalidateQueries({ queryKey: ['shared-account'] });
      setMessage('Enlace quitado de tu colección.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo quitar el enlace.'); }
    finally { setRemoving(null); }
  }
  return <><div className={s.heading}><div><p className={s.eyebrow}>TU COLECCIÓN</p><h1 id="page-title" tabIndex={-1}>Compartidos conmigo</h1><p className={s.subtitle}>Análisis de otras personas que guardaste desde un enlace. El acceso depende de que su propietario siga compartiéndolos.</p></div></div>
    <form className={`${s.card} ${s.pad} ${s.receivedForm}`} onSubmit={save}><div className={s.field}><label htmlFor="received-link">Pegar un enlace compartido</label><input id="received-link" type="text" inputMode="url" placeholder={`${window.location.origin}/compartido/…`} value={link} onChange={event => setLink(event.target.value)} required disabled={busy} /></div><Button type="submit" disabled={busy}><BookmarkPlus aria-hidden="true" />{busy ? 'Guardando…' : 'Guardar análisis'}</Button></form>
    {error && <Notice tone="error">{error}</Notice>}<p role="status" className={s.small}>{message}</p>
    {query.isPending ? <Loading /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : <>
      {query.data.results.length === 0 ? <section className={`${s.card} ${s.empty}`}><BookmarkPlus aria-hidden="true" /><h2>Aún no has guardado análisis recibidos</h2><p>Cuando alguien te envíe un enlace, ábrelo y elige «Guardar en Compartidos conmigo» o pégalo aquí.</p></section>
        : <div className={s.projectGrid}>{query.data.results.map(project => <ProjectCard key={project.id} project={project}><div className={s.projectFooter}><span className={s.small}>Guardado el {date(project.saved_at)}{!project.available && ' · Acceso retirado'}</span><Button variant="secondary" aria-label={`Quitar ${project.name || 'análisis'} de mi colección`} disabled={removing !== null} onClick={() => remove(project.id)}><Trash2 aria-hidden="true" />Quitar</Button></div></ProjectCard>)}</div>}
      {(query.data.previous || query.data.next) && <nav className={s.pagination} aria-label="Páginas de análisis recibidos"><Button variant="secondary" disabled={!query.data.previous} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page}</span><Button variant="secondary" disabled={!query.data.next} onClick={() => setPage(page + 1)}>Siguiente</Button></nav>}
    </>}<ScienceNote />
  </>;
}
