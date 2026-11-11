import science from './science.json';
import type { Study, Status } from '../types';

export const studies: { value: Study; name: string; short: string; description: string; experimental: boolean }[] = [
  { value: 'agro', name: 'Salud general', short: 'Salud general', description: 'Explora diferencias de vegetación, cobertura y terreno.', experimental: false },
  { value: 'reforestacion', name: 'Potencial de reforestación', short: 'Reforestación', description: 'Explora el terreno; requiere evaluar ecosistemas nativos, especies y uso del suelo.', experimental: false },
  { value: 'riego', name: 'Estado hídrico', short: 'Estado hídrico', description: 'Observa índices asociados a humedad; no determina necesidades ni dosis de riego.', experimental: true },
  { value: 'fumigacion', name: 'Alerta fitosanitaria', short: 'Fitosanidad', description: 'Explora variaciones espectrales; no identifica plagas ni tratamientos.', experimental: true },
  { value: 'fertilizacion', name: 'Nutrición', short: 'Nutrición', description: 'Observa índices de vegetación; no determina nutrientes ni dosis de fertilizante.', experimental: true },
];
export const studyInfo = (value: string) => studies.find(s => s.value === value);
export const statusLabel: Record<Status, string> = { PENDING: 'En cola', PROCESSING: 'Procesando', COMPLETED: 'Completado', FAILED: 'No completado' };
export const active = (status: Status) => status === 'PENDING' || status === 'PROCESSING';
export const presets = science.presets;
export const allIndices = science.indices;
export const SCIENCE_NOTE = 'Resultado exploratorio, sin calibración de campo. La puntuación es relativa al área y periodo: no confirma causas ni prescribe intervenciones.';
export const indexNames: Record<string, string> = { suitability: 'Puntuación relativa', slope: 'Pendiente', elevation: 'Elevación', aspect: 'Orientación', solarexposure: 'Orientación norte', moisturestress: 'MoistureStress', cire: 'CIre' };
export const indexName = (key: string) => indexNames[key.toLowerCase()] || key.toUpperCase();
export const indexUnit = (key: string) => ['slope', 'aspect'].includes(key.toLowerCase()) ? '°' : ['elevation', 'tpi', 'tri'].includes(key.toLowerCase()) ? 'm' : key === 'suitability' ? '/100' : 'adimensional';
export const indexDescriptions: Record<string, string> = {
  suitability: 'Combinación heurística de índices normalizados con una referencia fija del área y periodo. No mide salud ni viabilidad absoluta.',
  ndvi: 'Contraste NIR/rojo relacionado con cobertura y verdor; no confirma salud ni especie.',
  evi: 'Índice de vegetación con constantes sobre reflectancia; necesita interpretación local.',
  msavi: 'Índice ajustado al fondo del suelo; no estima éxito de plantación.',
  ndre: 'Contraste NIR/red-edge influido por dosel, pigmentos y suelo.',
  ndmi: 'Contraste NIR/SWIR; no cuantifica por sí solo la necesidad de riego.',
  ndwi: 'Contraste verde/NIR; no demuestra agua disponible para las plantas.',
  ndsi: 'Contraste SWIR1/SWIR2 del MVP, sin calibración para salinidad.',
  si2: 'Magnitud espectral NIR/verde/rojo, sin calibración para salinidad.',
  bsi: 'Contraste de brillo y cobertura. Suelo expuesto no implica degradación ni disponibilidad para plantar.',
  psri: 'Aproximación Sentinel-2 de un índice de pigmentos; no diagnostica enfermedad.',
  elevation: 'Altura de la superficie del DSM; puede incluir vegetación e infraestructura.',
  slope: 'Pendiente derivada de un DSM de unos 30 m de resolución nativa.',
  aspect: 'Orientación de la superficie derivada del DSM; no equivale a radiación solar.',
  tpi: 'Diferencia entre la altura del DSM y su media local.',
  tri: 'Desviación local del DSM, utilizada como variante de rugosidad.',
  solarexposure: 'Proxy de orientación norte entre 0 y 1, neutro en terreno casi plano. No son horas de sol.',
};
export function indexDescription(key: string) { return indexDescriptions[key.toLowerCase()] || 'Índice espectral exploratorio; requiere contexto y validación local.'; }
