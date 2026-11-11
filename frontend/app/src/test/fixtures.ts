import type { Analysis, Quota } from '../types';

export const quota: Quota = { email: 'tecnico@example.invalid', first_name: 'Cuenta de prueba', last_name: '', is_superuser: false, analyses_used: 0, analyses_allowed: 5, max_area_ha: 100, max_date_range_days: 31 };
export const csv = 'lon,lat\n-72.1404,-16.3204\n-72.1396,-16.3204\n-72.1396,-16.3196\n-72.1404,-16.3196\n';
export const analysis: Analysis = {
  id: '11111111-1111-4111-a111-111111111111', name: 'Ejemplo controlado · Queñua',
  aoi: { type: 'Polygon', coordinates: [[[-72.1404, -16.3204], [-72.1396, -16.3204], [-72.1396, -16.3196], [-72.1404, -16.3196], [-72.1404, -16.3204]]] },
  area_ha: .76, date_start: '2025-06-01', date_end: '2025-06-15', study_type: 'reforestacion', algorithm: 'kmeans', n_clusters: 2, use_pca: false, indices: ['MSAVI', 'NDMI'],
  status: 'COMPLETED', error_message: '', created_at: '2026-11-10T12:00:00Z', finished_at: '2026-11-10T12:00:20Z',
  result: {
    clusters_geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cluster_id: 0 }, geometry: { type: 'Polygon', coordinates: [[[-72.1404, -16.3204], [-72.1396, -16.3204], [-72.1396, -16.3196], [-72.1404, -16.3196], [-72.1404, -16.3204]]] } }] },
    statistics: { calibrated: false, science_version: 'relative-percentiles-v2', suitability_global_mean: 0, n_clusters: 2, analysis_scale_m: 20, total_area_ha: .65, quality: { valid_fraction: .85, valid_pixels: 22 }, indices_used: ['MSAVI', 'NDMI'], warnings: ['Ejemplo controlado: observaciones incompletas.'], clusters: [{ cluster_id: 0, label: 'Grupo 1', priority: 'Alta', suitability_mean: 0, area_ha: .35, msavi_mean: 0, ndmi_mean: null }, { cluster_id: 1, label: 'Grupo 2', priority: 'Media', suitability_mean: 60, area_ha: .3, msavi_mean: .5, ndmi_mean: .2 }] },
    report_markdown: '## Observaciones\n\n- Resultado exploratorio.\n\nSin calibración de campo.', satellite_collection: 'COPERNICUS/S2_SR_HARMONIZED', images_used: 3, processing_seconds: 20,
    heatmap_layers: { bounds: [-72.1404, -16.3204, -72.1396, -16.3196], indices: ['suitability', 'ndmi'], timesteps: ['2025-06'], url_template: '/media/heatmaps/11111111-1111-4111-a111-111111111111/{index}/{timestep}.png', ranges: { suitability: { vmin: 0, vmax: 100 }, ndmi: { vmin: -.3, vmax: .5 } }, legends: { suitability: { vmin: 0, vmax: 100, colors: ['#a50026', '#ffffbf', '#006837'] } }, skipped_months: [{ month: '2025-07', reason: 'insufficient_valid_pixels' }], suitability_series: [{ month: '2025-06', suitability_mean: 0, valid_fraction: .85, images_used: 3 }] },
  },
};
