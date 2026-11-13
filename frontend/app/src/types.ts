import type { FeatureCollection, Geometry, Polygon } from 'geojson';

export type Study = 'agro' | 'reforestacion' | 'riego' | 'fumigacion' | 'fertilizacion';
export type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type Algorithm = 'kmeans' | 'dbscan' | 'hdbscan';
export interface Quota {
  email: string; first_name: string; last_name: string; is_superuser: boolean;
  is_staff?: boolean;
  analyses_used: number; analyses_allowed: number; max_area_ha: number; max_date_range_days: number;
  area_allowance_ha?: number | null; area_used_ha?: number; area_remaining_ha?: number | null;
}
export interface Cluster {
  cluster_id: number; label: string; priority: string; suitability_mean: number | null; area_ha: number;
  [key: string]: unknown;
}
export interface Statistics {
  calibrated?: boolean; science_version?: string; warnings?: string[]; quality?: { valid_fraction?: number; valid_pixels?: number; aoi_grid_pixels?: number; [key: string]: unknown };
  n_clusters?: number; total_area_ha?: number; suitability_global_mean?: number | null;
  clusters?: Cluster[]; indices_used?: string[]; algorithm?: string; analysis_scale_m?: number;
  native_resolution_note?: string; silhouette?: number | null; noise_pixels?: number;
  importance_method?: string; feature_importance?: { feature: string; importance: number }[];
  sources?: Record<string, string>; weights?: Record<string, number>; priority_distribution?: Record<string, number>;
  [key: string]: unknown;
}
export interface Legend { vmin: number; vmax: number; colors: string[] }
export interface Heatmaps {
  bounds: [number, number, number, number]; indices: string[]; timesteps: string[]; url_template: string;
  ranges?: Record<string, { vmin: number; vmax: number }>;
  legends?: Record<string, Legend>; scale_m?: number;
  skipped_months?: { month: string; reason: string }[];
  suitability_series?: { month: string; suitability_mean: number | null; valid_fraction?: number; images_used?: number; start?: string; end_exclusive?: string }[];
  scoring_reference?: unknown; temporal_interpretation?: string;
}
export interface AnalysisResult {
  clusters_geojson: FeatureCollection<Geometry>; statistics: Statistics; heatmap_layers: Heatmaps | null;
  report_markdown: string; satellite_collection: string; images_used: number; processing_seconds: number;
}
export interface Analysis {
  id: string; name: string; aoi: Polygon; area_ha: number; date_start: string; date_end: string;
  study_type: string; algorithm: Algorithm; n_clusters: number; use_pca: boolean; indices: string[] | null;
  status: Status; error_message?: string; created_at: string; finished_at: string | null;
  result: AnalysisResult | null; user_email?: string;
  sharing_enabled?: boolean; share_path?: string | null;
  is_featured?: boolean; featured_description?: string; thumbnail_url?: string | null;
}
export interface Sharing { sharing_enabled: boolean; share_path: string | null }
export interface FeaturedState { is_featured: boolean; featured_description: string; thumbnail_url?: string | null }
export interface SharedAccount extends FeaturedState { is_owner: boolean; is_saved: boolean; can_feature: boolean }
export interface ProjectSummary {
  name: string; share_path: string | null; analysis_id?: string; aoi?: Polygon;
  study_type?: string; area_ha?: number; date_start?: string; date_end?: string;
  description?: string; featured_at?: string;
  thumbnail_url?: string | null;
}
export interface ReceivedProject extends ProjectSummary { id: number; available: boolean; saved_at: string }
export interface ProjectPage<T> { count: number; next: string | null; previous: string | null; results: T[] }
export interface AnalysisInput {
  name: string; aoi: Polygon; date_start: string; date_end: string; study_type: Study;
  algorithm: Algorithm; n_clusters: number; use_pca: boolean; indices: string[] | null;
}
export interface Draft extends Omit<AnalysisInput, 'aoi'> { aoi: Polygon | null }
