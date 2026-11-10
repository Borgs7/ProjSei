import argparse
import datetime as dt
import hashlib
import os
import re
import sys
from pathlib import Path

import openpyxl
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from database import engine  # noqa: E402

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], 1)}

DDL = """
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS survey_files (
    id            SERIAL PRIMARY KEY,
    file_name     TEXT NOT NULL,
    survey_area   TEXT NOT NULL,
    survey_type   TEXT NOT NULL CHECK (survey_type IN ('gravity','magnetic')),
    sha256        TEXT NOT NULL UNIQUE,
    file_bytes    BYTEA NOT NULL,
    row_count     INTEGER,
    imported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gravity_stations (
    id                  SERIAL PRIMARY KEY,
    file_id             INTEGER NOT NULL REFERENCES survey_files(id) ON DELETE CASCADE,
    source_row          INTEGER NOT NULL,          -- spreadsheet row number
    survey_area         TEXT NOT NULL,
    survey_date         DATE,
    day_label           TEXT,                      -- e.g. 'June 20 - Puyog elem school'
    station_label       TEXT NOT NULL,
    is_base             BOOLEAN NOT NULL,
    latitude            NUMERIC NOT NULL,
    longitude           NUMERIC NOT NULL,
    elevation_m         NUMERIC,
    time_decimal_hours  NUMERIC,
    reading_1           NUMERIC,
    reading_2           NUMERIC,
    reading_3           NUMERIC,
    reading_avg_sheet   NUMERIC,                   -- average as written in the sheet
    reading_avg         NUMERIC,                   -- mean of the readings present
    reading_spread      NUMERIC,                   -- max - min of the readings
    base_abs_gravity    NUMERIC,                   -- the day's base absolute gravity
    drift_correction    NUMERIC,
    drift_corrected     NUMERIC,
    theoretical_gravity NUMERIC,
    height_correction   NUMERIC,
    atm_correction      NUMERIC,
    bouguer_cap         NUMERIC,
    observed_abs_gravity NUMERIC,
    simple_ba           NUMERIC,
    terrain_correction  NUMERIC,
    complete_ba         NUMERIC,
    processing_status   TEXT NOT NULL DEFAULT 'provisional',
    flags               TEXT,
    geom                GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS gravity_stations_geom_idx ON gravity_stations USING GIST (geom);
CREATE INDEX IF NOT EXISTS gravity_stations_area_date_idx ON gravity_stations (survey_area, survey_date);

CREATE TABLE IF NOT EXISTS magnetic_stations (
    id                  SERIAL PRIMARY KEY,
    file_id             INTEGER NOT NULL REFERENCES survey_files(id) ON DELETE CASCADE,
    source_row          INTEGER NOT NULL,
    survey_area         TEXT NOT NULL,
    survey_date         DATE,
    day_label           TEXT,
    station_label       TEXT NOT NULL,
    is_base             BOOLEAN NOT NULL,
    latitude            NUMERIC NOT NULL,
    longitude           NUMERIC NOT NULL,
    time_decimal_hours  NUMERIC,
    reading_1           NUMERIC,
    noise_1             NUMERIC,
    reading_2           NUMERIC,
    noise_2             NUMERIC,
    reading_3           NUMERIC,
    noise_3             NUMERIC,
    reading_avg_sheet   NUMERIC,
    reading_avg         NUMERIC,                   -- mean of non-zero readings present
    reading_spread      NUMERIC,
    diurnal_correction  NUMERIC,
    corrected_field     NUMERIC,
    igrf                NUMERIC,
    final_anomaly       NUMERIC,
    processing_status   TEXT NOT NULL DEFAULT 'provisional',
    flags               TEXT,
    raw_notes           TEXT,                      -- original text of any non-numeric cell
    geom                GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS magnetic_stations_geom_idx ON magnetic_stations USING GIST (geom);
CREATE INDEX IF NOT EXISTS magnetic_stations_area_date_idx ON magnetic_stations (survey_area, survey_date);

-- Processed compilations: one value per point, no raw readings (e.g. the
-- Macolod Corridor CSVs: Latitude, Longitude, Bouguer / Magnetic Anomaly).
CREATE TABLE IF NOT EXISTS anomaly_points (
    id                  SERIAL PRIMARY KEY,
    file_id             INTEGER NOT NULL REFERENCES survey_files(id) ON DELETE CASCADE,
    source_row          INTEGER NOT NULL,          -- row number as shown when opened in Excel
    survey_area         TEXT NOT NULL,
    survey_type         TEXT NOT NULL CHECK (survey_type IN ('gravity','magnetic')),
    value_name          TEXT NOT NULL,             -- column heading, e.g. 'Bouguer Anomaly'
    value               NUMERIC NOT NULL,
    latitude            NUMERIC NOT NULL,
    longitude           NUMERIC NOT NULL,
    processing_status   TEXT NOT NULL DEFAULT 'provisional',
    flags               TEXT,
    raw_notes           TEXT,                      -- original text of any cell that was repaired
    geom                GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS anomaly_points_geom_idx ON anomaly_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS anomaly_points_area_type_idx ON anomaly_points (survey_area, survey_type);
"""

# Rough box around the study areas; points outside it are flagged, not dropped.
STUDY_BOX = dict(lat_min=12.9, lat_max=14.35, lon_min=120.7, lon_max=122.6)


# ----------------------------------------------------------------- helpers
def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def clean_label(v):
    return re.sub(r"\s+", " ", str(v)).strip()


def year_from(path):
    m = re.search(r"(20\d\d)", path.name)
    return int(m.group(1)) if m else None


def area_from(path):
    if "macolod" in str(path).lower():
        return "Macolod Corridor"
    for name in ("Batangas", "Marinduque", "Mindoro"):
        if name.lower() in str(path).lower():
            return name
    return "Unknown"


def parse_date(label, default_year):
    """'June 20 - Puyog', '09 January 2026 Sports', 'January 10, 2026', datetime."""
    if isinstance(label, dt.datetime):
        return label.date()
    s = str(label).lower()
    month = next((n for m, n in MONTHS.items() if m in s), None)
    if not month:
        return None
    year = re.search(r"(20\d\d)", s)
    year = int(year.group(1)) if year else default_year
    s_wo_year = re.sub(r"20\d\d", "", s)
    day = re.search(r"\b(\d{1,2})\b", s_wo_year)
    if not (year and day):
        return None
    return dt.date(year, month, int(day.group(1)))


def stats(readings, ignore_zero=False):
    vals = [r for r in readings if r is not None and not (ignore_zero and r == 0)]
    if not vals:
        return None, None
    return sum(vals) / len(vals), max(vals) - min(vals)


def detect_type(ws):
    head = " ".join(str(c) for row in ws.iter_rows(min_row=1, max_row=2, values_only=True)
                    for c in row if c is not None).lower()
    if "noise" in head or "igrf" in head:
        return "magnetic"
    if "bouguer" in head or "drift" in head:
        return "gravity"
    return None


# ----------------------------------------------------------------- parsers
def parse_gravity(ws, path):
    """Two layouts exist: decimal-degrees only (Batangas) and DMS + decimal (Marinduque)."""
    hdr2 = [c for c in next(ws.iter_rows(min_row=2, max_row=2, values_only=True))]
    dms = str(hdr2[1]).strip().lower().startswith("degree")
    if dms:   # Marinduque layout
        C = dict(lat=7, lon=8, hours=11, elev=14, r1=15, r2=16, r3=17, avg=18,
                 dcorr=19, dc=20, base_abs=21, theo=22, height=23, atm=24, cap=25,
                 obs=26, sba=27, tc=28, cba=29)
    else:     # Batangas layout
        C = dict(lat=1, lon=2, hours=5, elev=8, r1=9, r2=10, r3=11, avg=12,
                 dcorr=15, dc=16, base_abs=13, theo=17, height=18, atm=19, cap=20,
                 obs=21, sba=22, tc=23, cba=24)
    year = year_from(path)
    rows, day_label, day_date, base_abs = [], None, None, None
    for i, r in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        r = list(r) + [None] * 40
        if r[0] is None:
            continue
        if num(r[C["lat"]]) is None:          # day header row
            day_label = clean_label(r[0] if not isinstance(r[0], dt.datetime) else r[0].date().isoformat())
            day_date = parse_date(r[0], year)
            base_abs = num(r[C["base_abs"]])
            continue
        readings = [num(r[C["r1"]]), num(r[C["r2"]]), num(r[C["r3"]])]
        avg, spread = stats(readings)
        flags = []
        if spread is not None and spread > 0.05:
            flags.append(f"readings differ by {spread:.3f} (normal is about 0.01); check for a typo")
        label = clean_label(r[0])
        rows.append(dict(
            source_row=i, day_label=day_label, survey_date=day_date, station_label=label,
            is_base="base" in label.lower(), latitude=r[C["lat"]], longitude=r[C["lon"]],
            elevation_m=num(r[C["elev"]]), time_decimal_hours=num(r[C["hours"]]),
            reading_1=readings[0], reading_2=readings[1], reading_3=readings[2],
            reading_avg_sheet=num(r[C["avg"]]), reading_avg=avg, reading_spread=spread,
            base_abs_gravity=base_abs, drift_correction=num(r[C["dcorr"]]),
            drift_corrected=num(r[C["dc"]]), theoretical_gravity=num(r[C["theo"]]),
            height_correction=num(r[C["height"]]), atm_correction=num(r[C["atm"]]),
            bouguer_cap=num(r[C["cap"]]), observed_abs_gravity=num(r[C["obs"]]),
            simple_ba=num(r[C["sba"]]), terrain_correction=num(r[C["tc"]]),
            complete_ba=num(r[C["cba"]]), flags="; ".join(flags) or None))
    return rows


def parse_magnetic(ws, path):
    # Columns H/I are headed 'Northing'/'Easting' but hold decimal latitude/longitude.
    C = dict(lat=7, lon=8, r1=9, n1=10, r2=11, n2=12, r3=13, n3=14, avg=15,
             hh=16, mm=17, diurnal=23, corrected=24, igrf=25, final=26)
    year = year_from(path)
    rows, day_label, day_date = [], None, None
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        r = list(r) + [None] * 40
        if r[0] is None:
            continue
        if num(r[C["lat"]]) is None:          # day header row (also carries column names)
            day_label = clean_label(r[0])
            day_date = parse_date(r[0], year)
            continue
        raw_notes, readings = [], []
        for k in ("r1", "r2", "r3"):
            v = r[C[k]]
            if isinstance(v, str):
                raw_notes.append(f"{k.replace('r', 'reading_')} recorded as '{v}'")
                v = None
            readings.append(num(v))
        avg, spread = stats(readings, ignore_zero=True)
        flags = []
        if raw_notes:
            flags.append("a reading is not a number in the sheet (see raw_notes)")
        if any(x == 0 for x in readings):
            flags.append("one reading is 0 (not taken)")
        sheet_avg = num(r[C["avg"]])
        if sheet_avg is not None and avg is not None and abs(sheet_avg - avg) > 1:
            flags.append(f"sheet average {sheet_avg:.1f} differs from mean of readings {avg:.1f}")
        if spread is not None and spread > 20:
            flags.append(f"readings differ by {spread:.1f} nT")
        hh, mm = num(r[C["hh"]]), num(r[C["mm"]])
        label = clean_label(r[0])
        rows.append(dict(
            source_row=i, day_label=day_label, survey_date=day_date, station_label=label,
            is_base="base" in label.lower(), latitude=r[C["lat"]], longitude=r[C["lon"]],
            time_decimal_hours=(hh + mm / 60) if hh is not None and mm is not None else None,
            reading_1=readings[0], noise_1=num(r[C["n1"]]),
            reading_2=readings[1], noise_2=num(r[C["n2"]]),
            reading_3=readings[2], noise_3=num(r[C["n3"]]),
            reading_avg_sheet=sheet_avg, reading_avg=avg, reading_spread=spread,
            diurnal_correction=num(r[C["diurnal"]]), corrected_field=num(r[C["corrected"]]),
            igrf=num(r[C["igrf"]]), final_anomaly=num(r[C["final"]]),
            flags="; ".join(flags) or None, raw_notes="; ".join(raw_notes) or None))
    return rows


def read_anomaly_csv(path):
    """Returns (kind, value_name, rows) for a Latitude, Longitude, <value> CSV,
    or (None, None, None) if the file is not in that shape."""
    import csv
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = [h.strip() for h in next(reader, [])]
        if len(header) < 3 or header[0].lower() != "latitude" or header[1].lower() != "longitude":
            return None, None, None
        value_name = header[2]
        kind = ("magnetic" if "magnetic" in value_name.lower()
                else "gravity" if ("bouguer" in value_name.lower() or "grav" in value_name.lower())
                else None)
        rows, seen, excel_row = [], {}, 1          # header is row 1
        for cells in reader:
            excel_row += 1                          # a quoted cell with a line break is still one row
            start = excel_row
            if not any(c.strip() for c in cells[:3]):
                continue                                  # blank row
            flags, notes, vals = [], [], []
            for name, c in zip(("latitude", "longitude", "value"), cells[:3]):
                fixed = re.sub(r"[\r\n]+", "", c).strip()
                if fixed != c.strip():
                    notes.append(f"{name} recorded as {c.strip()!r}")
                vals.append(float(fixed))
            lat, lon, value = vals
            if notes:
                flags.append("a line break inside a number was removed (see raw_notes)")
            if not (STUDY_BOX["lat_min"] <= lat <= STUDY_BOX["lat_max"]
                    and STUDY_BOX["lon_min"] <= lon <= STUDY_BOX["lon_max"]):
                flags.append("location is outside the study area; check the coordinates")
            if lat == int(lat):
                flags.append("latitude is a whole number; decimals may be missing")
            key = (round(lat, 7), round(lon, 7), round(value, 7))
            if key in seen:
                flags.append(f"exact duplicate of row {seen[key]}")
            else:
                seen[key] = start
            rows.append(dict(source_row=start, latitude=lat, longitude=lon, value=value,
                             value_name=value_name, flags="; ".join(flags) or None,
                             raw_notes="; ".join(notes) or None))
    return kind, value_name, rows


# ----------------------------------------------------------------- import
def insert_rows(conn, table, file_id, area, rows):
    cols = list(rows[0].keys())
    sql = text(
        f"INSERT INTO {table} (file_id, survey_area, {', '.join(cols)}, geom) "
        f"VALUES (:file_id, :survey_area, {', '.join(':' + c for c in cols)}, "
        f"ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326))")
    conn.execute(sql, [dict(r, file_id=file_id, survey_area=area) for r in rows])


def import_file(conn, path, replace):
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if path.suffix.lower() == ".csv":
        kind, value_name, rows = read_anomaly_csv(path)
        table = "anomaly_points"
    else:
        ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
        kind = detect_type(ws)
        table = f"{kind}_stations"
    if kind is None:
        print(f"  SKIP  {path.name}: not recognised as a gravity or magnetic file")
        return
    area = area_from(path)

    existing = conn.execute(text("SELECT id FROM survey_files WHERE sha256 = :s"), {"s": sha}).scalar()
    same_name = conn.execute(text("SELECT id FROM survey_files WHERE file_name = :n"), {"n": path.name}).scalar()
    if existing and not replace:
        print(f"  SKIP  {path.name}: already imported (use --replace to reload it)")
        return
    if same_name and not existing and not replace:
        print(f"  STOP  {path.name}: a different version of this file is already imported. "
              f"Run again with --replace to swap it in.")
        return
    for old in {existing, same_name} - {None}:
        conn.execute(text("DELETE FROM survey_files WHERE id = :i"), {"i": old})  # cascades to rows

    if table != "anomaly_points":
        rows = parse_gravity(ws, path) if kind == "gravity" else parse_magnetic(ws, path)
    if not rows:
        print(f"  SKIP  {path.name}: no data rows found")
        return
    file_id = conn.execute(text(
        "INSERT INTO survey_files (file_name, survey_area, survey_type, sha256, file_bytes, row_count) "
        "VALUES (:n, :a, :t, :s, :b, :c) RETURNING id"),
        {"n": path.name, "a": area, "t": kind, "s": sha, "b": data, "c": len(rows)}).scalar()
    if table == "anomaly_points":
        for r in rows:
            r["survey_type"] = kind
    insert_rows(conn, table, file_id, area, rows)
    flagged = sum(1 for r in rows if r["flags"])
    if table == "anomaly_points":
        print(f"  OK    {path.name}: {len(rows)} {kind} anomaly points ({value_name}), {area}, {flagged} flagged")
    else:
        dates = sorted({r["survey_date"] for r in rows if r["survey_date"]})
        span = f"{dates[0]} to {dates[-1]}" if dates else "no dates found"
        print(f"  OK    {path.name}: {len(rows)} {kind} rows, {area}, {span}, {flagged} flagged")


def flag_overlaps(conn):
    """Mark compiled magnetic points that repeat a field station already in
    magnetic_stations (same place within ~2 m and same final value)."""
    n = conn.execute(text("""
        UPDATE anomaly_points a
        SET flags = concat_ws('; ', a.flags,
              'same station and value as magnetic_stations id ' || m.id ||
              ' (' || m.survey_area || ', ' || m.survey_date || '); do not count twice')
        FROM magnetic_stations m
        WHERE a.survey_type = 'magnetic'
          AND m.final_anomaly IS NOT NULL
          AND abs(a.latitude - m.latitude) < 0.00002
          AND abs(a.longitude - m.longitude) < 0.00002
          AND abs(a.value - m.final_anomaly) < 0.05
          AND (a.flags IS NULL OR a.flags NOT LIKE '%magnetic_stations id%')
    """)).rowcount
    if n:
        print(f"  NOTE  {n} compiled magnetic points repeat a field station already imported (flagged)")


def main():
    ap = argparse.ArgumentParser(description="Import SeiScanPH gravity/magnetic spreadsheets.")
    ap.add_argument("folder", help="folder containing the .xlsx files")
    ap.add_argument("--replace", action="store_true", help="reload files that are already imported")
    args = ap.parse_args()
    folder = Path(args.folder)
    files = sorted(p for p in folder.rglob("*")
                   if p.suffix.lower() in (".xlsx", ".csv") and not p.name.startswith("~$"))
    if not files:
        sys.exit(f"No .xlsx or .csv files found in {folder}")
    print(f"Found {len(files)} file(s) in {folder}")
    with engine.begin() as conn:            # one transaction: all files or nothing
        ddl = "\n".join(l for l in DDL.splitlines() if not l.strip().startswith("--"))
        for stmt in [s for s in ddl.split(";") if s.strip()]:
            conn.execute(text(stmt))
        for p in files:
            import_file(conn, p, args.replace)
        flag_overlaps(conn)
    print("Done.")


if __name__ == "__main__":
    main()