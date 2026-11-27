"""football-data.org API v4 (chiave gratuita): calendario ufficiale, stati, giornate, arbitri.

Piano gratuito: Serie A (SA), Premier League (PL), Bundesliga (BL1), Ligue 1 (FL1),
10 richieste al minuto. Una richiesta per campionato a ogni aggiornamento.
Si usano solo gli endpoint delle partite: nessun dato di quote.
"""
import json
import time

from .. import config, db
from .common import http_get, SourceError

INFO = {
    "id": "fdorg", "name": "football-data.org (API v4)", "url": "https://www.football-data.org/",
    "license": "Piano gratuito con registrazione; dati per uso non commerciale",
    "needs_key": 1, "key_env": "FOOTBALL_DATA_ORG_KEY",
    "provides": "Calendario ufficiale con orari UTC, giornate, rinvii, stato partita, risultati, arbitri designati",
    "notes": "Attivazione: registrati su football-data.org, copia il token e salvalo come segreto FOOTBALL_DATA_ORG_KEY.",
}

STATUS = {
    "SCHEDULED": "SCHEDULED", "TIMED": "SCHEDULED", "IN_PLAY": "LIVE", "PAUSED": "LIVE",
    "FINISHED": "FINISHED", "AWARDED": "FINISHED", "POSTPONED": "POSTPONED",
    "SUSPENDED": "SUSPENDED", "CANCELLED": "CANCELLED",
}


def ingest(con, cnt, resolver, league, season, payload, source="fdorg"):
    n = 0
    for m in payload.get("matches", []):
        ht_, at_ = m.get("homeTeam") or {}, m.get("awayTeam") or {}
        if not ht_.get("name") or not at_.get("name"):
            continue  # squadre non ancora definite
        h = resolver.resolve(league, ht_.get("name"), source)
        a = resolver.resolve(league, at_.get("name"), source)
        for tid in (h, a):
            canon, disp = resolver.names(tid)
            db.upsert_team(con, tid, league, canon, disp)
        st = STATUS.get(m.get("status"), m.get("status"))
        sc = m.get("score") or {}
        ft = sc.get("fullTime") or {}
        ht = sc.get("halfTime") or {}
        fin = st == "FINISHED"
        refs = [r for r in (m.get("referees") or []) if r.get("type") in (None, "REFEREE")]
        rid = db.upsert_referee(con, refs[0]["name"]) if refs and refs[0].get("name") else None
        db.upsert_match(con, cnt, league=league, season=season, home_id=h, away_id=a, source=source,
                        kickoff_utc=(m.get("utcDate") or "").replace(".000", "") or None,
                        time_known=True, matchday=m.get("matchday"), status=st,
                        fthg=ft.get("home") if fin else None, ftag=ft.get("away") if fin else None,
                        hthg=ht.get("home") if fin else None, htag=ht.get("away") if fin else None,
                        referee_id=rid, ext_fdorg=m.get("id"))
        n += 1
    return n


def fetch(con, cnt, resolver, league, season, log):
    if not config.FOOTBALL_DATA_ORG_KEY:
        raise SourceError("chiave FOOTBALL_DATA_ORG_KEY non configurata")
    code = config.LEAGUES[league]["fd_org"]
    url = (f"https://api.football-data.org/v4/competitions/{code}/matches"
           f"?season={config.season_start_year(season)}")
    payload = json.loads(http_get(url, headers={"X-Auth-Token": config.FOOTBALL_DATA_ORG_KEY}))
    n = ingest(con, cnt, resolver, league, season, payload)
    log(f"{league} {season}: {n} partite dal calendario ufficiale")
    time.sleep(6.5)  # rispetta il limite di 10 richieste/minuto
    return n
