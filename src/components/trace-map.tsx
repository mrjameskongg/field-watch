// Small satellite map for the public trace page: one dot + approximate area
// circle per contributing farm. Deliberately calm — no scroll zoom, no drag,
// it is an exhibit, not an explorer. Same imperative-leaflet pattern as
// map.tsx (import("leaflet") returns a frozen namespace; no react-leaflet).
//
// Privacy: the edge function already rounds coordinates to ~110 m and never
// ships boundary polygons; the circle is sized from stated hectares, so the
// page shows where the rice grew without publishing anyone's surveyed edges.

import { useEffect, useMemo, useRef } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { EstateMap } from "@/components/estate-map";
import { bboxOf, extrusionHeight, footprint, ndviColor, type ParcelProps } from "@/lib/estate-map-core";

export type TraceFarmPoint = {
  farmer: string;
  village: string | null;
  lat: number;
  lng: number;
  hectares: number | null;
  mapped: boolean;
  ndvi: number | null;
  ndvi_date: string | null;
};


function TraceMapLeaflet({ points }: { points: TraceFarmPoint[] }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!holder.current || points.length === 0) return;
    let disposed = false;
    let map: import("leaflet").Map | null = null;

    (async () => {
      await import("leaflet/dist/leaflet.css");
      const L = (await import("leaflet")).default ?? (await import("leaflet"));
      if (disposed || !holder.current) return;

      map = L.map(holder.current, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        attributionControl: true,
      });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics", maxZoom: 17 },
      ).addTo(map);

      const bounds = L.latLngBounds([]);
      for (const p of points) {
        const color = ndviColor(p.ndvi);
        // area circle: r in metres from hectares (1 ha = 10,000 m²)
        if (p.hectares && p.hectares > 0) {
          L.circle([p.lat, p.lng], {
            radius: Math.sqrt((p.hectares * 10_000) / Math.PI),
            color,
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.18,
          }).addTo(map);
        }
        const dot = L.circleMarker([p.lat, p.lng], {
          radius: 6,
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
        }).addTo(map);
        dot.bindTooltip(`${p.farmer}${p.village ? ` · ${p.village}` : ""}`, {
          direction: "top",
          offset: L.point(0, -6),
        });
        bounds.extend([p.lat, p.lng]);
      }
      map.fitBounds(bounds.pad(0.6), { maxZoom: 14 });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [points]);

  if (points.length === 0) return null;
  return <div ref={holder} className="h-56 w-full rounded-md overflow-hidden border sm:h-64" />;
}

/**
 * Public trace exhibit: the contributing farms as hexagon footprints (the
 * edge function ships rounded points, never surveyed edges) on the 3D
 * estate, extruded by crop vigour. Falls back to the flat Leaflet map where
 * WebGL2 is missing.
 */
export function TraceMap({ points }: { points: TraceFarmPoint[] }) {
  const parcels = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon, ParcelProps>>(
    () => ({
      type: "FeatureCollection",
      features: points.map((p, i) => ({
        type: "Feature",
        geometry: footprint(p.lat, p.lng, p.hectares),
        properties: {
          id: `trace-${i}`,
          name: p.farmer,
          farmer: p.village,
          h: extrusionHeight(p.ndvi),
          c: ndviColor(p.ndvi),
          ndvi: p.ndvi,
          ndviDate: p.ndvi_date,
          state: null,
          waterDate: null,
          ha: p.hectares,
        },
      })),
    }),
    [points],
  );
  if (points.length === 0) return null;
  // Farms scattered more than ~20 km apart would flatten the view into a
  // province map; then the estate itself is the better exhibit.
  const [w, s, e, n] = bboxOf(points.map((p) => [p.lng, p.lat] as [number, number]));
  const spread = Math.max(e - w, n - s) > 0.18;
  return (
    <div className="h-56 w-full overflow-hidden rounded-md border sm:h-72">
      <ClientOnly fallback={<div className="h-full w-full bg-black" />}>
        <EstateMap
          mode="exhibit"
          parcels={parcels}
          fit={spread ? "estate" : "parcels"}
          layers={{ canals: false, roads: false, blocks: false, own: false }}
          className="h-full w-full"
          fallback={<TraceMapLeaflet points={points} />}
        />
      </ClientOnly>
    </div>
  );
}
