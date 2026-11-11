import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { type Map as LibreMap, type GeoJSONSource, type ImageSource, type IControl, type StyleSpecification } from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, Geometry, Polygon } from 'geojson';
import { Expand, MousePointer2, Trash2 } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { privateImageExpired, privateMapRequest } from '../lib/api';
import type { Heatmaps } from '../types';
import { Button } from '../components/UI';
import s from '../styles/App.module.css';
import { groupColor } from './colors';
import { useExpandedMap } from './useExpandedMap';

maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);
interface Props { aoi?: Polygon | null; onChange?: (p: Polygon | null) => void; clusters?: FeatureCollection<Geometry>; heatmaps?: Heatmaps | null; layer?: string; timestep?: string; opacity?: number; terrain?: boolean }
function boundsFor(geometry: unknown): maplibregl.LngLatBoundsLike | null {
  const coords: number[][] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') coords.push([value[0], value[1]]); else value.forEach(walk);
  };
  const g = geometry as { coordinates?: unknown; features?: { geometry?: { coordinates?: unknown } }[] } | null;
  if (g?.coordinates) walk(g.coordinates);
  g?.features?.forEach(f => walk(f.geometry?.coordinates));
  const valid = coords.filter(c => c.every(Number.isFinite));
  if (!valid.length) return null;
  return [[Math.min(...valid.map(c => c[0])), Math.min(...valid.map(c => c[1]))], [Math.max(...valid.map(c => c[0])), Math.max(...valid.map(c => c[1]))]];
}
export default function GeoMap(props: Props) {
  const host = useRef<HTMLDivElement>(null), mapRef = useRef<LibreMap | null>(null), drawRef = useRef<MapboxDraw | null>(null);
  const latest = useRef(props); latest.current = props;
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const { expanded, setExpanded, panel } = useExpandedMap();
  const drawing = !!props.onChange;
  useEffect(() => {
    if (!host.current) return;
    setReady(false); setError('');
    const style: StyleSpecification = { version: 8, sources: {
      satellite: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      ...(props.terrain ? { dem: { type: 'raster-dem' as const, encoding: 'terrarium' as const, tileSize: 256, maxzoom: 15, tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] } } : {}),
    }, layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }] };
    let map: LibreMap;
    try {
      map = new maplibregl.Map({ container: host.current, style, center: [-71.537, -16.409], zoom: drawing ? 12 : 10, pitch: props.terrain ? 55 : 0, bearing: props.terrain ? -15 : 0,
        transformRequest: privateMapRequest, attributionControl: { compact: true }, locale: { 'NavigationControl.ZoomIn': 'Acercar', 'NavigationControl.ZoomOut': 'Alejar', 'NavigationControl.ResetBearing': 'Orientar al norte', 'AttributionControl.ToggleAttribution': 'Mostrar atribución' } });
    } catch { setError('Este navegador no pudo iniciar el mapa. Puedes consultar los datos en las tablas o importar el terreno por CSV.'); return; }
    mapRef.current = map;
    map.getCanvas().setAttribute('aria-label', drawing ? 'Mapa para dibujar el área de interés; también puedes cargar un CSV' : 'Mapa de los resultados; los datos también están disponibles en tablas');
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: !!props.terrain }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 100 }), 'bottom-left');
    if (drawing) {
      Object.assign(MapboxDraw.constants.classes, { CONTROL_BASE: 'maplibregl-ctrl', CONTROL_PREFIX: 'maplibregl-ctrl-', CONTROL_GROUP: 'maplibregl-ctrl-group' });
      const draw = new MapboxDraw({ displayControlsDefault: false });
      map.addControl(draw as unknown as IControl, 'top-right'); drawRef.current = draw;
      const sync = () => {
        const all = draw.getAll().features;
        const last = all.at(-1);
        if (all.length > 1) draw.delete(all.slice(0, -1).map(f => String(f.id)));
        latest.current.onChange?.(last?.geometry.type === 'Polygon' ? last.geometry : null);
      };
      const events = map as unknown as { on: (name: string, callback: () => void) => void };
      events.on('draw.create', () => {
        sync();
        const feature = draw.getAll().features.at(-1);
        if (feature?.id) queueMicrotask(() => { if (drawRef.current === draw) draw.changeMode('direct_select', { featureId: String(feature.id) }); });
      });
      events.on('draw.update', sync); events.on('draw.delete', sync);
    }
    map.on('error', event => {
      const err = event.error as Error & { status?: number; url?: string };
      console.warn('Quenaris map:', err.message);
      if (err.status === 401 && ((event as { sourceId?: string }).sourceId === 'heat' || err.url?.includes('/media/heatmaps/'))) privateImageExpired();
      else setError('No se pudo cargar una parte del mapa. Los datos y el informe siguen disponibles. Revisa la conexión o cambia a la vista de datos.');
    });
    map.on('load', () => {
      if (latest.current.terrain) map.setTerrain({ source: 'dem', exaggeration: 1.15 });
      setReady(true);
    });
    const observer = new ResizeObserver(() => map.resize()); observer.observe(host.current);
    return () => { observer.disconnect(); drawRef.current = null; mapRef.current = null; map.remove(); };
  }, [drawing, props.terrain]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    let externalChange = !drawRef.current;
    if (drawRef.current) {
      const current = drawRef.current.getAll().features.at(-1)?.geometry;
      if (JSON.stringify(current || null) !== JSON.stringify(props.aoi || null)) {
        externalChange = true;
        drawRef.current.set({ type: 'FeatureCollection', features: props.aoi ? [{ type: 'Feature', properties: {}, geometry: props.aoi }] : [] });
      }
    } else if (props.aoi) {
      const feature = { type: 'Feature' as const, properties: {}, geometry: props.aoi };
      if (map.getSource('aoi')) (map.getSource('aoi') as GeoJSONSource).setData(feature);
      else {
        map.addSource('aoi', { type: 'geojson', data: feature });
        map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [3, 2] } });
      }
    }
    const bounds = boundsFor(props.aoi || props.clusters);
    if (bounds && externalChange) map.fitBounds(bounds, { padding: 55, maxZoom: 17, duration: 0 });
  }, [props.aoi, ready]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !props.clusters) return;
    if (map.getSource('clusters')) (map.getSource('clusters') as GeoJSONSource).setData(props.clusters);
    else {
      const ids = [...new Set(props.clusters.features.map(f => Number(f.properties?.cluster_id)).filter(Number.isFinite))];
      map.addSource('clusters', { type: 'geojson', data: props.clusters });
      map.addLayer({ id: 'clusters-fill', type: 'fill', source: 'clusters', paint: { 'fill-color': ids.length ? ['match', ['get', 'cluster_id'], ...ids.flatMap(id => [id, groupColor(id)]), '#777e86'] as unknown as maplibregl.ExpressionSpecification : '#777e86', 'fill-opacity': .66 } });
      map.addLayer({ id: 'clusters-line', type: 'line', source: 'clusters', paint: { 'line-color': '#ffffff', 'line-width': 1.1 } });
    }
    if (!props.aoi) { const bounds = boundsFor(props.clusters); if (bounds) map.fitBounds(bounds, { padding: 55, maxZoom: 17, duration: 0 }); }
  }, [props.clusters, props.aoi, ready]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    const showHeat = !!props.heatmaps && props.layer && props.layer !== '__zones__' && !!props.timestep;
    if (map.getLayer('clusters-fill')) map.setLayoutProperty('clusters-fill', 'visibility', showHeat ? 'none' : 'visible');
    if (map.getLayer('clusters-line')) map.setLayoutProperty('clusters-line', 'visibility', showHeat ? 'none' : 'visible');
    if (!showHeat || !props.heatmaps) { if (map.getLayer('heat')) map.setLayoutProperty('heat', 'visibility', 'none'); return; }
    const h = props.heatmaps, [w, south, east, north] = h.bounds;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [[w, north], [east, north], [east, south], [w, south]];
    const url = h.url_template.replace('{index}', props.layer!).replace('{timestep}', props.timestep!);
    if (map.getSource('heat')) (map.getSource('heat') as ImageSource).updateImage({ url, coordinates });
    else { map.addSource('heat', { type: 'image', url, coordinates }); map.addLayer({ id: 'heat', type: 'raster', source: 'heat', paint: { 'raster-opacity': .75, 'raster-fade-duration': 0 } }); }
    map.setLayoutProperty('heat', 'visibility', 'visible');
  }, [props.heatmaps, props.layer, props.timestep, ready]);
  useEffect(() => { const map = mapRef.current; if (ready && map?.getLayer('heat')) map.setPaintProperty('heat', 'raster-opacity', props.opacity ?? .75); }, [props.opacity, ready, props.layer, props.timestep]);
  return <div ref={panel as React.RefObject<HTMLDivElement>} className={`${s.geoMap} ${expanded ? s.mapExpanded : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label={expanded ? 'Dibujar terreno en mapa ampliado' : undefined}>
    {drawing && <div className={s.mapToolbar}><div className={s.modeSwitch} role="group" aria-label="Herramientas del terreno"><Button variant="secondary" disabled={!ready} onClick={() => { setExpanded(true); drawRef.current?.changeMode('draw_polygon'); }}><MousePointer2 />Dibujar polígono</Button><Button variant="secondary" disabled={!props.aoi} onClick={() => { drawRef.current?.deleteAll(); props.onChange?.(null); }}><Trash2 />Borrar terreno</Button></div>{expanded && <Button variant="secondary" data-close-map onClick={() => setExpanded(false)}>Listo, volver al análisis</Button>}</div>}
    <div className={s.mapShell}><div ref={host} className={s.mapCanvas} data-draw={drawing} data-terrain={props.terrain} data-testid="geo-map" />{error && <div className={s.mapError} role="status">{error}</div>}</div>
    {expanded && <p className={s.mapHelp}>Marca los vértices y cierra el polígono en el primer punto. Puedes ajustar los vértices antes de volver.</p>}
    {!drawing && <button className={s.textButton} onClick={() => { const b = boundsFor(props.aoi || props.clusters); if (b) mapRef.current?.fitBounds(b, { padding: 55, maxZoom: 17, duration: 0 }); }}><Expand size={14} />Centrar en el área de interés</button>}
  </div>;
}
