import area from '@turf/area';
import booleanValid from '@turf/boolean-valid';
import kinks from '@turf/kinks';
import Papa from 'papaparse';
import type { Polygon } from 'geojson';
import type { Draft, Quota } from '../types';
import { dayCount } from './format';
import { presets } from '../data/studies';

export function polygonError(p: Polygon | null): string | null {
  if (!p) return 'Dibuja un polígono o importa sus coordenadas en CSV.';
  if (p.type !== 'Polygon' || !Array.isArray(p.coordinates) || !p.coordinates.length) return 'Se requiere un polígono WGS84 válido.';
  const points = p.coordinates.flat();
  if (points.length > 1000) return 'El polígono admite como máximo 1000 vértices; simplifícalo.';
  if (points.some(c => c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) return 'Usa longitudes y latitudes finitas en grados WGS84.';
  try {
    if (!booleanValid(p) || kinks(p).features.length || area(p) <= 0) return 'El polígono no es válido. Revisa cruces de bordes y vértices repetidos.';
  } catch { return 'No se pudo interpretar el polígono. Revisa sus coordenadas.'; }
  return null;
}
export function hectares(p: Polygon | null): number | null {
  try { const n = p ? area(p) / 10000 : null; return n !== null && Number.isFinite(n) ? n : null; } catch { return null; }
}
export function parseCsv(text: string): Polygon {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.replace(/^\uFEFF/, '').trim().toLowerCase() });
  if (parsed.errors.length) throw new Error('El CSV no es válido. Usa una fila por vértice y columnas lon,lat.');
  if (parsed.data.length < 3 || parsed.data.length > 999) throw new Error('El CSV debe contener entre 3 y 999 vértices antes de cerrar el polígono.');
  const points = parsed.data.map((row, i) => {
    const x = row.lon ?? row.longitud ?? row.x, y = row.lat ?? row.latitud ?? row.y;
    if (x === undefined || y === undefined || !x.trim() || !y.trim()) throw new Error(`Faltan coordenadas en la fila ${i + 2}. Usa columnas lon,lat.`);
    return [Number(x), Number(y)];
  });
  if (points[0][0] !== points.at(-1)![0] || points[0][1] !== points.at(-1)![1]) points.push([...points[0]]);
  const p: Polygon = { type: 'Polygon', coordinates: [points] };
  const error = polygonError(p); if (error) throw new Error(error);
  return p;
}
export function validateDraft(d: Draft, q: Quota): Record<string, string> {
  const errors: Record<string, string> = {};
  if (d.name.length > 120) errors.name = 'El nombre admite hasta 120 caracteres.';
  const polygon = polygonError(d.aoi); if (polygon) errors.aoi = polygon;
  const ha = hectares(d.aoi);
  if (ha !== null && ha > Math.min(5000, q.max_area_ha) * 1.001) errors.aoi = `La superficie aproximada supera el máximo de ${Math.min(5000, q.max_area_ha)} ha. Reduce el terreno; el servidor comprobará el área exacta.`;
  const days = dayCount(d.date_start, d.date_end);
  if (!Number.isFinite(days) || days <= 0) errors.date_end = 'La fecha de fin debe ser posterior al inicio.';
  else if (days > Math.min(366, q.max_date_range_days)) errors.date_end = `El periodo supera tu límite de ${Math.min(366, q.max_date_range_days)} días.`;
  if (d.algorithm === 'kmeans' && (!Number.isInteger(d.n_clusters) || d.n_clusters < 2 || d.n_clusters > 12)) errors.n_clusters = 'Elige entre 2 y 12 grupos.';
  if (d.indices && (!d.indices.length || !d.indices.some(i => presets[d.study_type].scoring_indices.includes(i)))) errors.indices = 'Incluye al menos un índice con peso en la puntuación del estudio.';
  if (q.analyses_used >= q.analyses_allowed) errors.quota = 'Has alcanzado la cuota de análisis. Consulta los límites de tu cuenta.';
  return errors;
}
