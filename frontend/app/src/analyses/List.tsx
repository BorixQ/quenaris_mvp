import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCheck, Clock3, Layers3, Plus, Search, ScanLine } from 'lucide-react';
import type { Polygon } from 'geojson';
import { useAnalyses, useQuota } from '../lib/queries';
import { active, studies } from '../data/studies';
import { date, number, title } from '../lib/format';
import { quotaRemaining, usesAreaQuota } from '../lib/quota';
import { ErrorState, Loading, Notice, ScienceNote, StatusBadge, StudyLabel } from '../components/UI';
import s from '../styles/App.module.css';

function Thumbnail({ polygon }: { polygon: Polygon }) {
  const points = polygon?.coordinates?.[0] || [];
  if (!points.length) return <Layers3 className={s.thumb} aria-hidden="true" />;
  const xs = points.map(c => c[0]), ys = points.map(c => c[1]), west = Math.min(...xs), south = Math.min(...ys), dx = Math.max(...xs) - west || 1, dy = Math.max(...ys) - south || 1;
  return <svg className={s.thumb} viewBox="0 0 44 44" aria-hidden="true"><path d="M0 14h44M0 29h44M14 0v44M29 0v44" stroke="#dce9df" strokeWidth=".7" /><polygon points={points.map(([x, y]) => `${7 + (x - west) / dx * 30},${37 - (y - south) / dy * 30}`).join(' ')} fill="#c4dccc" stroke="#44805a" strokeWidth="1.1" /></svg>;
}
export default function AnalysisList() {
  const query = useAnalyses(), quota = useQuota().data, cache = useQueryClient();
  const [search, setSearch] = useState(''), [study, setStudy] = useState(''), [status, setStatus] = useState('');
  const signature = query.data?.map(a => `${a.id}:${a.status}`).join('|');
  useEffect(() => { if (signature) cache.invalidateQueries({ queryKey: ['quota'] }); }, [signature, cache]);
  const list = query.data || [], running = list.filter(a => active(a.status)), complete = list.filter(a => a.status === 'COMPLETED');
  const filtered = list.filter(a => (!study || a.study_type === study) && (!status || a.status === status) && title(a).toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return <><div className={s.heading}><div><p className={s.eyebrow}>TU ESPACIO DE TRABAJO</p><h1 id="page-title" tabIndex={-1}>Mis análisis</h1><p className={s.subtitle}>Observa el territorio, consulta tus resultados y sigue el trabajo en curso.</p></div><Link className={s.button} to="/analisis/nuevo"><Plus size={17} />Nuevo análisis</Link></div>
    {running.length > 0 && <Notice tone="info"><strong>Tienes un análisis {running[0].status === 'PENDING' ? 'en cola' : 'en ejecución'}.</strong> El cálculo continúa en el servidor. <Link to={`/analisis/${running[0].id}`}>Consultar su estado</Link></Notice>}
    <div className={s.stats}>{[
      { label: 'Análisis guardados', value: list.length, note: 'Todos los estados', icon: Layers3 },
      { label: 'Completados', value: complete.length, note: 'Resultados disponibles', icon: CheckCheck },
      { label: 'En curso', value: running.length, note: 'Pendientes y procesando', icon: Clock3 },
      { label: 'Cuota disponible', value: quota ? quotaRemaining(quota) : null, note: quota ? (usesAreaQuota(quota) ? `De ${number(quota.area_allowance_ha, 4)} ha asignadas` : `De ${quota.analyses_allowed} análisis asignados`) : 'Consultando tu cuenta', icon: ScanLine, unit: quota && usesAreaQuota(quota) ? ' ha' : '', digits: quota && usesAreaQuota(quota) ? 4 : 0 },
    ].map(v => <section className={`${s.card} ${s.stat}`} key={v.label}><div className={s.statLabel}>{v.label}<v.icon aria-hidden="true" /></div><div className={s.statValue}>{query.isPending ? '—' : number(v.value, v.digits || 0)}{v.unit || ''}</div><div className={s.statNote}>{v.note}</div></section>)}</div>
    <section className={s.card} aria-label="Historial de análisis"><div className={s.cardHead}><h2>Tu territorio, en perspectiva</h2><span>{list.length} registros</span></div>
      <div className={s.toolbar}><div className={s.search}><Search aria-hidden="true" /><input aria-label="Buscar análisis por nombre" placeholder="Buscar por nombre del análisis…" value={search} onChange={e => setSearch(e.target.value)} /></div><select aria-label="Filtrar por estudio" value={study} onChange={e => setStudy(e.target.value)}><option value="">Todos los estudios</option>{studies.map(st => <option key={st.value} value={st.value}>{st.short}</option>)}</select><select aria-label="Filtrar por estado" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos los estados</option><option value="PENDING">En cola</option><option value="PROCESSING">Procesando</option><option value="COMPLETED">Completados</option><option value="FAILED">No completados</option></select></div>
      {query.isPending ? <Loading /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : !filtered.length ? <div className={s.empty}><Layers3 aria-hidden="true" /><h2>{list.length ? 'No hay coincidencias' : 'Tu primera mirada al territorio'}</h2><p>{list.length ? 'Prueba con otro nombre, estudio o estado.' : 'Define un área de interés para explorar sus diferencias con imágenes satelitales.'}</p>{!list.length && <Link className={s.button} to="/analisis/nuevo">Crear mi primer análisis<ArrowRight size={16} /></Link>}</div> : <div className={s.tableScroll} tabIndex={0} role="region" aria-label="Historial de análisis"><table className={s.analysisTable}><thead><tr><th scope="col">Análisis</th><th scope="col">Estudio</th><th scope="col">Superficie</th><th scope="col">Estado</th><th scope="col">Creado</th></tr></thead><tbody>{filtered.map(a => <tr key={a.id}><td><div className={s.analysisName}><Thumbnail polygon={a.aoi} /><div><Link to={`/analisis/${a.id}`}>{title(a)}</Link><div className={s.analysisMeta}>{date(a.date_start)} — {date(a.date_end)}</div></div></div></td><td><StudyLabel value={a.study_type} /></td><td>{number(a.area_ha, 2)} ha</td><td><StatusBadge status={a.status} /></td><td className={s.muted}>{date(a.created_at)}</td></tr>)}</tbody></table></div>}
      <div className={s.tableFooter}><span>{filtered.length} de {list.length} análisis</span><span>Datos privados de tu cuenta · Fechas de fin excluidas</span></div>
    </section><ScienceNote />
  </>;
}
