import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { api } from '../lib/api';
import { useQuota } from '../lib/queries';
import { Button, Notice } from '../components/UI';
import type { Analysis, FeaturedState } from '../types';
import s from '../styles/App.module.css';

export function FeaturedControl({ state, endpoint, disabled = false, saved }: { state: FeaturedState; endpoint: string; disabled?: boolean; saved: (value: FeaturedState) => void }) {
  const [description, setDescription] = useState(state.featured_description), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const cache = useQueryClient();
  async function imageUpdate(file?: File) {
    setError(''); setMessage('');
    if (file && file.size > 2 * 1024 * 1024) { setError('La imagen debe pesar como máximo 2 MB.'); return; }
    setBusy(true);
    try {
      const body = file ? new FormData() : undefined;
      if (body && file) body.append('image', file);
      const value = await api<FeaturedState>(endpoint.replace('/featured/', '/featured-image/'), { method: file ? 'POST' : 'DELETE', body });
      saved(value); await cache.invalidateQueries({ queryKey: ['featured'] });
      setMessage(file ? 'Imagen actualizada en la portada.' : 'Imagen retirada. Se mostrará la ilustración del terreno.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar la imagen.'); }
    finally { setBusy(false); }
  }
  function imageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (file) void imageUpdate(file);
  }
  async function update(enabled: boolean) {
    setBusy(true); setError(''); setMessage('');
    try {
      const value = await api<FeaturedState>(endpoint, { method: 'POST', body: JSON.stringify({ enabled, description }) });
      saved(value); setDescription(value.featured_description);
      await cache.invalidateQueries({ queryKey: ['featured'] });
      setMessage(value.is_featured ? 'El proyecto ya aparece en la portada y en destacados.' : 'El proyecto dejó de aparecer en destacados.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar el proyecto destacado.'); }
    finally { setBusy(false); }
  }
  return <section className={`${s.card} ${s.pad} ${s.featureControl}`} aria-labelledby="feature-title" data-no-print>
    <p className={s.eyebrow}>ADMINISTRACIÓN</p><h2 id="feature-title"><Star size={18} aria-hidden="true" />{state.is_featured ? 'Proyecto destacado' : 'Destacar este proyecto'}</h2>
    <p className={s.small}>Los destacados aparecen en la portada pública, sin iniciar sesión. Si el propietario desactiva el enlace, el proyecto se retira automáticamente.</p>
    {disabled && <Notice>Activa «Compartir por enlace» para poder destacar este análisis.</Notice>}
    <div className={s.field}><label htmlFor="featured-description">Descripción para la portada (opcional)</label><textarea id="featured-description" maxLength={320} rows={2} value={description} onChange={event => setDescription(event.target.value)} disabled={busy || disabled} /><p className={s.hint}>{description.length} / 320 caracteres</p></div>
    <div className={s.buttonRow}><Button variant={state.is_featured ? 'secondary' : undefined} disabled={busy || disabled} onClick={() => update(!state.is_featured)}><Star aria-hidden="true" />{busy ? 'Guardando…' : state.is_featured ? 'Quitar de destacados' : 'Destacar proyecto'}</Button>
      {state.is_featured && description !== state.featured_description && <Button disabled={busy} onClick={() => update(true)}>Guardar descripción</Button>}</div>
    {state.is_featured && <div className={s.thumbnailEditor}><label htmlFor="featured-image">Imagen de la tarjeta (opcional)</label><p className={s.hint}>JPEG, PNG o WebP, hasta 2 MB y 16 megapíxeles. Se mostrará en la portada pública; funciona mejor una imagen horizontal.</p>
      {state.thumbnail_url && <img src={state.thumbnail_url} alt="Vista previa de la imagen del proyecto destacado" />}
      <input id="featured-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={imageSelected} disabled={busy || disabled} />
      {state.thumbnail_url && <Button variant="secondary" disabled={busy || disabled} onClick={() => imageUpdate()}>Quitar imagen</Button>}</div>}
    <p role="status" className={s.small}>{message}</p>{error && <Notice tone="error">{error}</Notice>}
  </section>;
}

export default function OwnerFeaturedControl({ analysis }: { analysis: Analysis }) {
  const quota = useQuota(), cache = useQueryClient();
  if (!quota.data?.is_staff && !quota.data?.is_superuser) return null;
  return <FeaturedControl state={{ is_featured: !!analysis.is_featured, featured_description: analysis.featured_description || '', thumbnail_url: analysis.thumbnail_url }} endpoint={`/analyses/${analysis.id}/featured/`} disabled={!analysis.sharing_enabled} saved={value => {
    cache.setQueryData<Analysis>(['analysis', analysis.id], current => current ? { ...current, ...value } : current);
  }} />;
}
