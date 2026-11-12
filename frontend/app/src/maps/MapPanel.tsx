import { useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import GeoMap from './GeoMap';
import { groupColor } from './colors';
import { clusterLabel } from '../analyses/ResultData';
import { Button, Notice } from '../components/UI';
import { indexDescription, indexName, indexUnit } from '../data/studies';
import { number } from '../lib/format';
import type { Analysis } from '../types';
import s from '../styles/App.module.css';
import { useExpandedMap } from './useExpandedMap';

function monthLabel(value: string | undefined) {
  if (!value) return 'Sin meses disponibles';
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

export default function MapPanel({ analysis, terrain = false }: { analysis: Analysis; terrain?: boolean }) {
  const result = analysis.result!, heat = result.heatmap_layers;
  const [layer, setLayer] = useState('__zones__'), [time, setTime] = useState(0), [opacity, setOpacity] = useState(75);
  const { expanded, setExpanded, panel } = useExpandedMap();
  const legend = heat?.legends?.[layer], range = legend || heat?.ranges?.[layer];
  const months = heat?.timesteps || [], selectedTime = Math.min(time, Math.max(0, months.length - 1));
  return <section ref={panel as RefObject<HTMLElement>} className={`${s.card} ${expanded ? s.mapExpanded : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label={terrain ? 'Exploración en 3D' : 'Mapa de resultados'}><div className={s.cardHead}><h2>{terrain ? 'El terreno en perspectiva' : 'Explora el área de interés'}</h2><Button variant="secondary" data-close-map={expanded || undefined} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 /> : <Maximize2 />}{expanded ? 'Salir de vista ampliada' : 'Ampliar mapa'}</Button></div>
    <GeoMap aoi={analysis.aoi} clusters={result.clusters_geojson} heatmaps={heat} layer={layer} timestep={months[selectedTime]} opacity={opacity / 100} terrain={terrain} />
    <div className={s.mapControls}><div><label htmlFor="map-layer">Capa</label><select id="map-layer" value={layer} onChange={e => setLayer(e.target.value)}><option value="__zones__">Grupos del análisis</option>{heat?.indices.map(i => <option key={i} value={i}>{indexName(i)}</option>)}</select></div>
      {layer !== '__zones__' && <><div className={s.timeline}><label htmlFor="map-month">Mes: <strong>{monthLabel(months[selectedTime])}</strong></label>
        <div className={s.timelineControls}><button type="button" className={s.timelineButton} aria-label="Mes disponible anterior" disabled={selectedTime <= 0 || !months.length} onClick={() => setTime(selectedTime - 1)}><ChevronLeft aria-hidden="true" /></button>
          <input id="map-month" type="range" min="0" max={Math.max(0, months.length - 1)} step="1" value={selectedTime} disabled={months.length <= 1} aria-valuetext={monthLabel(months[selectedTime])} aria-describedby="map-month-hint" onChange={e => setTime(Number(e.target.value))} />
          <button type="button" className={s.timelineButton} aria-label="Mes disponible siguiente" disabled={selectedTime >= months.length - 1} onClick={() => setTime(selectedTime + 1)}><ChevronRight aria-hidden="true" /></button></div>
        <div className={s.timelineEnds} aria-hidden="true"><span>{monthLabel(months[0])}</span><span>{months.length > 1 ? monthLabel(months[months.length - 1]) : ''}</span></div>
        <p id="map-month-hint" className={s.timelineHint}>Solo meses disponibles; consulta abajo los meses omitidos.</p></div><div><label htmlFor="map-opacity">Opacidad: {opacity} %</label><input id="map-opacity" aria-label="Opacidad de la capa" type="range" min="0" max="100" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></div></>}
    </div><div className={s.legend}>
      {layer === '__zones__' ? <><strong>Grupos espectrales</strong><p className={s.hint}>Los colores identifican grupos, no niveles de salud ni urgencia.</p><div className={s.legendGroups}>{result.statistics.clusters?.map(c => <span key={c.cluster_id}><span className={s.swatch} style={{ background: groupColor(c.cluster_id) }} />{clusterLabel(c)} · {number(c.area_ha, 2)} ha</span>)}</div></> : <><strong>{indexName(layer)} · {indexUnit(layer)}</strong>
        {legend?.colors?.length ? <div className={s.legendBar} role="img" aria-label={`Escala de ${legend.vmin} a ${legend.vmax}`} style={{ background: `linear-gradient(to right, ${legend.colors.map((c, i) => `${c} ${100 * i / (legend.colors.length - 1)}%`).join(',')})` }} /> : <p className={s.hint}>Leyenda de colores no registrada en este análisis histórico.</p>}
        {range && <div className={s.legendEnds}><span>{number(range.vmin, 3)}</span><span>{number(range.vmax, 3)}</span></div>}<p className={s.small} style={{ marginTop: 12, marginBottom: 0 }}>{indexDescription(layer)} Los píxeles sin datos son transparentes.</p>
      </>}
      {!heat && <div style={{ marginTop: 15 }}><Notice tone="warning">Este resultado no tiene mapas mensuales. Puedes consultar sus grupos, estadísticas e informe.</Notice></div>}
      {!!heat?.skipped_months?.length && <details style={{ marginTop: 12 }}><summary>Meses omitidos: {heat.skipped_months.length}</summary><ul>{heat.skipped_months.map(m => <li key={m.month}>{m.month}: sin imágenes o píxeles utilizables suficientes.</li>)}</ul></details>}
      {terrain && <p className={s.hint} style={{ marginTop: 12 }}>Relieve externo de referencia, con exageración visual 1,15×. No añade detalle a la resolución del análisis.</p>}
    </div></section>;
}
