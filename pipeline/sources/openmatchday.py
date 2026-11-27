"""open-matchday (GitHub, aggiornato ogni giorno): stagione in corso per Serie A,
Premier League, Bundesliga e LaLiga.

Fornisce calendario con giornata, orari, risultato finale e primo tempo, tiri, tiri in porta,
falli, corner (anche per tempo), gialli, rossi e minuti dei gol.
Si leggono SOLO results_*.csv, fixtures_*.csv e goals_*.csv: i file di quote presenti nel
repository (odds_*, over25_*) non vengono mai scaricati.
Orari: convenzione fissa UTC+1 della fonte, convertiti in UTC.
"""
import csv
import io
import json
import os
from datetime import datetime, timedelta, timezone

from .. import config, db
from .common import http_get, to_int, SourceError

INFO = {
    "id": "openmatchday", "name": "open-matchday (GitHub)",
    "url": "https://github.com/oladeeayo/open-matchday",
    "license": "Uso personale non commerciale con attribuzione; dati di football-data.co.uk, fixturedownload, OpenLigaDB, ESPN, FotMob",
    "needs_key": 0, "key_env": "",
    "provides": "Stagione in corso: calendario, risultati, primo tempo, tiri, tiri in porta, falli, corner per tempo, cartellini, minuti dei gol",
    "notes": "Aggiornata ogni giorno. I file di quote del repository sono esclusi per regola.",
}
BASE = os.environ.get("CALCIO_OM_BASE", "https://raw.githubusercontent.com/oladeeayo/open-matchday/master/data")
ALLOWED = ("results", "fixtures", "goals")
STATS = {"shots": "tiri", "target": "tiri_porta", "fouls": "falli", "corners": "corner",
         "corners_1h": "corner_1t", "corners_2h": "corner_2t", "yellow": "gialli", "red": "rossi"}


def _get(folder, kind, code):
    assert kind in ALLOWED, "file non ammesso"
    path = f"{BASE}/{folder}/{kind}_{code}.csv"
    if path.startswith("/"):
        if not os.path.exists(path):
            raise SourceError(f"HTTP 404 su {path}")
        return open(path, encoding="utf-8").read()
    return http_get(path).decode("utf-8")


def _ko(date, time):
    d = datetime.strptime(date, "%Y-%m-%d")
    if time and time.strip():
        hh, mm = time.strip().split(":")[:2]
        loc = d.replace(hour=int(hh), minute=int(mm), tzinfo=timezone(timedelta(hours=1)))
        return loc.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), True
    return d.replace(hour=12, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), False


def fetch(con, cnt, resolver, league, season, log):
    folder = config.LEAGUES[league].get("om")
    if not folder:
        return 0
    code = config.season_code(season)
    n_res = n_fix = 0
    ids = {}
    for kind in ("fixtures", "results"):
        try:
            text = _get(folder, kind, code)
        except SourceError as e:
            if kind == "fixtures" and "404" in str(e):
                continue
            raise
        for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
            if not r.get("home") or not r.get("date"):
                continue
            h = resolver.resolve(league, r["home"], "openmatchday")
            a = resolver.resolve(league, r["away"], "openmatchday")
            for tid in (h, a):
                canon, disp = resolver.names(tid)
                db.upsert_team(con, tid, league, canon, disp)
            ko, tk = _ko(r["date"], r.get("time"))
            fth, fta = to_int(r.get("ft_home")), to_int(r.get("ft_away"))
            mid = db.upsert_match(con, cnt, league=league, season=season, home_id=h, away_id=a,
                                  source="openmatchday", kickoff_utc=ko, time_known=tk,
                                  matchday=to_int(r.get("gw")), fthg=fth, ftag=fta,
                                  hthg=to_int(r.get("ht_home")), htag=to_int(r.get("ht_away")))
            ids[(r["date"], r["home"], r["away"])] = mid
            if kind == "fixtures" or fth is None:
                n_fix += 1
                continue
            n_res += 1
            for col, metric in STATS.items():
                for side, pre in (("H", "home_"), ("A", "away_")):
                    v = to_int(r.get(pre + col))
                    if v is not None:
                        db.upsert_stat(con, cnt, mid, side, h if side == "H" else a, metric, v, "openmatchday")
            mins = [to_int(x) for x in (r.get("goal_minutes") or "").split(",") if x.strip()]
            if mins:
                _save_goals(con, mid, [[m, None] for m in mins if m is not None])
    # attribuzione dei gol alla squadra, dove la fonte la fornisce
    try:
        text = _get(folder, "goals", code)
        by = {}
        for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
            by.setdefault((r["date"], r["home"], r["away"]), []).append(r)
        for key, rows in by.items():
            mid = ids.get(key)
            if not mid:
                continue
            out, ph, pa, ok = [], 0, 0, True
            for r in rows:
                m, sh, sa = to_int(r.get("minute")), to_int(r.get("score_home")), to_int(r.get("score_away"))
                if sh is None or sa is None:
                    ok = False
                    out.append([m, None])
                    continue
                side = "H" if sh > ph else "A" if sa > pa else None
                ph, pa = sh, sa
                out.append([m, side])
            if ok and out:
                _save_goals(con, mid, out)
    except SourceError:
        pass
    log(f"{league} {season}: {n_res} partite giocate con statistiche, {n_fix} in calendario")
    return n_res + n_fix


def _save_goals(con, mid, goals):
    con.execute("INSERT INTO match_goal(match_id, goals, source) VALUES(?,?,?) "
                "ON CONFLICT(match_id) DO UPDATE SET goals=excluded.goals, source=excluded.source",
                (mid, json.dumps(goals), "openmatchday"))
