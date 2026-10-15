#!/usr/bin/env python3
"""Convierte un DXF (exportado del DWG de Salcedo) a GeoJSON WGS84 para la capa base del mapa.

Requisitos:  pip install ezdxf pyproj

Uso:
  python dxf-to-geojson.py plano.dxf --inspect
  python dxf-to-geojson.py plano.dxf --layers CALLES MANZANAS --epsg 32719 \
      --out ../../client/public/data/salcedo-base.geojson
  # Grilla local en metros con origen conocido (plano de Salcedo): E = x + 390535, N = y + 8241169.3
  python dxf-to-geojson.py plano.dxf --layers Manzana_Comercial --offset 390535,8241169.3
  # Correccion fina contra las calles de OSM (rotar 'rot' grados alrededor de cx,cy y desplazar dx,dy metros)
  python dxf-to-geojson.py plano.dxf --layers Manzana_Comercial --offset 390535,8241169.3       --adjust=-10.27,12.05,-0.136,2955.8,3682.6
  # DXF en coordenadas locales: 2 o mas puntos de control "x,y,lng,lat"
  python dxf-to-geojson.py plano.dxf --layers CALLES --control 100,200,-70.589,-15.899 --control 400,250,-70.585,-15.897
"""
import argparse
import json
import math
import sys
from collections import Counter

import ezdxf

GEOMETRY_TYPES = {"LWPOLYLINE", "POLYLINE", "LINE", "HATCH"}


def entity_rings(entity):
    """Devuelve (lista de puntos [(x, y)], cerrado) para una entidad soportada."""
    kind = entity.dxftype()
    if kind == "LINE":
        return [[(entity.dxf.start.x, entity.dxf.start.y), (entity.dxf.end.x, entity.dxf.end.y)]], False
    if kind == "LWPOLYLINE":
        return [[(p[0], p[1]) for p in entity.get_points()]], bool(entity.closed)
    if kind == "POLYLINE":
        return [[(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]], bool(entity.is_closed)
    if kind == "HATCH":
        rings = []
        for path in entity.paths:
            if hasattr(path, "vertices"):
                rings.append([(v[0], v[1]) for v in path.vertices])
        return rings, True
    return [], False


def build_transform(args):
    if args.control:
        pts = [tuple(float(v) for v in c.split(",")) for c in args.control]
        if len(pts) < 2:
            sys.exit("--control necesita al menos 2 puntos x,y,lng,lat")
        # Similaridad 2D (escala + rotacion + traslacion) por minimos cuadrados con numeros complejos.
        src = [complex(x, y) for x, y, _, _ in pts]
        dst = [complex(lng, lat) for _, _, lng, lat in pts]
        n = len(pts)
        sm, dm = sum(src) / n, sum(dst) / n
        num = sum((d - dm) * (s - sm).conjugate() for s, d in zip(src, dst))
        den = sum(abs(s - sm) ** 2 for s in src)
        a = num / den
        return lambda x, y: (lambda z: (z.real, z.imag))(a * (complex(x, y) - sm) + dm)
    from pyproj import Transformer

    tr = Transformer.from_crs(f"EPSG:{args.epsg}", "EPSG:4326", always_xy=True)
    return lambda x, y: tr.transform(x, y)


def build_adjust(spec):
    if not spec:
        return lambda x, y: (x, y)
    ddx, ddy, rot, cx, cy = (float(v) for v in spec.split(","))
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return lambda x, y: (c * (x - cx) - s * (y - cy) + cx + ddx, s * (x - cx) + c * (y - cy) + cy + ddy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dxf")
    ap.add_argument("--inspect", action="store_true", help="lista capas y cantidad de entidades")
    ap.add_argument("--layers", nargs="*", default=[])
    ap.add_argument("--epsg", type=int, default=32719, help="CRS del DXF (UTM 19S por defecto)")
    ap.add_argument("--offset", help="dx,dy a sumar a las coordenadas del DXF antes de reproyectar (grilla local)")
    ap.add_argument("--adjust", help="dx,dy,rot,cx,cy: rota rot grados alrededor de (cx,cy) y desplaza (dx,dy), en unidades del DXF")
    ap.add_argument("--control", action="append", help="x,y,lng,lat (repetible)")
    ap.add_argument("--out", default="salcedo-base.geojson")
    ap.add_argument("--simplify", type=float, default=0.3, help="tolerancia en unidades del DXF")
    args = ap.parse_args()

    msp = ezdxf.readfile(args.dxf).modelspace()

    if args.inspect:
        counts = Counter((e.dxf.layer, e.dxftype()) for e in msp)
        for (layer, kind), n in sorted(counts.items()):
            print(f"{layer:30s} {kind:12s} {n}")
        return

    if not args.layers:
        sys.exit("indica --layers (usa --inspect para verlas)")
    wanted = set(args.layers)
    base_transform = build_transform(args)
    dx, dy = (float(v) for v in args.offset.split(",")) if args.offset else (0.0, 0.0)
    adjust = build_adjust(args.adjust)
    to_wgs = lambda x, y: (lambda ax, ay: base_transform(ax + dx, ay + dy))(*adjust(x, y))
    features = []
    for e in msp:
        if e.dxf.layer not in wanted or e.dxftype() not in GEOMETRY_TYPES:
            continue
        rings, closed = entity_rings(e)
        for ring in rings:
            if len(ring) < 2:
                continue
            coords = [[round(c, 5) for c in to_wgs(x, y)] for x, y in ring]
            if closed and len(ring) >= 3:
                if coords[0] != coords[-1]:
                    coords.append(coords[0])
                geom = {"type": "Polygon", "coordinates": [coords]}
            else:
                geom = {"type": "LineString", "coordinates": coords}
            features.append({"type": "Feature", "properties": {"capa": e.dxf.layer}, "geometry": geom})

    with open(args.out, "w", encoding="utf8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, separators=(",", ":"))
    print(f"{len(features)} entidades -> {args.out}")


if __name__ == "__main__":
    main()
