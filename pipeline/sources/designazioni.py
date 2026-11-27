"""Designazioni arbitrali ufficiali AIA, trascritte in data/manuale/designazioni_<lega>_<stagione>.csv.

Ogni riga indica giornata, squadra di casa, ospite, arbitro e la pagina da cui e' stata presa.
Una riga viene usata solo se la partita esiste nel calendario della stessa stagione; le righe
non riconosciute vengono segnalate e scartate. Con API-Football o football-data.org attive le
designazioni arrivano anche in automatico.
"""
import csv

from .. import config, db

INFO = {
    "id": "designazioni", "name": "Designazioni arbitrali AIA (file del progetto)",
    "url": "https://www.aia-figc.it/",
    "license": "Comunicati pubblici AIA ripresi dalla stampa sportiva; fonte di ogni riga indicata nel file",
    "needs_key": 0, "key_env": "",
    "provides": "Arbitro di ogni partita di Serie A, anche prima del calcio d'inizio",
    "notes": "File data/manuale/designazioni_sa_<stagione>.csv: si aggiunge una riga per partita a ogni giornata.",
}


def fetch(con, cnt, resolver, league, season, log):
    path = config.MANUAL_DIR / f"designazioni_{league}_{season}.csv"
    if not path.exists():
        return 0
    ok, bad = 0, []
    for r in csv.DictReader(open(path, encoding="utf-8")):
        h = resolver.resolve(league, r["casa"], "designazioni", allow_new=False)
        a = resolver.resolve(league, r["ospite"], "designazioni", allow_new=False)
        mid = db.match_id(league, season, h, a) if h and a else None
        row = con.execute("SELECT matchday_orig, matchday FROM match WHERE id=?", (mid,)).fetchone() if mid else None
        if not row or str(row["matchday_orig"] or row["matchday"]) != str(r["giornata"]).strip():
            bad.append(f"G{r['giornata']} {r['casa']}-{r['ospite']}")
            continue
        rid = db.upsert_referee(con, r["arbitro"].strip())
        cur = con.execute("SELECT referee_id FROM match WHERE id=?", (mid,)).fetchone()
        if cur["referee_id"] != rid:
            con.execute("UPDATE match SET referee_id=?, referee_src=?, updated_at=? WHERE id=?",
                        (rid, "designazioni", db.now_iso(), mid))
            cnt.rows_changed += 1
        cnt.rows_in += 1
        ok += 1
    log(f"{league} {season}: {ok} designazioni collegate" + (f"; scartate {len(bad)}: {', '.join(bad[:5])}" if bad else ""))
    return ok
