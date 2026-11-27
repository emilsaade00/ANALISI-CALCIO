"""Match Report ufficiali Lega Serie A, estratti dal progetto serie-a-observatory (GitHub,
aggiornato ogni settimana). Solo Serie A, stagione in corso.

Squadra: tiri fuori e respinti, passaggi chiave, dribbling, passaggi riusciti e precisione,
passaggi nell'ultimo terzo, palloni giocati in avanti, lanci lunghi, parate, recuperi, fuorigioco.
Giocatore: minuti, gol, assist, tiri, tiri in porta, occasioni, passaggi chiave, passaggi,
passaggi in avanti, recuperi, palloni giocati, falli subiti, gialli, rossi; portieri: parate,
respinte, gol subiti, lanci lunghi. I falli commessi, i contrasti e i dribbling del singolo
giocatore NON sono nei report.
"""
import csv
import io
import os

from .. import config, db
from ..teams import slug
from .common import http_get, SourceError

INFO = {
    "id": "legaseriea", "name": "Match Report Lega Serie A (serie-a-observatory)",
    "url": "https://github.com/matteovezzoli/serie-a-observatory",
    "license": "Dati di Lega Serie A estratti dai Match Report ufficiali; codice MIT. Uso personale",
    "needs_key": 0, "key_env": "",
    "provides": "Serie A: statistiche ufficiali di squadra e di ogni giocatore (tiri, tiri in porta, passaggi chiave, recuperi, falli subiti, cartellini, parate)",
    "notes": "Aggiornata ogni settimana (giovedì). I report possono essere corretti dalla Lega nei giorni successivi.",
}
BASE = os.environ.get("CALCIO_LSA_BASE", "https://raw.githubusercontent.com/matteovezzoli/serie-a-observatory/main/data/processed")
SEASON = "2026-27"

TEAM = {"Tiri fuori": "tiri_fuori", "Tiri respinti": "tiri_respinti", "Passaggi chiave": "passaggi_chiave",
        "Dribbling": "dribbling_riusciti", "Passaggi riusciti": "passaggi_riusciti",
        "Passaggi riusciti in ultimo terzo": "passaggi_ultimo_terzo", "Palloni giocati in avanti riusciti": "passaggi_avanti",
        "Passaggi lunghi": "lanci_lunghi", "Parate": "parate", "Recuperi": "recuperi", "Fuorigioco": "fuorigioco"}
OUT = {"MIN": "minuti", "G": "gol", "AS": "assist", "T": "tiri", "TP": "tiri_porta", "OG": "occasioni",
       "PC": "passaggi_chiave", "P": "passaggi_riusciti", "PA": "passaggi_avanti", "R": "recuperi", "PG": "tocchi",
       "FS": "falli_subiti", "AMM": "gialli", "ESP": "rossi"}
GK = {"MIN": "minuti", "GS": "gol_subiti", "PA": "parate", "RE": "respinte_portiere", "LU": "lanci_lunghi", "AMM": "gialli",
      "ESP": "rossi", "AS": "assist", "P": "passaggi_riusciti", "PG": "tocchi"}


def _num(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def _rows(name):
    if BASE.startswith("/"):
        p = f"{BASE}/{name}.csv"
        if not os.path.exists(p):
            raise SourceError(f"HTTP 404 su {p}")
        return list(csv.DictReader(open(p, encoding="utf-8")))
    return list(csv.DictReader(io.StringIO(http_get(f"{BASE}/{name}.csv").decode("utf-8").lstrip("﻿"))))


def fetch(con, cnt, resolver, league, season, log):
    if league != "sa" or season != SEASON:
        return 0
    matches = _rows("matches")
    ids = {}
    for m in matches:
        h, a = resolver.resolve("sa", m["home"], "legaseriea"), resolver.resolve("sa", m["away"], "legaseriea")
        mid = db.match_id("sa", season, h, a)
        if not con.execute("SELECT 1 FROM match WHERE id=?", (mid,)).fetchone():
            continue
        ids[m["match_id"]] = (mid, h, a, m["home"], m["away"])
        for col, metric in TEAM.items():
            for side, suf, tid in (("H", "_home", h), ("A", "_away", a)):
                v = _num(m.get(col + suf))
                if v is not None:
                    db.upsert_stat(con, cnt, mid, side, tid, metric, v, "legaseriea")
        for side, suf, tid in (("H", "_home", h), ("A", "_away", a)):
            ok, pct = _num(m.get("Passaggi riusciti" + suf)), _num(m.get("Passaggi riusciti/tentati (%)" + suf))
            if ok is not None and pct:
                db.upsert_stat(con, cnt, mid, side, tid, "passaggi", round(ok / pct * 100), "legaseriea")
    players = _rows("players")
    by = {}
    for r in players:
        if r["match_id"] in ids:
            by.setdefault(r["match_id"], []).append(r)
    n = 0
    for lmid, rows in by.items():
        mid, h, a, hn, an = ids[lmid]
        played = [r for r in rows if (_num(r.get("MIN")) or 0) > 0]
        active = {c for c in set(OUT) | set(GK) if any(_num(r.get(c)) is not None for r in played)}
        for r in rows:
            tid = h if r["team"] == hn else a if r["team"] == an else None
            if tid is None or not r.get("player"):
                continue
            gk = r.get("role") == "GK"
            name = r["player"].title()
            pid = f"lsa-{tid.split('-', 1)[1]}-{slug(r['player'])}"
            con.execute("INSERT INTO player(id,name,team_id,position,source) VALUES(?,?,?,?,?) "
                        "ON CONFLICT(id) DO UPDATE SET name=excluded.name, team_id=excluded.team_id, position=excluded.position",
                        (pid, name, tid, "Portiere" if gk else "Giocatore di movimento", "legaseriea"))
            mins = _num(r.get("MIN")) or 0
            vals = {"minuti": mins}
            if mins > 0:
                for col, metric in (GK if gk else OUT).items():
                    v = _num(r.get(col))
                    if v is None and col in active and metric != "minuti":
                        v = 0.0
                    if v is not None:
                        vals[metric] = v
                pct = _num(r.get("P(%)"))
                if vals.get("passaggi_riusciti") and pct:
                    vals["passaggi"] = round(vals["passaggi_riusciti"] / pct * 100)
                # i report non indicano i titolari: si considera titolare chi gioca almeno 60 minuti
                vals["titolare"] = 1.0 if mins >= 60 else 0.0
            for metric, v in vals.items():
                con.execute("INSERT INTO player_match_stat VALUES(?,?,?,?,?,?) ON CONFLICT(match_id, player_id, metric) "
                            "DO UPDATE SET value=excluded.value, team_id=excluded.team_id",
                            (mid, pid, tid, metric, float(v), "legaseriea"))
            n += 1
    log(f"sa {season}: {len(ids)} partite con report ufficiale, {n} righe giocatore")
    return len(ids)
