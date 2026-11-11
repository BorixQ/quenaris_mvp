import { useEffect, useRef } from 'react';
import { Chart, CategoryScale, LinearScale, BarController, BarElement, LineController, LineElement, PointElement, Tooltip, Legend } from 'chart.js';
import type { Analysis } from '../types';
import { clusterLabel } from '../analyses/ResultData';
import { number } from '../lib/format';
import s from '../styles/App.module.css';

Chart.register(CategoryScale, LinearScale, BarController, BarElement, LineController, LineElement, PointElement, Tooltip, Legend);
export default function Charts({ analysis }: { analysis: Analysis }) {
  const groups = useRef<HTMLCanvasElement>(null), temporal = useRef<HTMLCanvasElement>(null);
  const stats = analysis.result!.statistics, heat = analysis.result!.heatmap_layers;
  useEffect(() => {
    const charts: Chart[] = [], clusters = stats.clusters || [];
    if (groups.current && clusters.length) charts.push(new Chart(groups.current, { type: 'bar', data: { labels: clusters.map(clusterLabel), datasets: [{ label: 'Puntuación relativa', data: clusters.map(c => c.suitability_mean), backgroundColor: '#31764b', borderRadius: 4, maxBarThickness: 28 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, indexAxis: 'y', scales: { x: { min: 0, max: 100, grid: { color: '#e8edea' } }, y: { grid: { display: false } } }, plugins: { legend: { display: false } } } }));
    if (temporal.current && heat?.suitability_series?.length) {
      const records = [...heat.suitability_series.map(r => ({ month: r.month, value: r.suitability_mean })), ...(heat.skipped_months || []).map(r => ({ month: r.month, value: null }))].sort((a, b) => a.month.localeCompare(b.month));
      charts.push(new Chart(temporal.current, { type: 'line', data: { labels: records.map(r => r.month), datasets: [{ label: 'Media relativa mensual', data: records.map(r => r.value), borderColor: '#1d4ed8', backgroundColor: '#1d4ed8', tension: 0, spanGaps: false, pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { min: 0, max: 100, grid: { color: '#e8edea' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } } }));
    }
    return () => charts.forEach(chart => chart.destroy());
  }, [stats, heat]);
  return <><div className={s.twoColumns}><section className={`${s.card} ${s.pad}`}><h3>Puntuación por grupo</h3>{stats.clusters?.length ? <div className={s.chart}><canvas ref={groups} role="img" aria-label="Puntuación relativa media por grupo; los mismos valores figuran en la tabla de grupos" /></div> : <p className={s.small}>Sin grupos registrados.</p>}</section><section className={`${s.card} ${s.pad}`}><h3>Observaciones mensuales</h3>{heat?.suitability_series?.length ? <div className={s.chart}><canvas ref={temporal} role="img" aria-label="Media relativa mensual; valores y meses omitidos en la tabla siguiente" /></div> : <p className={s.small}>No hay una serie mensual registrada.</p>}</section></div>
    {!!heat?.suitability_series?.length && <details className={s.advanced}><summary>Valores mensuales y disponibilidad</summary><p className={s.small}>Referencia fija del periodo principal. Las diferencias son descriptivas y no demuestran una tendencia ni una causa. La cobertura utilizable puede cambiar entre meses.</p><div className={s.tableScroll} tabIndex={0} role="region" aria-label="Tabla de valores mensuales"><table><thead><tr><th scope="col">Mes</th><th scope="col">Media relativa</th><th scope="col">Cobertura utilizable</th><th scope="col">Escenas</th></tr></thead><tbody>{heat.suitability_series.map(r => <tr key={r.month}><th scope="row">{r.month}</th><td>{number(r.suitability_mean)}</td><td>{typeof r.valid_fraction === 'number' ? `${number(r.valid_fraction * 100)} %` : '—'}</td><td>{number(r.images_used, 0)}</td></tr>)}{heat.skipped_months?.map(m => <tr key={m.month}><th scope="row">{m.month}</th><td colSpan={3}>Mes omitido: datos insuficientes</td></tr>)}</tbody></table></div></details>}
  </>;
}
