import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Link2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Notice } from '../components/UI';
import type { Analysis, Sharing } from '../types';
import s from '../styles/App.module.css';

export default function SharingControl({ analysis }: { analysis: Analysis }) {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [copied, setCopied] = useState(false);
  const enabled = !!analysis.sharing_enabled;
  const url = enabled && analysis.share_path ? new URL(analysis.share_path, window.location.origin).href : '';
  async function toggle() {
    setBusy(true); setError(''); setMessage(''); setCopied(false);
    try {
      const state = await api<Sharing>(`/analyses/${analysis.id}/sharing/`, { method: 'POST', body: JSON.stringify({ enabled: !enabled }) });
      cache.setQueryData<Analysis>(['analysis', analysis.id], current => current ? { ...current, ...state, ...(!state.sharing_enabled ? { is_featured: false, featured_description: '', thumbnail_url: null } : {}) } : current);
      await cache.invalidateQueries({ queryKey: ['analyses'] });
      await cache.invalidateQueries({ queryKey: ['featured'] });
      await cache.invalidateQueries({ queryKey: ['received'] });
      setMessage(state.sharing_enabled ? 'Enlace activado. Ya puedes compartirlo.' : 'Enlace desactivado. El enlace anterior dejó de funcionar.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar el acceso.'); }
    finally { setBusy(false); }
  }
  async function copy() {
    setError('');
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setError('No se pudo copiar automáticamente. Selecciona y copia el enlace del campo.'); }
  }
  return <section className={`${s.card} ${s.pad} ${s.sharing}`} aria-labelledby="sharing-title" data-no-print>
    <div className={s.sharingHeading}><div><h2 id="sharing-title"><Link2 size={18} aria-hidden="true" />Compartir análisis</h2><p id="sharing-help" className={s.small}>Cualquiera con el enlace podrá ver la ubicación del terreno, los mapas y el informe sin iniciar sesión. La administración podrá seleccionarlo como proyecto destacado en la portada pública.</p>{analysis.is_featured && <p className={s.savedLabel}>Este proyecto está destacado en la portada. Al desactivar el enlace también se retira de allí.</p>}</div>
      <div className={s.sharingToggle}><button type="button" role="switch" aria-label="Compartir por enlace" aria-checked={enabled} aria-describedby="sharing-help" className={s.switch} disabled={busy} onClick={toggle}><span /></button><span aria-hidden="true">{busy ? 'Guardando…' : enabled ? 'Activado' : 'Desactivado'}</span></div>
    </div>
    {url && <div className={s.shareLink}><div><label htmlFor="share-url">Enlace para compartir</label><input id="share-url" readOnly value={url} onFocus={event => event.target.select()} /></div><Button variant="secondary" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copiado' : 'Copiar enlace'}</Button><a className={`${s.button} ${s.secondary}`} href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Abrir enlace</a></div>}
    <p className={s.hint}>{enabled ? 'Apaga el interruptor para retirar el acceso. Si vuelves a activarlo, se generará un enlace nuevo.' : 'El análisis es privado. Activa el interruptor para generar un enlace.'}</p>
    <div role="status" className={s.small}>{message || (copied ? 'Enlace copiado.' : '')}</div>
    {error && <Notice tone="error">{error}</Notice>}
  </section>;
}
