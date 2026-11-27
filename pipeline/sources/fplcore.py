"""FPL-Core-Insights (GitHub, aggiornato due volte al giorno): Premier League.

Statistiche dettagliate di squadra e di giocatore per ogni partita (origine FotMob e API
ufficiale Fantasy Premier League): possesso, xG, grandi occasioni, passaggi, cross, contrasti,
intercetti, duelli, dribbling, falli subiti e commessi, parate e molto altro.

Regola sui vuoti: in una partita, se un campo e' valorizzato per almeno un giocatore,
il vuoto vale zero per chi ha giocato; se e' vuoto per tutti, il dato manca.
"""
import csv
import io
import os
import urllib.parse

from .. import config, db
from ..teams import slug
from .common import http_get, SourceError

INFO = {
    "id": "fplcore", "name": "FPL-Core-Insights (GitHub)",
    "url": "https://github.com/olbauday/FPL-Core-Insights",
    "license": "Uso libero con citazione della fonte; statistiche di origine FotMob e Fantasy Premier League",
    "needs_key": 0, "key_env": "",
    "provides": "Premier League: statistiche avanzate di squadra e di ogni giocatore per partita (xG, grandi occasioni, passaggi, cross, contrasti, intercetti, duelli, dribbling, falli subiti e commessi, cartellini)",
    "notes": "Solo Premier League. Aggiornata due volte al giorno.",
}
BASE = os.environ.get("CALCIO_FPLC_BASE", "https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data")
POS = {"Goalkeeper": "Portiere", "Defender": "Difensore", "Midfielder": "Centrocampista", "Forward": "Attaccante",
       "GKP": "Portiere", "DEF": "Difensore", "MID": "Centrocampista", "FWD": "Attaccante"}

TEAM = {  # colonna (senza home_/away_) -> metrica
    "possession": "possesso", "expected_goals_xg": "xg", "xg_open_play": "xg_azione", "xg_set_play": "xg_piazzati",
    "non_penalty_xg": "xg_no_rigori", "xg_on_target_xgot": "xgot", "big_chances": "grandi_occasioni",
    "big_chances_missed": "grandi_occasioni_sbagliate", "total_shots": "tiri", "shots_on_target": "tiri_porta",
    "shots_off_target": "tiri_fuori", "blocked_shots": "tiri_respinti", "hit_woodwork": "legni",
    "shots_inside_box": "tiri_area", "shots_outside_box": "tiri_fuori_area", "passes": "passaggi",
    "accurate_passes": "passaggi_riusciti", "own_half": "passaggi_propria_meta", "opposition_half": "passaggi_meta_avversaria",
    "accurate_long_balls": "lanci_lunghi_riusciti", "accurate_crosses": "cross_riusciti", "throws": "rimesse",
    "touches_in_opposition_box": "tocchi_area_avversaria", "offsides": "fuorigioco", "fouls_committed": "falli",
    "corners": "corner", "yellow_cards": "gialli", "red_cards": "rossi", "tackles_won": "contrasti_vinti",
    "interceptions": "intercetti", "blocks": "respinte", "clearances": "spazzate", "keeper_saves": "parate",
    "duels_won": "duelli_vinti", "ground_duels_won": "duelli_terra_vinti", "aerial_duels_won": "duelli_aerei_vinti",
    "successful_dribbles": "dribbling_riusciti", "distance_covered": "distanza_km", "number_of_sprints": "sprint",
}
TEAM_PCT = {  # riusciti, percentuale -> tentati
    ("successful_dribbles", "successful_dribbles_pct"): "dribbling_tentati",
    ("accurate_crosses", "accurate_crosses_pct"): "cross",
    ("accurate_long_balls", "accurate_long_balls_pct"): "lanci_lunghi",
    ("tackles_won", "tackles_won_pct"): "contrasti",
}
PLAYER = {
    "minutes_played": "minuti", "goals": "gol", "assists": "assist", "total_shots": "tiri", "xg": "xg", "xa": "xa",
    "shots_on_target": "tiri_porta", "successful_dribbles": "dribbling_riusciti", "big_chances_missed": "grandi_occasioni_sbagliate",
    "touches_opposition_box": "tocchi_area", "touches": "tocchi", "accurate_passes": "passaggi_riusciti",
    "chances_created": "passaggi_chiave", "final_third_passes": "passaggi_ultimo_terzo", "accurate_crosses": "cross_riusciti",
    "accurate_long_balls": "lanci_lunghi_riusciti", "tackles_won": "contrasti_vinti", "tackles": "contrasti",
    "interceptions": "intercetti", "recoveries": "recuperi", "blocks": "respinte", "clearances": "spazzate",
    "dribbled_past": "dribblato", "duels_won": "duelli_vinti", "duels_lost": "duelli_persi",
    "aerial_duels_won": "duelli_aerei_vinti", "ground_duels_won": "duelli_terra_vinti", "was_fouled": "falli_subiti",
    "fouls_committed": "falli_commessi", "saves": "parate", "goals_conceded": "gol_subiti", "goals_prevented": "gol_evitati",
    "offsides": "fuorigioco", "penalties_scored": "rigori_segnati", "penalties_missed": "rigori_sbagliati",
    "defensive_contributions": "contributi_difensivi", "distance_covered": "distanza_km", "xgot": "xgot",
}
# Tentativi ricavati da riusciti / percentuale solo per i passaggi: per dribbling e cross la fonte
# lascia vuota la percentuale quando i riusciti sono zero, e la media risulterebbe gonfiata.
PLAYER_PCT = {("accurate_passes", "accurate_passes_percent"): "passaggi"}


def _num(v):
    if v is None or str(v).strip() == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _csv(season, gw, name):
    folder = f"{season[:4]}-20{season[5:7]}"
    rel = f"{folder}/By Tournament/Premier League/GW{gw}/{name}.csv"
    if BASE.startswith("/"):
        p = f"{BASE}/{rel}"
        if not os.path.exists(p):
            raise SourceError(f"HTTP 404 su {p}")
        return list(csv.DictReader(open(p, encoding="utf-8")))
    url = f"{BASE}/{urllib.parse.quote(rel)}"
    return list(csv.DictReader(io.StringIO(http_get(url).decode("utf-8").lstrip("﻿"))))


def fetch(con, cnt, resolver, league, season, log):
    if not config.LEAGUES[league].get("fplcore"):
        return 0
    done = set(db.kv_get(con, f"fplcore_done_{season}", []))
    n_m = n_p = 0
    for gw in range(1, 39):
        try:
            matches = _csv(season, gw, "matches")
        except SourceError as e:
            if "404" in str(e):
                continue
            raise
        fin = [m for m in matches if m.get("finished") == "True"]
        if not fin:
            continue
        key = f"GW{gw}"
        complete = all(m.get("stats_processed") == "True" and m.get("player_stats_processed") == "True" for m in fin)
        if key in done and complete and len(fin) == len(matches):
            continue
        teams = {r["code"]: r["name"] for r in _csv(season, gw, "teams")}
        by_match = {}
        for m in fin:
            hn, an = teams.get(m["home_team"].split(".")[0]), teams.get(m["away_team"].split(".")[0])
            if not hn or not an:
                continue
            h, a = resolver.resolve(league, hn, "fplcore"), resolver.resolve(league, an, "fplcore")
            mid = db.match_id(league, season, h, a)
            if not con.execute("SELECT 1 FROM match WHERE id=?", (mid,)).fetchone():
                continue  # partita non presente nel calendario: non si crea dal nulla
            by_match[m["match_id"]] = (mid, h, a, m["home_team"].split(".")[0], m["away_team"].split(".")[0])
            if m.get("stats_processed") != "True":
                continue
            for col, metric in TEAM.items():
                for side, pre, tid in (("H", "home_", h), ("A", "away_", a)):
                    v = _num(m.get(pre + col))
                    if v is not None:
                        db.upsert_stat(con, cnt, mid, side, tid, metric, v, "fplcore")
            for (ok_col, pct_col), metric in TEAM_PCT.items():
                for side, pre, tid in (("H", "home_", h), ("A", "away_", a)):
                    k, pct = _num(m.get(pre + ok_col)), _num(m.get(pre + pct_col))
                    if k is not None and pct:
                        db.upsert_stat(con, cnt, mid, side, tid, metric, round(k / pct * 100), "fplcore")
            n_m += 1
        if not by_match:
            continue
        players = {r["player_id"]: r for r in _csv(season, gw, "players")}
        try:
            gws = {r["id"]: r for r in _csv(season, gw, "player_gameweek_stats")}
        except SourceError:
            gws = {}
        pms = _csv(season, gw, "playermatchstats")
        rows_by = {}
        for r in pms:
            if r["match_id"] in by_match:
                rows_by.setdefault(r["match_id"], []).append(r)
        apps = {}  # partite per giocatore nella giornata (per attribuire i cartellini FPL)
        for rows in rows_by.values():
            for r in rows:
                if (_num(r.get("minutes_played")) or 0) > 0:
                    apps[r["player_id"]] = apps.get(r["player_id"], 0) + 1
        for fmid, rows in rows_by.items():
            mid, h, a, hc, ac = by_match[fmid]
            played = [r for r in rows if (_num(r.get("minutes_played")) or 0) > 0]
            active = {c for c in list(PLAYER) + [p for pair in PLAYER_PCT for p in pair] if any(_num(r.get(c)) is not None for r in played)}
            for r in rows:
                info = players.get(r["player_id"])
                if not info:
                    continue
                tc = info.get("team_code")
                tid = h if tc == hc else a if tc == ac else None
                if tid is None:
                    continue
                pid = f"fpl-{info['player_code']}-{slug(info.get('web_name') or info['player_code'])}"
                full = f"{info.get('first_name', '')} {info.get('second_name', '')}".strip()
                con.execute("INSERT INTO player(id,name,team_id,position,source) VALUES(?,?,?,?,?) "
                            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, team_id=excluded.team_id, position=excluded.position",
                            (pid, info.get("web_name") or full, tid, POS.get(info.get("position"), info.get("position")), "fplcore"))
                mins = _num(r.get("minutes_played")) or 0
                vals = {}
                if mins <= 0:
                    vals["minuti"] = 0
                else:
                    for col, metric in PLAYER.items():
                        v = _num(r.get(col))
                        if v is None and col in active:
                            v = 0.0
                        if v is not None:
                            vals[metric] = v
                    for (ok_col, pct_col), metric in PLAYER_PCT.items():
                        k, pct = _num(r.get(ok_col)), _num(r.get(pct_col))
                        if k is not None and pct:
                            vals[metric] = round(k / pct * 100)
                    g = gws.get(r["player_id"])
                    if g and apps.get(r["player_id"]) == 1:
                        for col, metric in (("yellow_cards", "gialli"), ("red_cards", "rossi"), ("starts", "titolare")):
                            v = _num(g.get(col))
                            if v is not None:
                                vals[metric] = v
                    if "titolare" not in vals:
                        vals["titolare"] = 1.0 if _num(r.get("start_min")) == 0 and mins >= 45 else 0.0
                for metric, v in vals.items():
                    if v is None:
                        continue
                    con.execute("INSERT INTO player_match_stat VALUES(?,?,?,?,?,?) ON CONFLICT(match_id, player_id, metric) "
                                "DO UPDATE SET value=excluded.value, team_id=excluded.team_id",
                                (mid, pid, tid, metric, float(v), "fplcore"))
                n_p += 1
        if complete and len(fin) == len(matches):
            done.add(key)
    db.kv_set(con, f"fplcore_done_{season}", sorted(done))
    log(f"{league} {season}: statistiche avanzate per {n_m} partite, {n_p} righe giocatore")
    return n_m
