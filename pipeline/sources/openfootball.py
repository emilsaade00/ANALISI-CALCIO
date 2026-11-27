"""openfootball/football.json (GitHub, pubblico dominio): calendario con giornate e risultati.

Usata per numerare le giornate e come calendario di riserva. Gli orari sono
nell'ora locale del campionato e vengono convertiti in UTC.
"""
import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from .. import config, db
from .common import http_get

INFO = {
    "id": "openfootball", "name": "openfootball / football.json (GitHub)",
    "url": "https://github.com/openfootball/football.json",
    "license": "CC0 / pubblico dominio", "needs_key": 0, "key_env": "",
    "provides": "Calendario completo con giornate, orari locali, risultati finali e primo tempo",
    "notes": "Mantenuta da volontari: l'aggiornamento dei risultati puo' arrivare in ritardo.",
}
UTC = ZoneInfo("UTC")


def _score(m):
    s = m.get("score")
    ft = ht = None
    if isinstance(s, dict):
        ft, ht = s.get("ft"), s.get("ht")
    elif isinstance(s, list) and len(s) == 2:
        ft = s
    return ft, ht


def ingest(con, cnt, resolver, league, season, data, source="openfootball"):
    tz = ZoneInfo(config.LEAGUES[league]["tz"])
    n = 0
    for m in data.get("matches", []):
        mdm = re.search(r"(\d+)", m.get("round", ""))
        md = int(mdm.group(1)) if mdm else None
        d = datetime.strptime(m["date"], "%Y-%m-%d")
        t = m.get("time")
        if t:
            hh, mm = t.split(":")[:2]
            ko = d.replace(hour=int(hh), minute=int(mm), tzinfo=tz).astimezone(UTC)
        else:
            ko = d.replace(hour=12, tzinfo=tz).astimezone(UTC)
        h = resolver.resolve(league, m["team1"], source)
        a = resolver.resolve(league, m["team2"], source)
        for tid in (h, a):
            canon, disp = resolver.names(tid)
            db.upsert_team(con, tid, league, canon, disp)
        ft, ht = _score(m)
        db.upsert_match(con, cnt, league=league, season=season, home_id=h, away_id=a, source=source,
                        kickoff_utc=ko.strftime("%Y-%m-%dT%H:%M:%SZ"), time_known=bool(t),
                        matchday=md,
                        fthg=ft[0] if ft else None, ftag=ft[1] if ft else None,
                        hthg=ht[0] if ht else None, htag=ht[1] if ht else None)
        n += 1
    return n


def fetch(con, cnt, resolver, league, season, log):
    code = config.LEAGUES[league]["openfootball"]
    url = f"https://raw.githubusercontent.com/openfootball/football.json/master/{season}/{code}.json"
    data = json.loads(http_get(url).decode("utf-8"))
    n = ingest(con, cnt, resolver, league, season, data)
    played = sum(1 for m in data.get("matches", []) if _score(m)[0])
    last = max((m["date"] for m in data.get("matches", []) if _score(m)[0]), default=None)
    log(f"{league} {season}: {n} partite in calendario, {played} con risultato (ultimo: {last or '-'})")
    return n
