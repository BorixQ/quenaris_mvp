import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Download, FileUp, MapPinned, Send, Settings2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAnalyses, useQuota } from '../lib/queries';
import { defaultDates, dayCount, downloadJson, number } from '../lib/format';
import { hectares, parseCsv, validateDraft } from '../lib/validation';
import { active, allIndices, presets, studies, studyInfo } from '../data/studies';
import type { Analysis, AnalysisInput, Draft, Study } from '../types';
import { Button, ConfirmDialog, Field, Loading, Notice, ScienceNote } from '../components/UI';
import s from '../styles/App.module.css';

const GeoMap = lazy(() => import('../maps/GeoMap'));
const steps = ['Objetivo', 'Terreno', 'Configuración', 'Revisión'];
export default function Wizard() {
  const quota = useQuota().data!, analyses = useAnalyses(), cache = useQueryClient(), navigate = useNavigate(), location = useLocation();
  const clone = location.state?.clone as Analysis | undefined;
  const [draft, setDraft] = useState<Draft>(() => ({ name: clone ? `${clone.name || 'Análisis'} (copia)`.slice(0, 120) : '', study_type: studyInfo(clone?.study_type || '')?.value || 'agro', aoi: clone?.aoi || null,
    ...defaultDates(quota.max_date_range_days), ...(clone ? { date_start: clone.date_start, date_end: clone.date_end } : {}), algorithm: clone?.algorithm || 'kmeans', n_clusters: clone?.n_clusters || 4, use_pca: clone?.use_pca || false, indices: clone?.indices || null }));
  const initial = useRef(JSON.stringify(draft));
  const [step, setStep] = useState(0), [mode, setMode] = useState<'draw' | 'csv'>('draw'), [csvText, setCsvText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({}), [serverError, setServerError] = useState(''), [busy, setBusy] = useState(false);
  const submitting = useRef(false), canLeave = useRef(false), heading = useRef<HTMLHeadingElement>(null), csvAttempt = useRef(0);
  const dirty = !!draft.aoi || !!draft.name || initial.current !== JSON.stringify(draft);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !canLeave.current && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (dirty && !canLeave.current) event.preventDefault(); };
    window.addEventListener('beforeunload', onUnload); return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);
  const running = analyses.data?.find(a => active(a.status));
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(d => ({ ...d, [key]: value })); setErrors(e => { const next = { ...e }; delete next[key]; return next; }); setServerError(''); };
  function next() {
    const all = validateDraft(draft, quota), keys = [['name'], ['aoi'], ['date_end', 'n_clusters', 'indices'], Object.keys(all)][step];
    const current = Object.fromEntries(Object.entries(all).filter(([key]) => keys.includes(key)));
    if (step === 1 && current.aoi && errors.aoi) current.aoi = errors.aoi;
    setErrors(current); if (!Object.keys(current).length) setStep(v => Math.min(3, v + 1));
  }
  function loadCsv(text: string) {
    csvAttempt.current++;
    try { update('aoi', parseCsv(text)); }
    catch (e) {
      update('aoi', null);
      setErrors(v => ({ ...v, aoi: `${e instanceof Error ? e.message : 'No se pudo leer el CSV.'} No hay terreno seleccionado. Carga coordenadas válidas o dibuja el terreno para continuar.` }));
    }
  }
  async function loadCsvFile(file: File) {
    const attempt = ++csvAttempt.current;
    update('aoi', null);
    if (file.size > 128 * 1024) {
      setErrors(v => ({ ...v, aoi: 'El archivo supera 128 KiB. No hay terreno seleccionado. Usa únicamente los vértices del polígono.' }));
      return;
    }
    try {
      const text = await file.text();
      if (attempt === csvAttempt.current) loadCsv(text);
    } catch {
      if (attempt === csvAttempt.current) setErrors(v => ({ ...v, aoi: 'No se pudo leer el archivo. No hay terreno seleccionado. Vuelve a cargarlo o dibuja el terreno para continuar.' }));
    }
  }
  async function submit() {
    if (submitting.current || running || analyses.isPending || analyses.isError) return;
    const all = validateDraft(draft, quota); setErrors(all); if (Object.keys(all).length) return;
    submitting.current = true; setBusy(true); setServerError('');
    try {
      const result = await api<Analysis>('/analyses/', { method: 'POST', body: JSON.stringify(draft as AnalysisInput) });
      cache.setQueryData(['analysis', result.id], result);
      await Promise.all([cache.invalidateQueries({ queryKey: ['analyses'] }), cache.invalidateQueries({ queryKey: ['quota'] })]);
      canLeave.current = true; navigate(`/analisis/${result.id}`);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'No se pudo enviar el análisis.');
      if (e instanceof ApiError) setErrors(v => ({ ...v, ...e.fields }));
      await Promise.all([cache.invalidateQueries({ queryKey: ['analyses'] }), cache.invalidateQueries({ queryKey: ['quota'] })]);
    } finally { submitting.current = false; setBusy(false); }
  }
  const area = hectares(draft.aoi), remaining = Math.max(0, quota.analyses_allowed - quota.analyses_used), info = studyInfo(draft.study_type)!;
  return <><div className={s.heading}><div><p className={s.eyebrow}>DEL TERRENO A LOS DATOS</p><h1 id="page-title" tabIndex={-1}>Nuevo análisis</h1><p className={s.subtitle}>Define qué quieres explorar. Antes de procesar, podrás revisar todos los parámetros.</p></div><Link to="/analisis" className={s.textButton}><ArrowLeft size={15} />Mis análisis</Link></div>
    {running && <div style={{ marginBottom: 20 }}><Notice tone="warning">Ya tienes un análisis activo. Puedes preparar el terreno, pero debes esperar a que termine para enviar otro. <Link to={`/analisis/${running.id}`}>Ver estado</Link></Notice></div>}
    <div className={s.contentGrid}><section className={s.card} aria-label="Asistente de nuevo análisis"><ol className={s.steps}>{steps.map((name, i) => <li key={name} aria-current={step === i ? 'step' : undefined} data-complete={i < step}><span>{i < step ? <Check size={13} aria-hidden="true" /> : i + 1}</span>{name}</li>)}</ol>
      <div className={s.wizardBody}><h2 tabIndex={-1} ref={heading}>{['¿Qué quieres explorar?', 'Define el área de interés', 'Elige el periodo y la configuración', 'Revisa antes de procesar'][step]}</h2>
        {serverError && <div style={{ marginBottom: 20 }}><Notice tone="error">{serverError}</Notice></div>}
        {step === 0 && <><Field id="analysis-name" label="Nombre del análisis" hint="Opcional. Un nombre reconocible te ayudará a encontrarlo después." error={errors.name}><input placeholder="Ej.: Queñua · Ladera norte" maxLength={120} value={draft.name} onChange={e => update('name', e.target.value)} /></Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className={s.small}>Tipo de estudio</legend><div className={s.studyGrid}>{studies.map(st => <label key={st.value} className={s.studyOption} data-selected={draft.study_type === st.value}><input type="radio" name="study" value={st.value} checked={draft.study_type === st.value} onChange={() => { update('study_type', st.value); update('indices', null); }} /><div><strong>{st.name}</strong>{st.experimental && <span className={`${s.badge} ${s.experimental}`}>Experimental</span>}<p>{st.description}</p></div></label>)}</div></fieldset>
          <p className={s.small} style={{ marginTop: 20 }}>Todos los estudios son exploratorios y requieren contraste con observaciones de campo.</p></>}
        {step === 1 && <><p className={s.small}>Un solo polígono en WGS84. Tu límite actual es {number(quota.max_area_ha, 2)} ha. Las áreas muy pequeñas pueden no reunir suficientes píxeles utilizables.</p>
          <div className={s.modeSwitch} role="group" aria-label="Método para definir el terreno"><button aria-pressed={mode === 'draw'} onClick={() => { csvAttempt.current++; setMode('draw'); }}><MapPinned />Dibujar en el mapa</button><button aria-pressed={mode === 'csv'} onClick={() => setMode('csv')}><FileUp />Importar CSV</button></div>
          {mode === 'csv' && <div className={s.upload}><Field id="csv-file" label="Archivo de coordenadas CSV" hint="Una fila por vértice, columnas lon,lat (también longitud,latitud o x,y). Usa grados decimales y punto decimal."><input type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void loadCsvFile(file); }} /></Field>
            <button className={s.textButton} onClick={() => { const csv = 'lon,lat\n-72.14045,-16.32045\n-72.13955,-16.32045\n-72.13955,-16.31955\n-72.14045,-16.31955\n'; const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ejemplo-arequipa.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={14} />Descargar ejemplo de coordenadas en Arequipa</button>
            <details><summary className={s.small}>Pegar coordenadas en vez de cargar un archivo</summary><Field id="csv-text" label="Coordenadas CSV"><textarea rows={6} value={csvText} placeholder={'lon,lat\n-72.14045,-16.32045\n…'} onChange={e => setCsvText(e.target.value)} /></Field><Button variant="secondary" onClick={() => loadCsv(csvText)}>Cargar coordenadas</Button></details></div>}
          {errors.aoi && <Notice tone="error">{errors.aoi}</Notice>}
          {mode === 'draw' && <p className={s.hint} style={{ marginBottom: 12 }}>Acércate al terreno, pulsa Dibujar polígono y marca sus vértices. Vuelve al primer punto para cerrar. Después puedes arrastrar los vértices para ajustar el área.</p>}
          <Suspense fallback={<Loading text="Preparando el mapa…" />}><GeoMap aoi={draft.aoi} onChange={p => { csvAttempt.current++; update('aoi', p); }} /></Suspense>
          <p className={s.small} role="status" style={{ marginTop: 12 }}>{draft.aoi ? `Terreno cargado · superficie aproximada: ${number(area, 3)} ha · ${draft.aoi.coordinates[0].length - 1} vértices.` : 'Todavía no has definido un terreno.'} El servidor comprobará su geometría y superficie.</p>
        </>}
        {step === 2 && <><p className={s.small}>Se incluye el día de inicio y se excluye el de fin. Tu cuenta admite periodos de hasta {quota.max_date_range_days} días.</p><div className={s.twoColumns}><Field id="date-start" label="Desde (incluido)" error={errors.date_start}><input type="date" value={draft.date_start} onChange={e => update('date_start', e.target.value)} /></Field><Field id="date-end" label="Hasta (excluido)" error={errors.date_end}><input type="date" value={draft.date_end} onChange={e => update('date_end', e.target.value)} /></Field></div>
          <Notice tone="info">Se usarán los índices del estudio {info.short.toLowerCase()}. La nubosidad y las observaciones disponibles pueden limitar la cobertura del resultado.</Notice>
          {dayCount(draft.date_start, draft.date_end) > 366 && <Notice tone="warning">Los periodos de más de un año requieren más procesamiento y podrían superar el tiempo disponible. Un periodo más largo no garantiza imágenes utilizables.</Notice>}
          <details className={s.advanced} open={errors.n_clusters || errors.indices ? true : undefined}><summary><Settings2 size={16} />Configuración avanzada</summary><p className={s.small}>Los valores iniciales permiten explorar el área sin modificar estos parámetros. Cambiarlos no calibra el análisis.</p>
            <div className={s.twoColumns}><Field id="algorithm" label="Algoritmo de agrupación"><select value={draft.algorithm} onChange={e => update('algorithm', e.target.value as Draft['algorithm'])}><option value="kmeans">K-Means</option><option value="dbscan">DBSCAN</option><option value="hdbscan">HDBSCAN</option></select></Field>{draft.algorithm === 'kmeans' && <Field id="n-clusters" label="Número de grupos" error={errors.n_clusters}><input type="number" min={2} max={12} value={draft.n_clusters} onChange={e => update('n_clusters', Number(e.target.value))} /></Field>}</div>
            <label className={s.check}><input type="checkbox" checked={draft.use_pca} onChange={e => update('use_pca', e.target.checked)} />Reducir colinealidad mediante PCA</label>
            <label className={s.check}><input type="checkbox" checked={draft.indices !== null} onChange={e => update('indices', e.target.checked ? [...presets[draft.study_type].indices] : null)} />Elegir índices manualmente</label>
            {draft.indices && <fieldset style={{ border: 0, padding: 0 }}><legend className={s.small}>Índices espectrales y topográficos</legend><div className={s.checks}>{allIndices.map(idx => <label className={s.check} key={idx}><input type="checkbox" checked={draft.indices!.includes(idx)} onChange={e => update('indices', e.target.checked ? [...draft.indices!, idx] : draft.indices!.filter(i => i !== idx))} />{idx}</label>)}</div>{errors.indices && <p className={s.fieldError}>{errors.indices}</p>}</fieldset>}
          </details>
        </>}
        {step === 3 && <><Notice tone="warning">Al enviar, se reservará un análisis de tu cuota. Revisa el terreno y las fechas. Un trabajo completado consume la reserva; consulta tu cuota actual si el servidor informa un fallo.</Notice>
          <dl style={{ marginTop: 20 }}><div className={s.keyValue}><dt>Nombre</dt><dd>{draft.name || 'Sin nombre'}</dd></div><div className={s.keyValue}><dt>Estudio</dt><dd>{info.name}{info.experimental ? ' · Experimental' : ''}</dd></div><div className={s.keyValue}><dt>Superficie aproximada</dt><dd>{number(area, 3)} ha</dd></div><div className={s.keyValue}><dt>Periodo</dt><dd>{draft.date_start} → {draft.date_end}<br />{number(dayCount(draft.date_start, draft.date_end), 0)} días · fin excluido</dd></div><div className={s.keyValue}><dt>Agrupación</dt><dd>{draft.algorithm.toUpperCase()}{draft.algorithm === 'kmeans' ? ` · ${draft.n_clusters} grupos solicitados` : ''}{draft.use_pca ? ' · PCA' : ''}</dd></div><div className={s.keyValue}><dt>Índices</dt><dd>{(draft.indices || presets[draft.study_type].indices).join(', ')}</dd></div></dl>
          {Object.keys(errors).length > 0 && <Notice tone="error"><ul>{Object.entries(errors).map(([key, text]) => <li key={key}>{text}</li>)}</ul></Notice>}
          {analyses.isError && <Notice tone="error">No se pudo comprobar si tienes trabajos activos. <button className={s.textButton} onClick={() => analyses.refetch()}>Volver a comprobar</button></Notice>}
          <p className={s.small}>La puntuación compara zonas de esta área y periodo. No es un diagnóstico ni una prescripción.</p>
        </>}
      </div><div className={s.wizardFooter}><Button variant="secondary" onClick={() => setStep(v => Math.max(0, v - 1))} disabled={step === 0 || busy}><ArrowLeft />Anterior</Button>{step < 3 ? <Button onClick={next}>Continuar<ArrowRight /></Button> : <Button onClick={submit} disabled={busy || !!running || remaining <= 0 || analyses.isPending || analyses.isError}>{busy ? 'Enviando…' : 'Procesar área'}<Send /></Button>}</div>
    </section><aside className={`${s.card} ${s.quotaSummary}`} aria-label="Límites de tu cuenta"><p className={s.eyebrow}>TU CUENTA</p><h3>Antes de comenzar</h3><div className={s.statValue}>{remaining} <small>análisis disponibles</small></div><div className={s.quotaTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, quota.analyses_used / Math.max(1, quota.analyses_allowed) * 100)}%` }} /></div><dl><div className={s.keyValue}><dt>Superficie máxima</dt><dd>{number(quota.max_area_ha, 2)} ha</dd></div><div className={s.keyValue}><dt>Periodo máximo</dt><dd>{quota.max_date_range_days} días</dd></div><div className={s.keyValue}><dt>Trabajos activos</dt><dd>Uno por cuenta</dd></div></dl><p className={s.small}>Los límites protegen los recursos de procesamiento. Si necesitas cambiarlos, contacta con el administrador.</p>{remaining <= 0 && <Notice tone="warning">Tu cuota está agotada. Puedes consultar los análisis existentes.</Notice>}</aside></div>
    <ScienceNote /><ConfirmDialog open={blocker.state === 'blocked'} title="¿Descartar este borrador?" label="Descartar y salir" busy={busy} cancel={() => blocker.state === 'blocked' && blocker.reset()} confirm={() => blocker.state === 'blocked' && blocker.proceed()}><p>El borrador aún no se ha enviado. Los cambios de este formulario se perderán al salir.</p></ConfirmDialog>
  </>;
}
