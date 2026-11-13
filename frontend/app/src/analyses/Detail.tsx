import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CopyPlus, Download, FileCheck2, Info, Layers3, ScanLine, Trash2 } from 'lucide-react';
import { useAnalysis } from '../lib/queries';
import { api } from '../lib/api';
import { date, downloadJson, number, percent, title } from '../lib/format';
import { active, studyInfo } from '../data/studies';
import { AreaEstimateNotice, Button, ConfirmDialog, ErrorState, Loading, Notice, ScienceNote, StatusBadge, StudyLabel } from '../components/UI';
import { ClusterTable, TechnicalData } from './ResultData';
import SharingControl from './SharingControl';
import OwnerFeaturedControl from './FeaturedControl';
import SharedActions from './SharedActions';
import s from '../styles/App.module.css';

const MapPanel = lazy(() => import('../maps/MapPanel'));
const Report = lazy(() => import('../reports/Report'));
export default function Detail({ shared = false }: { shared?: boolean }) {
  const { id = '' } = useParams(), query = useAnalysis(id, shared), location = useLocation(), navigate = useNavigate(), cache = useQueryClient(), [search] = useSearchParams();
  const basePath = shared ? `/compartido/${id}` : `/analisis/${id}`;
  const [confirmDelete, setConfirmDelete] = useState(false), [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState('');
  const status = query.data?.status;
  useEffect(() => { if (!shared && (status === 'COMPLETED' || status === 'FAILED')) { cache.invalidateQueries({ queryKey: ['analyses'] }); cache.invalidateQueries({ queryKey: ['quota'] }); } }, [status, cache, shared]);
  if (query.isPending) return <Loading text={shared ? 'Consultando el análisis compartido…' : 'Consultando tu análisis…'} />;
  if (query.isError) return shared ? <section className={`${s.card} ${s.empty}`}><h1 id="page-title" tabIndex={-1}>Análisis no disponible</h1><p>El enlace puede estar desactivado o el análisis ya no está disponible.</p><ErrorState error={query.error} retry={() => query.refetch()} /></section> : <ErrorState error={query.error} retry={() => query.refetch()} />;
  const analysis = query.data, result = analysis.result, stats = result?.statistics;
  const view = location.pathname.endsWith('/informe') ? 'informe' : location.pathname.endsWith('/3d') ? '3d' : ['mapa', 'datos'].includes(search.get('vista') || '') ? search.get('vista')! : 'resumen';
  async function remove() {
    setDeleting(true); setDeleteError('');
    try { await api(`/analyses/${analysis.id}/`, { method: 'DELETE' }); cache.removeQueries({ queryKey: ['analysis', analysis.id] }); await cache.invalidateQueries({ queryKey: ['analyses'] }); navigate('/analisis'); }
    catch (e) { setDeleteError(e instanceof Error ? e.message : 'No se pudo eliminar el análisis.'); setConfirmDelete(false); }
    finally { setDeleting(false); }
  }
  return <>{!shared && <Link className={s.textButton} to="/analisis" data-no-print><ArrowLeft size={15} />Mis análisis</Link>}<div className={s.heading} data-no-print><div><p className={s.eyebrow}>{shared ? 'ANÁLISIS COMPARTIDO · SOLO LECTURA' : 'OBSERVACIÓN DEL TERRITORIO'}</p><h1 id="page-title" tabIndex={-1} style={{ overflowWrap: 'anywhere' }}>{title(analysis)}</h1><div className={s.buttonRow}><StatusBadge status={analysis.status} /><span className={s.small}><StudyLabel value={analysis.study_type} /></span><span className={s.small}>Creado el {date(analysis.created_at)}</span></div></div>
    {!shared && !active(analysis.status) && <div className={s.buttonRow} data-no-print><Link className={`${s.button} ${s.secondary}`} to="/analisis/nuevo" state={{ clone: analysis }}><CopyPlus size={16} />Crear una copia</Link><Button variant="secondary" onClick={() => downloadJson(analysis, `quenaris-${analysis.id}.json`)}><Download />JSON</Button><Button variant="danger" aria-label="Eliminar este análisis" onClick={() => setConfirmDelete(true)}><Trash2 /></Button></div>}</div>
    {shared && <><Notice>Estás consultando un análisis compartido. Su propietario puede desactivar el enlace en cualquier momento.</Notice><SharedActions key={id} shareToken={id} analysisId={analysis.id} /></>}
    {!shared && analysis.status === 'COMPLETED' && result && <><SharingControl key={analysis.id} analysis={analysis} /><OwnerFeaturedControl key={`featured-${analysis.id}`} analysis={analysis} /></>}
    {deleteError && <Notice tone="error">{deleteError}</Notice>}
    {active(analysis.status) ? <section className={`${s.card} ${s.empty}`}><ScanLine aria-hidden="true" /><h2>{analysis.status === 'PENDING' ? 'Tu análisis está en cola' : 'Estamos procesando el área'}</h2><p>El cálculo continúa en el servidor. Puedes salir de esta pantalla y volver desde Mis análisis. Se comprueba el estado cada cuatro segundos mientras la pestaña está visible.</p><StatusBadge status={analysis.status} /><p className={s.small} style={{ marginTop: 20 }}>{date(analysis.date_start)} → {date(analysis.date_end)} · fin excluido<br />{number(analysis.area_ha, 2)} ha</p></section>
      : analysis.status === 'FAILED' ? <section className={`${s.card} ${s.pad}`}><h2>No se pudo completar este análisis</h2><Notice tone="error">{analysis.error_message || 'No hay un motivo registrado. Revisa los datos y la configuración.'}</Notice><p className={s.small} style={{ marginTop: 18 }}>Puedes preparar una copia y corregir el terreno o el periodo antes de enviar una nueva solicitud. Consulta tu cuota actual en Mi cuenta.</p><Link className={s.button} to="/analisis/nuevo" state={{ clone: analysis }}>Preparar análisis corregido</Link></section>
      : !result || !stats ? <Notice tone="warning">El análisis figura como completado, pero no tiene un resultado consultable.</Notice>
      : <>
        <nav className={s.tabs} aria-label="Vistas del resultado">{[
          ['resumen', 'Resumen', basePath], ['mapa', 'Mapa', `${basePath}?vista=mapa`], ['datos', 'Datos técnicos', `${basePath}?vista=datos`], ['informe', 'Informe', `${basePath}/informe`], ['3d', 'Vista 3D', `${basePath}/3d`],
        ].map(([key, label, to]) => <Link key={key} to={to} aria-current={view === key ? 'page' : undefined}>{label}</Link>)}</nav>
        {!stats.science_version && <Notice tone="warning">Resultado histórico sin versión científica registrada. Recalcula el análisis para usar las reglas actuales; no se muestran diagnósticos del informe histórico.</Notice>}
        {studyInfo(analysis.study_type)?.experimental && <Notice tone="warning">Estudio experimental: no está validado para determinar riego, plagas, nutrientes ni tratamientos.</Notice>}
        {view !== 'informe' && <AreaEstimateNotice statistics={stats} />}
        {view === 'resumen' && <><div className={s.resultHero}><div><h2>Un punto de partida para observar el terreno</h2><p>Estos datos describen diferencias relativas dentro del área y periodo. Combínalos con observaciones de campo antes de tomar decisiones.</p></div><FileCheck2 aria-hidden="true" /></div>
          <div className={s.stats}>{[
            ['Cobertura utilizable', percent(stats.quality?.valid_fraction), 'Fracción de la cuadrícula del área'], ['Puntuación relativa', `${number(stats.suitability_global_mean)} /100`, 'Referencia propia del área y periodo'], ['Escenas utilizadas', number(result.images_used, 0), 'Composite del periodo principal'], ['Grupos detectados', number(stats.n_clusters, 0), 'Agrupaciones espectrales'],
          ].map(([label, value, note]) => <section className={`${s.card} ${s.stat}`} key={label}><div className={s.statLabel}>{label}</div><div className={s.statValue}>{value}</div><div className={s.statNote}>{note}</div></section>)}</div>
          <div className={`${s.card} ${s.pad}`} style={{ marginBottom: 22 }}><div className={s.twoColumns}><div><h3>Área y periodo</h3><p className={s.small}>{number(analysis.area_ha, 2)} ha de área solicitada · {number(stats.total_area_ha, 2)} ha con datos utilizables<br />{date(analysis.date_start)} → {date(analysis.date_end)} (fin excluido)</p></div><div><h3>Cómo interpretar la puntuación</h3><p className={s.small}>Los pesos son heurísticos. No compares puntuaciones de áreas o periodos calculados con referencias distintas como si fueran medidas absolutas.</p></div></div><div className={s.buttonRow}><Link className={s.button} to={`${basePath}?vista=mapa`}><Layers3 size={16} />Explorar mapa</Link><Link className={`${s.button} ${s.secondary}`} to={`${basePath}/informe`}>Consultar informe</Link></div></div><ClusterTable analysis={analysis} />
          {!!stats.warnings?.length && <section className={`${s.card} ${s.pad}`} style={{ marginTop: 22 }}><h2>Calidad y advertencias</h2><ul className={s.small}>{stats.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}
          {!result.heatmap_layers && <div style={{ marginTop: 20 }}><Notice tone="warning">No se generaron capas mensuales. Las estadísticas de grupos y el informe siguen disponibles.</Notice></div>}
        </>}
        {view === 'datos' && <TechnicalData analysis={analysis} />}
        {(view === 'mapa' || view === '3d') && <Suspense fallback={<Loading text="Preparando la vista del terreno…" />}><MapPanel key={`${id}:${view}`} analysis={analysis} terrain={view === '3d'} /></Suspense>}
        {view === 'informe' && <Suspense fallback={<Loading text="Preparando el informe…" />}><Report analysis={analysis} /></Suspense>}
      </>}
    <ScienceNote />{!shared && <ConfirmDialog open={confirmDelete} title="¿Eliminar este análisis?" label="Eliminar análisis" busy={deleting} cancel={() => setConfirmDelete(false)} confirm={remove}><p>Se eliminará el registro y dejará de estar disponible en tu cuenta. Esta acción no restituye la cuota de un análisis completado.</p></ConfirmDialog>}
  </>;
}
