#!/usr/bin/env python3
"""The estate survey KML (last update 07.04.24) -> GeoJSON layers under public/geo/.

Run from the repo root:
  python3 scripts/kml-to-geojson.py docs/geo-src/A_tul_lngeang_last_update07.04.24.kml docs/geo-src/kpt.kml

Layers written (one per surveyed layer):
  estate.geojson     the 1,273 ha lease boundary (largest top-level polygon)
  blocks.geojson     every other surveyed block: NW block, Prom, Ta Top, KPT blocks
  canals.geojson     335 irrigation channel segments (L_kompongtom)
  roads.geojson      Length (main + secondary roads) and Rord (farm roads)
  own-plots.geojson  47 estate-operated rice plots, coded FRM-BRM-OWN-NN
Stdlib only, deterministic, safe to re-run.
"""
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

K = "{http://www.opengis.net/kml/2.2}"
R = 6371000.0


def coords(el):
    txt = el.find(".//" + K + "coordinates").text
    out = []
    for tok in txt.split():
        lon, lat = tok.split(",")[:2]
        out.append([round(float(lon), 7), round(float(lat), 7)])
    return out


def area_ha(ring):
    lat0 = sum(p[1] for p in ring) / len(ring)
    xs = [(p[0] * math.pi / 180) * R * math.cos(lat0 * math.pi / 180) for p in ring]
    ys = [(p[1] * math.pi / 180) * R for p in ring]
    n = len(ring)
    a = sum(xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i] for i in range(n))
    return round(abs(a) / 2 / 10000, 3)


def centroid(ring):
    # Area-weighted (shoelace) centroid so odd shapes do not drift outside.
    n = len(ring)
    a = cx = cy = 0.0
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if abs(a) < 1e-12:
        return [round(sum(p[1] for p in ring) / n, 6), round(sum(p[0] for p in ring) / n, 6)]
    a *= 0.5
    return [round(cy / (6 * a), 6), round(cx / (6 * a), 6)]  # [lat, lon]


def close(ring):
    return ring if ring[0] == ring[-1] else ring + [ring[0]]


def feature(geom, props):
    return {"type": "Feature", "properties": props, "geometry": geom}


def docs_named(root, name):
    return [d for d in root.iter(K + "Document") if (d.findtext(K + "name") or "") == name]


def polygons(root, doc_name):
    out = []
    for doc in docs_named(root, doc_name):
        for pm in doc.iter(K + "Placemark"):
            for g in pm.iter(K + "Polygon"):
                out.append(close(coords(g)))
    return out


def lines(root, doc_name):
    out = []
    for doc in docs_named(root, doc_name):
        for pm in doc.iter(K + "Placemark"):
            name = ""
            for sd in pm.iter(K + "SimpleData"):
                if sd.get("name") == "Name":
                    name = sd.text or ""
            for g in pm.iter(K + "LineString"):
                out.append((coords(g), name))
    return out


def main(estate_kml, kpt_kml):
    est = ET.parse(estate_kml).getroot()
    kpt = ET.parse(kpt_kml).getroot()
    outdir = Path("public/geo")
    outdir.mkdir(parents=True, exist_ok=True)

    # Top-level placemarks of the A_tul_lngeang folder: the lease + the NW block.
    folder = next(f for f in est.iter(K + "Folder") if (f.findtext(K + "name") or "") == "A_tul_lngeang")
    top = [close(coords(g)) for pm in folder if pm.tag == K + "Placemark" for g in pm.iter(K + "Polygon")]
    top.sort(key=area_ha, reverse=True)
    estate_ring = top[0]
    estate = feature(
        {"type": "Polygon", "coordinates": [estate_ring]},
        {"name": "BRM Agro estate", "surveyed": "2024-04-07", "area_ha": area_ha(estate_ring), "centroid": centroid(estate_ring)},
    )
    blocks = [feature({"type": "Polygon", "coordinates": [r]}, {"name": "North-west block", "area_ha": area_ha(r)}) for r in top[1:]]
    blocks += [feature({"type": "Polygon", "coordinates": [r]}, {"name": "Prom", "area_ha": area_ha(r)}) for r in polygons(est, "Prom.shp")]
    blocks += [feature({"type": "Polygon", "coordinates": [r]}, {"name": f"Ta Top {i + 1}", "area_ha": area_ha(r)}) for i, r in enumerate(polygons(est, "tatob"))]
    blocks += [feature({"type": "Polygon", "coordinates": [r]}, {"name": f"KPT block {i + 1}", "area_ha": area_ha(r)}) for i, r in enumerate(polygons(kpt, "Area_all KPT.shp"))]

    canals = [feature({"type": "LineString", "coordinates": c}, {"kind": "canal"}) for c, _ in lines(kpt, "L_kompongtom.shp")]
    roads = [
        feature({"type": "LineString", "coordinates": c}, {"kind": "road", "name": n, "main": len(c) > 100})
        for c, n in lines(kpt, "Length.shp")
    ]
    roads += [feature({"type": "LineString", "coordinates": c}, {"kind": "farm-road"}) for c, _ in lines(kpt, "Rord.shp")]

    plots = []
    for i, r in enumerate(polygons(kpt, "rice.shp")):
        ha = area_ha(r)
        plots.append(
            feature(
                {"type": "Polygon", "coordinates": [r]},
                {"code": f"FRM-BRM-OWN-{i + 1:02d}", "name": f"Own plot {i + 1:02d} · {ha:.1f} ha", "area_ha": ha, "centroid": centroid(r)},
            )
        )

    def write(name, feats):
        (outdir / name).write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")) + "\n")
        ha = round(sum(f["properties"].get("area_ha", 0) for f in feats), 1)
        print(f"{name}: {len(feats)} features, {ha} ha")

    write("estate.geojson", [estate])
    write("blocks.geojson", blocks)
    write("canals.geojson", canals)
    write("roads.geojson", roads)
    write("own-plots.geojson", plots)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
