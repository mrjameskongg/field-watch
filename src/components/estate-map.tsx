// 3D estate map — MapLibre GL over free terrain (AWS Terrarium) and Esri
// imagery, with the surveyed estate layers underneath and parcels extruded
// by crop vigour or coloured by radar water state. Imperative wrapper: the
// caller passes plain props (already-built GeoJSON) and this never queries.
//
// Modes: "explore" orbits until the first pointer/wheel/touch, then hands
// over; "exhibit" orbits forever and takes no input (dashboard tile, /trace).
// No text layers — a glyph server would be an external dependency — so
// labels are HTML popups and the caller's side list.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Map as MLMap, MapLayerMouseEvent, Popup as MLPopup } from "maplibre-gl";
import { ESTATE_BBOX, loadGeo } from "@/lib/estate-geo";
import { bboxOf, featureCenter, orbitBearing, type ParcelProps } from "@/lib/estate-map-core";

export type HotspotLite = { latitude: number; longitude: number; frp?: number; acq_date?: string };

export type EstateMapProps = {
  mode: "explore" | "exhibit";
  parcels: GeoJSON.FeatureCollection<GeoJSON.Polygon, ParcelProps>;
  hotspots?: HotspotLite[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  layers?: { canals?: boolean; roads?: boolean; blocks?: boolean; own?: boolean };
  /** Fit the initial view to the parcels (default) or to the whole estate. */
  fit?: "parcels" | "estate";
  className?: string;
  /** Rendered when WebGL2 is unavailable. */
  fallback?: ReactNode;
};

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function EstateMap({ mode, parcels, hotspots = [], selectedId, onSelect, layers, fit = "parcels", className = "", fallback }: EstateMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<MLPopup | null>(null);
  const orbitRef = useRef<{ raf: number; t0: number; stopped: boolean }>({ raf: 0, t0: 0, stopped: false });
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Mount once.
  useEffect(() => {
    if (!holder.current) return;
    if (!hasWebGL2()) {
      setUnsupported(true);
      return;
    }
    let disposed = false;

    (async () => {
      await import("maplibre-gl/dist/maplibre-gl.css");
      const maplibregl = await import("maplibre-gl");
      if (disposed || !holder.current) return;

      const map = new maplibregl.Map({
        container: holder.current,
        attributionControl: false,
        interactive: mode === "explore",
        maxPitch: 75,
        canvasContextAttributes: { antialias: true },
        center: [104.9147, 12.5591],
        zoom: 12.5,
        pitch: 60,
        bearing: 20,
        style: {
          version: 8,
          sources: {
            imagery: { type: "raster", tiles: [IMAGERY], tileSize: 256, maxzoom: 17, attribution: "Esri, Maxar, Earthstar Geographics" },
            dem: { type: "raster-dem", tiles: [TERRARIUM], tileSize: 256, encoding: "terrarium", maxzoom: 15 },
            parcels: { type: "geojson", data: EMPTY },
            hotspots: { type: "geojson", data: EMPTY },
            estate: { type: "geojson", data: EMPTY },
            blocks: { type: "geojson", data: EMPTY },
            canals: { type: "geojson", data: EMPTY },
            roads: { type: "geojson", data: EMPTY },
            own: { type: "geojson", data: EMPTY },
          },
          layers: [
            { id: "imagery", type: "raster", source: "imagery", paint: { "raster-saturation": -0.15, "raster-contrast": 0.05 } },
            { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.3, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#2f3f2f" } },
            { id: "own-fill", type: "fill", source: "own", paint: { "fill-color": "#4ade80", "fill-opacity": 0.1 } },
            { id: "canals", type: "line", source: "canals", paint: { "line-color": "#7dd3fc", "line-width": 0.8, "line-opacity": 0.55 } },
            { id: "roads", type: "line", source: "roads", paint: { "line-color": "#e7e5e4", "line-width": ["case", ["==", ["get", "main"], true], 1.6, 0.7], "line-opacity": 0.55 } },
            { id: "blocks", type: "line", source: "blocks", paint: { "line-color": "#4ade80", "line-width": 1, "line-opacity": 0.4, "line-dasharray": [2, 2] } },
            { id: "estate-glow", type: "line", source: "estate", paint: { "line-color": "#4ade80", "line-width": 7, "line-blur": 4, "line-opacity": 0.35 } },
            { id: "estate-line", type: "line", source: "estate", paint: { "line-color": "#86efac", "line-width": 1.6, "line-opacity": 0.95 } },
            {
              id: "parcels-3d", type: "fill-extrusion", source: "parcels",
              paint: { "fill-extrusion-color": ["get", "c"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.82, "fill-extrusion-vertical-gradient": true },
            },
            { id: "parcels-outline", type: "line", source: "parcels", paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.35 } },
            { id: "parcels-selected", type: "line", source: "parcels", filter: ["==", ["get", "id"], "__none__"], paint: { "line-color": "#ffffff", "line-width": 2.2, "line-opacity": 0.95 } },
            { id: "hotspots-glow", type: "circle", source: "hotspots", paint: { "circle-color": "#fb923c", "circle-radius": 14, "circle-blur": 1, "circle-opacity": 0.45 } },
            { id: "hotspots", type: "circle", source: "hotspots", paint: { "circle-color": "#fdba74", "circle-radius": 5, "circle-stroke-color": "#7c2d12", "circle-stroke-width": 1.5 } },
          ],
          terrain: { source: "dem", exaggeration: 1.5 },
          sky: {
            "sky-color": "#0b1410",
            "horizon-color": "#1c2f24",
            "fog-color": "#0b1410",
            "sky-horizon-blend": 0.7,
            "horizon-fog-blend": 0.8,
            "fog-ground-blend": 0.65,
            "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 8, 1, 14, 0.4],
          },
        },
      });
      mapRef.current = map;
      if (import.meta.env.DEV) {
        (holder.current as HTMLDivElement & { __map?: MLMap }).__map = map;
        const w = window as Window & { __fwMaps?: number };
        w.__fwMaps = (w.__fwMaps ?? 0) + 1;
      }
      map.on("error", (e) => console.error("[estate-map]", e.error?.message ?? e));
      // Containers that are laid out after mount (grid cells, absolute fills) need a resize nudge.
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
      ro?.observe(holder.current);
      map.once("remove", () => ro?.disconnect());

      map.on("load", async () => {
        if (disposed) return;
        const [estate, blocks, canals, roads, own] = await Promise.all([
          loadGeo("estate"), loadGeo("blocks"), loadGeo("canals"), loadGeo("roads"), loadGeo("own-plots"),
        ]);
        if (disposed) return;
        const set = (id: string, data: GeoJSON.FeatureCollection | null) => {
          const src = map.getSource(id) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined;
          if (src && data) src.setData(data);
        };
        set("estate", estate); set("blocks", blocks); set("canals", canals); set("roads", roads); set("own", own);

        if (mode === "explore") {
          map.on("click", "parcels-3d", (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f) return;
            const p = f.properties as unknown as ParcelProps;
            const html =
              `<div class="fw-popup-title">${p.name}</div>` +
              (p.farmer ? `<div class="fw-popup-sub">${p.farmer}</div>` : "") +
              `<div class="fw-popup-row">${p.ndvi !== null && p.ndvi !== undefined ? `vigour ${Number(p.ndvi).toFixed(2)} · ${p.ndviDate ?? ""}` : "no optical reading"}</div>` +
              `<div class="fw-popup-row">${p.state ? `radar ${p.state} · ${p.waterDate ?? ""}` : "no radar pass"}</div>` +
              (p.ha ? `<div class="fw-popup-row">${p.ha} ha</div>` : "");
            popupRef.current?.remove();
            popupRef.current = new maplibregl.Popup({ closeButton: false, className: "fw-popup", offset: 12 }).setLngLat(e.lngLat).setHTML(html).addTo(map);
            onSelectRef.current?.(p.id);
          });
          map.on("mouseenter", "parcels-3d", () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "parcels-3d", () => { map.getCanvas().style.cursor = ""; });
          const stop = () => { orbitRef.current.stopped = true; };
          for (const ev of ["mousedown", "wheel", "touchstart", "dragstart"] as const) map.on(ev, stop);
          map.getCanvas().addEventListener("keydown", stop);
        }
        setReady(true);
      });
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(orbitRef.current.raf);
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data + initial fit.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("parcels") as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined)?.setData(parcels);
    if (!fitted.current) {
      const coords: [number, number][] = [];
      if (fit === "parcels") for (const f of parcels.features) coords.push(...(f.geometry.coordinates[0] as [number, number][]));
      const bbox = coords.length >= 3 ? bboxOf(coords) : ESTATE_BBOX;
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: mode === "exhibit" ? 10 : 40, pitch: 60, bearing: 20, duration: 0, maxZoom: 15.5 });
      fitted.current = true;
      // Orbit
      const o = orbitRef.current;
      o.t0 = performance.now();
      const tick = () => {
        if (!mapRef.current || o.stopped) return;
        mapRef.current.setBearing(orbitBearing(performance.now() - o.t0));
        o.raf = requestAnimationFrame(tick);
      };
      o.raf = requestAnimationFrame(tick);
    }
  }, [parcels, ready, fit, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: hotspots.map((h) => ({ type: "Feature", geometry: { type: "Point", coordinates: [h.longitude, h.latitude] }, properties: { frp: h.frp ?? null, date: h.acq_date ?? null } })),
    };
    (map.getSource("hotspots") as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined)?.setData(fc);
  }, [hotspots, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("canals", layers?.canals ?? true);
    vis("roads", layers?.roads ?? true);
    vis("blocks", layers?.blocks ?? true);
    vis("own-fill", layers?.own ?? true);
  }, [layers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("parcels-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);
    if (!selectedId) return;
    const f = parcels.features.find((x) => x.properties.id === selectedId);
    if (!f) return;
    orbitRef.current.stopped = true;
    map.flyTo({ center: featureCenter(f.geometry), zoom: 15.5, pitch: 60, duration: 2000, essential: true });
  }, [selectedId, ready, parcels]);

  if (unsupported) return <div className={className}>{fallback ?? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">3D map needs WebGL2.</div>}</div>;
  // MapLibre's stylesheet sets `.maplibregl-map { position: relative }` and loads after ours,
  // so callers must size this box explicitly (h-*/w-*), never with absolute inset.
  return <div ref={holder} className={`relative bg-black ${className}`} />;
}
