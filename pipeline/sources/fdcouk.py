"""football-data.co.uk: risultati e statistiche partita in CSV (nessuna chiave).

Fornisce: data/ora (ora inglese), risultato finale e primo tempo, tiri, tiri in porta,
falli, corner, gialli, rossi; arbitro solo per la Premier League.
Le colonne delle quote presenti nei file vengono ignorate (lista bianca).
Lo stesso parser legge il mirror GitHub 'datasets/football-datasets' (stesso formato).
"""
import csv
import io
from datetime import datetime
from zoneinfo import ZoneInfo

from .. import config, db
from .common import http_get, FDCOUK_STATS, FDCOUK_BASE, to_int

INFO = {
    "id": "fdcouk", "name": "football-data.co.uk", "url": "https://www.football-data.co.uk/",
    "license": "Uso libero dei dati con citazione della fonte",
    "needs_key": 0, "key_env": "",
    "provides": "Risultati, primo tempo, tiri, tiri in porta, falli, corner, cartellini; arbitro (solo Premier League)",
    "notes": "Aggiornata di norma 2 volte a settimana. Le colonne delle quote vengono scartate in lettura.",
}
MIRROR_INFO = {
    "id": "mirror", "name": "datasets/football-datasets (GitHub)",
    "url": "https://github.com/datasets/football-datasets",
    "license": "PDDL 1.0 (dati derivati da football-data.co.uk)",
    "needs_key": 0, "key_env": "",
    "provides": "Stesse statistiche di football-data.co.uk, stagioni concluse",
    "notes": "Copia pubblica su GitHub, usata come riserva e per lo storico.",
}
UK = ZoneInfo("Europe/London")
UTC = ZoneInfo("UTC")


def _parse_date(d, t):
    d = d.strip()
    if "-" in d:
        dt = datetime.strptime(d, "%Y-%m-%d")
    else:
        fmt = "%d/%m/%Y" if len(d.split("/")[-1]) == 4 else "%d/%m/%y"
        dt = datetime.strptime(d, fmt)
    if t and t.strip():
        hh, mm = t.strip().split(":")[:2]
        loc = dt.replace(hour=int(hh), minute=int(mm), tzinfo=UK)
        return loc.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), True
    loc = dt.replace(hour=12, tzinfo=UK)
    return loc.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), False


def ingest_csv(con, cnt, resolver, league, season, text, source):
    rdr = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    cols = rdr.fieldnames or []
    ignored = [c for c in cols if c and c not in FDCOUK_STATS and c not in FDCOUK_BASE]
    n = 0
    for r in rdr:
        if not r.get("HomeTeam") or not r.get("Date"):
            continue
        h = resolver.resolve(league, r["HomeTeam"], source)
        a = resolver.resolve(league, r["AwayTeam"], source)
        for tid, nm in ((h, r["HomeTeam"]), (a, r["AwayTeam"])):
            canon, disp = resolver.names(tid)
            db.upsert_team(con, tid, league, canon, disp)
        ko, tk = _parse_date(r["Date"], r.get("Time"))
        fthg, ftag = to_int(r.get("FTHG")), to_int(r.get("FTAG"))
        ref = (r.get("Referee") or "").strip()
        rid = db.upsert_referee(con, ref) if ref else None
        mid = db.upsert_match(con, cnt, league=league, season=season, home_id=h, away_id=a,
                              source=source, kickoff_utc=ko, time_known=tk,
                              fthg=fthg, ftag=ftag, hthg=to_int(r.get("HTHG")),
                              htag=to_int(r.get("HTAG")), referee_id=rid)
        if fthg is None:
            continue
        for col, (side, metric) in FDCOUK_STATS.items():
            v = to_int(r.get(col))
            if v is not None:
                db.upsert_stat(con, cnt, mid, side, h if side == "H" else a, metric, v, source)
        n += 1
    return n, ignored


def fetch(con, cnt, resolver, league, season, log):
    code = config.LEAGUES[league]["fd_couk"]
    url = f"https://www.football-data.co.uk/mmz4281/{config.season_code(season)}/{code}.csv"
    text = http_get(url).decode("latin-1")
    n, ignored = ingest_csv(con, cnt, resolver, league, season, text, "fdcouk")
    log(f"{league} {season}: {n} partite giocate; {len(ignored)} colonne non sportive (quote) scartate")
    return n


def fetch_mirror(con, cnt, resolver, league, season, log):
    name = config.LEAGUES[league]["mirror"]
    url = (f"https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/"
           f"{name}/season-{config.season_code(season)}.csv")
    text = http_get(url).decode("utf-8")
    n, _ = ingest_csv(con, cnt, resolver, league, season, text, "mirror")
    log(f"{league} {season}: {n} partite dal mirror")
    return n
