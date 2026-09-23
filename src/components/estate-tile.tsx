// Dashboard exhibit: the surveyed estate in 3D with the own-block plots,
// orbiting slowly. Not an explorer — it links to /map.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { EstateMap } from "@/components/estate-map";
import { loadGeo } from "@/lib/estate-geo";
import { COLOURS, FLOOR_HEIGHT_M, type ParcelProps } from "@/lib/estate-map-core";
import { useI18n } from "@/lib/i18n";

const EMPTY: GeoJSON.FeatureCollection<GeoJSON.Polygon, ParcelProps> = { type: "FeatureCollection", features: [] };

export function EstateTile({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const [parcels, setParcels] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    loadGeo("own-plots").then((fc) => {
      if (cancelled || !fc) return;
      setParcels({
        type: "FeatureCollection",
        features: fc.features
          .filter((f) => f.geometry.type === "Polygon")
          .map((f) => ({
            type: "Feature",
            geometry: f.geometry as GeoJSON.Polygon,
            properties: {
              id: String(f.properties?.code ?? ""),
              name: String(f.properties?.name ?? ""),
              farmer: "BRM Agro (own block)",
              h: FLOOR_HEIGHT_M * 2,
              c: COLOURS.healthy,
              ndvi: null,
              ndviDate: null,
              state: null,
              waterDate: null,
              ha: typeof f.properties?.area_ha === "number" ? f.properties.area_ha : null,
            },
          })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`relative overflow-hidden rounded-md border bg-black ${className}`}>
      <ClientOnly fallback={<div className="h-full w-full" />}>
        <EstateMap mode="exhibit" parcels={parcels} fit="estate" layers={{ canals: true, roads: true, blocks: false, own: true }} className="h-full w-full" />
      </ClientOnly>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <span className="tag bg-black/60 text-primary">{t("dash.estateTile")}</span>
      </div>
      <Link
        to="/map"
        className="num absolute bottom-3 right-3 rounded-sm border border-primary/40 bg-black/70 px-2 py-1 text-[11px] uppercase tracking-wide text-primary hover:bg-black/90"
      >
        {t("dash.openMap")} →
      </Link>
    </div>
  );
}
