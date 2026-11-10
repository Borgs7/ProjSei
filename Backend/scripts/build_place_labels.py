"""
Build the place-name points used by the hazard map's zoom-based labels.

Usage:
    cd SEISCAN_1/Backend
    python scripts/build_place_labels.py                 # downloads the pinned release
    python scripts/build_place_labels.py --zip path/to/geojson-lowres.zip

What it does:
    1. Downloads PSA PSGC boundaries (low resolution) from
       github.com/faeldon/philippines-json-maps, release RELEASE below (MIT licence),
       and checks the file's SHA-256 against the release's published checksum.
    2. Reads provinces (regions/ files, level 2) and cities + municipalities
       (provdists/ files, level 3). Skips the NCR districts, the Special Geographic
       Area and Isabela City's "Not a Province" entry, which are not provinces.
    3. Puts one point per place at the polygon's pole of inaccessibility
       (shapely polylabel; for multipolygons, the largest polygon), so each label
       sits inside its area.
    4. Tidies names ("City of Calapan" -> "Calapan City", "City of Manila" -> "Manila",
       " De "/" Del " -> " de "/" del ") and classifies each place by importance.
    5. Writes Frontend/data/place_labels.geojson, most important places first.

Kinds (the zoom range for each is set in Frontend/js/place-labels.js):
    major     Manila, Cebu City, Davao City
    province  provinces
    huc       highly urbanized + independent component cities outside Metro Manila
    ncr       other Metro Manila cities
    city      all other cities
    mun       municipalities (including Pateros)

Requires:
    pip install shapely
    (certifi is used for the HTTPS download when installed)
"""
import argparse
import hashlib
import json
import ssl
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import polylabel
from shapely.validation import make_valid

RELEASE = 'v1.1.1'   # PSGC 2026, 3rd quarter
ZIP_URL = f'https://github.com/faeldon/philippines-json-maps/releases/download/{RELEASE}/geojson-lowres.zip'
ZIP_SHA256 = 'a98f5a29bebac0708526d08d9452bbbe90b4bf72d28cb53e6535664e28e26086'

OUT_PATH = Path(__file__).resolve().parents[2] / 'Frontend' / 'data' / 'place_labels.geojson'

NCR_REGION = 1300000000
MAJOR_CITIES = {1380600000, 730600000, 1130700000}          # Manila, Cebu City, Davao City
# Independent component cities: they keep their province's PSGC code, so list them explicitly
ICC_CODES = {
    203135000,    # Santiago (Isabela)
    501724000,    # Naga (Camarines Sur) — not the City of Naga in Cebu (702234000)
    803738000,    # Ormoc (Leyte)
    105518000,    # Dagupan (Pangasinan)
    1908703000,   # Cotabato City
}
KIND_ORDER = ['major', 'province', 'huc', 'ncr', 'city', 'mun']

# Sanity checks against the official counts (PSGC 2026-3Q)
EXPECTED = {'province': 82, 'huc_total': 33, 'huc_ncr': 16, 'icc': 5, 'major': 3}


def download(url, path):
    """HTTPS download with certificate checking. Uses certifi's CA bundle when installed
    (some Windows Python builds can't verify GitHub's certificate on their own)."""
    print(f'Downloading {url} ...')
    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(url, context=context, timeout=120) as response:
            path.write_bytes(response.read())
    except urllib.error.URLError as err:
        sys.exit(f'Download failed ({err.reason}).\n'
                 f'Download it yourself, then pass it with --zip:\n'
                 f'  curl -L -o geojson-lowres.zip {url}\n'
                 f'  python scripts/build_place_labels.py --zip geojson-lowres.zip')


def get_zip(path_arg):
    """Use the given zip, or download the pinned release; verify its checksum either way."""
    if path_arg:
        path = Path(path_arg)
    else:
        path = Path(tempfile.gettempdir()) / f'philippines-json-maps-{RELEASE}-geojson-lowres.zip'
        if not path.exists():
            download(ZIP_URL, path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != ZIP_SHA256:
        sys.exit(f'Checksum mismatch for {path}\n  expected {ZIP_SHA256}\n  got      {digest}')
    return zipfile.ZipFile(path)


def read_features(zf, folder):
    features = []
    for name in sorted(zf.namelist()):
        if name.startswith(folder) and name.endswith('.json'):
            features += json.loads(zf.read(name))['features']
    return features


def tidy_name(name):
    name = name.strip()
    if name == 'City of Manila':
        return 'Manila'
    if name.startswith('City of '):
        name = name[len('City of '):] + ' City'
    return name.replace(' De ', ' de ').replace(' Del ', ' del ')


def largest_polygon(geom):
    """The biggest polygon in a (possibly invalid or multi-part) geometry."""
    if not geom.is_valid:
        geom = make_valid(geom)
    if isinstance(geom, Polygon):
        return geom
    parts = [g for g in getattr(geom, 'geoms', []) if isinstance(g, (Polygon, MultiPolygon))]
    polys = [p for g in parts for p in (g.geoms if isinstance(g, MultiPolygon) else [g])]
    return max(polys, key=lambda p: p.area) if polys else None


def label_point(geometry):
    """Pole of inaccessibility of the largest polygon (falls back to a point inside it)."""
    poly = largest_polygon(shape(geometry))
    if poly is None:
        return None
    point = polylabel(poly, tolerance=0.001)          # ~100 m
    if not poly.contains(point):
        point = poly.representative_point()
    return round(point.x, 4), round(point.y, 4)


def is_huc(props):
    """Highly urbanized cities have their own PSGC 'province' digits (e.g. Cebu City 07 306…)."""
    own = f'{props["adm3_psgc"]:010d}'[2:5]
    parent = f'{props["adm2_psgc"]:010d}'[2:5]
    return props['geo_level'] == 'City' and own != parent


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    parser.add_argument('--zip', help='path to an already-downloaded geojson-lowres.zip')
    args = parser.parse_args()

    zf = get_zip(args.zip)
    places, skipped = [], []
    counts = {'huc_total': 0, 'huc_ncr': 0, 'icc': 0}

    # ---- Provinces (level 2) ----
    for f in read_features(zf, 'geojson/regions/lowres'):
        p = f['properties']
        if p['geo_level'] != 'Prov':                  # NCR districts, SGA, Isabela City entry
            skipped.append(p['adm2_en'])
            continue
        places.append({'name': tidy_name(p['adm2_en']), 'kind': 'province',
                       'psgc': f'{p["adm2_psgc"]:010d}', 'area': p['area_km2'],
                       'geometry': f['geometry']})

    # ---- Cities and municipalities (level 3) ----
    for f in read_features(zf, 'geojson/provdists/lowres'):
        p = f['properties']
        code = p['adm3_psgc']
        in_ncr = p['adm1_psgc'] == NCR_REGION
        huc = is_huc(p)
        counts['huc_total'] += huc
        counts['huc_ncr'] += huc and in_ncr
        counts['icc'] += code in ICC_CODES

        if code in MAJOR_CITIES:
            kind = 'major'
        elif p['geo_level'] != 'City':
            kind = 'mun'
        elif in_ncr:
            kind = 'ncr'
        elif huc or code in ICC_CODES:
            kind = 'huc'
        else:
            kind = 'city'
        places.append({'name': tidy_name(p['adm3_en']), 'kind': kind,
                       'psgc': f'{code:010d}', 'area': p['area_km2'],
                       'geometry': f['geometry']})

    # ---- Sanity checks ----
    by_kind = {k: sum(pl['kind'] == k for pl in places) for k in KIND_ORDER}
    found = {'province': by_kind['province'], 'major': by_kind['major'], **counts}
    problems = [f'{k}: expected {v}, found {found[k]}' for k, v in EXPECTED.items() if found[k] != v]
    if problems:
        sys.exit('Classification check failed — has the PSGC data changed?\n  ' + '\n  '.join(problems))

    # ---- Points + output (most important first; larger areas first within a kind) ----
    places.sort(key=lambda pl: (KIND_ORDER.index(pl['kind']), -pl['area'], pl['name']))
    features = []
    for pl in places:
        xy = label_point(pl['geometry'])
        if xy is None:
            print(f'  ! no polygon for {pl["name"]} — skipped')
            continue
        features.append({'type': 'Feature',
                         'properties': {'name': pl['name'], 'kind': pl['kind'], 'psgc': pl['psgc']},
                         'geometry': {'type': 'Point', 'coordinates': list(xy)}})

    header = {
        'type': 'FeatureCollection',
        'source': f'PSA PSGC boundaries (2026-3Q) via github.com/faeldon/philippines-json-maps '
                  f'{RELEASE} (MIT licence). Points are poles of inaccessibility.',
    }
    # One feature per line keeps git diffs readable
    body = ',\n'.join(json.dumps(f, ensure_ascii=False, separators=(',', ':')) for f in features)
    head = json.dumps(header, ensure_ascii=False, separators=(',', ':'))[:-1]
    OUT_PATH.write_text(f'{head},"features":[\n{body}\n]}}\n', encoding='utf-8')

    print(f'Skipped (not provinces): {", ".join(skipped)}')
    print('Places by kind: ' + ', '.join(f'{k} {by_kind[k]}' for k in KIND_ORDER))
    print(f'Checks passed: {counts["huc_total"]} HUCs ({counts["huc_ncr"]} in NCR), {counts["icc"]} ICCs')
    print(f'Wrote {len(features)} places -> {OUT_PATH} ({OUT_PATH.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
