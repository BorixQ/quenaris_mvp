import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Save } from 'lucide-react';
import { useQuota } from '../lib/queries';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/Auth';
import { number } from '../lib/format';
import { Button, Field, Notice } from '../components/UI';
import type { Quota } from '../types';
import s from '../styles/App.module.css';

export default function Profile() {
  const quota = useQuota().data!, cache = useQueryClient(), auth = useAuth(), navigate = useNavigate();
  const [first, setFirst] = useState(quota.first_name), [last, setLast] = useState(quota.last_name), [busy, setBusy] = useState(false), [error, setError] = useState(''), [fields, setFields] = useState<Record<string, string>>({}), [saved, setSaved] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(''); setSaved(false); setFields({});
    try { const result = await api<Quota>('/auth/quota/', { method: 'POST', body: JSON.stringify({ first_name: first, last_name: last }) }); cache.setQueryData(['quota'], result); setFirst(result.first_name); setLast(result.last_name); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar los cambios.'); if (e instanceof ApiError) setFields(e.fields); } finally { setBusy(false); }
  }
  async function logout() { if (busy) return; setBusy(true); const revoked = await auth.logout(); navigate('/login', { replace: true, state: revoked ? undefined : { notice: 'Se eliminó la sesión de este navegador, pero no se pudo confirmar la revocación en el servidor. El token caduca en un máximo de 24 horas.' } }); }
  return <><div className={s.heading}><div><p className={s.eyebrow}>TU ESPACIO PERSONAL</p><h1 id="page-title" tabIndex={-1}>Mi cuenta</h1><p className={s.subtitle}>Consulta tus límites y mantén actualizados tus datos.</p></div></div><div className={s.profileGrid}><section className={`${s.card} ${s.pad}`}><h2>Información personal</h2><p className={s.small}>{quota.email || 'Cuenta local sin correo registrado'}<br />{quota.is_superuser ? 'Administrador · gestión disponible por el acceso privado' : 'Cuenta de usuario'}</p>{error && <Notice tone="error">{error}</Notice>}{saved && <Notice tone="success">Tus cambios se guardaron correctamente.</Notice>}<form onSubmit={save} style={{ marginTop: 24 }}><Field id="first-name" label="Nombres" error={fields.first_name}><input autoComplete="given-name" maxLength={150} value={first} onChange={e => { setFirst(e.target.value); setSaved(false); }} /></Field><Field id="last-name" label="Apellidos" error={fields.last_name}><input autoComplete="family-name" maxLength={150} value={last} onChange={e => { setLast(e.target.value); setSaved(false); }} /></Field><Button type="submit" disabled={busy || (first === quota.first_name && last === quota.last_name)}><Save />{busy ? 'Guardando…' : 'Guardar cambios'}</Button></form><div style={{ marginTop: 30, borderTop: '1px solid var(--border)', paddingTop: 18 }}><Button variant="secondary" onClick={logout} disabled={busy}><LogOut />Cerrar sesión</Button></div></section>
    <section className={`${s.card} ${s.quotaSummary}`}><p className={s.eyebrow}>LÍMITES DE USO</p><h2>Cuota de análisis</h2><div className={s.statValue}>{Math.max(0, quota.analyses_allowed - quota.analyses_used)} <small>disponibles</small></div><div className={s.quotaTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, quota.analyses_used / Math.max(1, quota.analyses_allowed) * 100)}%` }} /></div><dl><div className={s.keyValue}><dt>Usados o reservados</dt><dd>{quota.analyses_used} de {quota.analyses_allowed}</dd></div><div className={s.keyValue}><dt>Máximo por terreno</dt><dd>{number(quota.max_area_ha, 2)} ha</dd></div><div className={s.keyValue}><dt>Máximo por periodo</dt><dd>{quota.max_date_range_days} días</dd></div></dl><p className={s.small}>Un trabajo activo reserva un análisis. Para cambiar los límites, contacta con el administrador. No hay pagos ni ampliación automática desde esta pantalla.</p></section></div></>;
}
