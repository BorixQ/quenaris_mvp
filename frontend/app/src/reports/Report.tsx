import { lazy, Suspense } from 'react';
import { Printer } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AreaEstimateNotice, Button, Loading, Notice } from '../components/UI';
import { ClusterTable } from '../analyses/ResultData';
import { date, number, percent, title } from '../lib/format';
import { studyInfo, SCIENCE_NOTE } from '../data/studies';
import type { Analysis } from '../types';
import s from '../styles/App.module.css';

const Charts = lazy(() => import('./Charts'));
export default function Report({ analysis }: { analysis: Analysis }) {
  const result = analysis.result!, stats = result.statistics;
  return <article className={`${s.card} ${s.report}`}><div className={s.heading}><div><p className={s.eyebrow}>QUENARIS · INFORME EXPLORATORIO</p><h2 className={s.reportTitle}>{title(analysis)}</h2><p className={s.reportMeta}>{studyInfo(analysis.study_type)?.name || analysis.study_type} · {date(analysis.date_start)} → {date(analysis.date_end)} (fin excluido)<br />{number(analysis.area_ha, 2)} ha solicitadas · {result.satellite_collection}<br />ID: {analysis.id}</p></div><Button variant="secondary" onClick={() => window.print()}><Printer />Imprimir / guardar PDF</Button></div>
    <Notice tone="warning">{SCIENCE_NOTE}</Notice><AreaEstimateNotice statistics={stats} /><section className={s.reportSection}><h2>Datos que respaldan esta lectura</h2><div className={s.twoColumns}><dl><div className={s.keyValue}><dt>Cobertura utilizable</dt><dd>{percent(stats.quality?.valid_fraction)}</dd></div><div className={s.keyValue}><dt>Escenas del periodo</dt><dd>{number(result.images_used, 0)}</dd></div><div className={s.keyValue}><dt>Cuadrícula de salida</dt><dd>{number(stats.analysis_scale_m, 0)} m</dd></div></dl><dl><div className={s.keyValue}><dt>Puntuación relativa media</dt><dd>{number(stats.suitability_global_mean)} /100</dd></div><div className={s.keyValue}><dt>Área con datos</dt><dd>{number(stats.total_area_ha, 2)} ha</dd></div><div className={s.keyValue}><dt>Versión científica</dt><dd>{stats.science_version || 'No registrada'}</dd></div></dl></div></section>
    {!!stats.warnings?.length && <section className={s.reportSection}><h2>Advertencias de calidad</h2><ul className={s.small}>{stats.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}
    <section className={s.reportSection}><ClusterTable analysis={analysis} /></section><section className={s.reportSection}><h2>Comparación descriptiva</h2><Suspense fallback={<Loading text="Preparando gráficos…" />}><Charts analysis={analysis} /></Suspense></section>
    <section className={s.reportSection}><h2>Informe factual del análisis</h2>{stats.science_version ? result.report_markdown ? <div className={s.reportText}><ReactMarkdown skipHtml allowedElements={['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre', 'blockquote', 'hr', 'br', 'a']} urlTransform={url => /^https:\/\//i.test(url) ? url : ''} components={{ h1: ({ children }) => <h3>{children}</h3>, h2: ({ children }) => <h3>{children}</h3>, h3: ({ children }) => <h4>{children}</h4>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{result.report_markdown}</ReactMarkdown></div> : <p className={s.small}>No se guardó un informe factual. Las estadísticas siguen disponibles arriba.</p> : <Notice tone="warning">El informe histórico no se muestra porque no consta una versión científica. Recalcula el análisis para generar un informe con las reglas actuales.</Notice>}</section>
    <section className={s.reportSection}><h2>Antes de intervenir en el terreno</h2><p className={s.small}>Contrasta las observaciones con el cultivo o ecosistema, su etapa, suelo y mediciones de campo. Para reforestación, revisa los ecosistemas nativos, especies adecuadas, tenencia y usos del suelo. Una superficie expuesta no es automáticamente terreno disponible para plantar.</p></section>
  </article>;
}
