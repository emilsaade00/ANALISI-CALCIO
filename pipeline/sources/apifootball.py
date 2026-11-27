"""API-Football v3 (api-sports.io), opzionale con chiave: statistiche estese, giocatori,
formazioni ufficiali e indisponibili.

Endpoint usati: /fixtures, /fixtures/statistics, /fixtures/players, /fixtures/lineups,
/injuries. Gli endpoint /odds e /predictions NON vengono mai chiamati (regola del progetto).
Il budget giornaliero di richieste e' limitato da API_FOOTBALL_DAILY_BUDGET.
"""
import json
from datetime import datetime, timedelta, timezone

from .. import config, db
from ..teams import slug
from .common import http_get, SourceError

INFO = {
    "id": "apifootball", "name": "API-Football v3 (api-sports.io)",
    "url": "https://www.api-football.com/",
    "license": "Account gratuito (100 richieste/giorno) o piano a pagamento",
    "needs_key": 1, "key_env": "API_FOOTBALL_KEY",
    "provides": "Possesso, passaggi, xG del fornitore, tiri in/fuori area, respinti, parate, statistiche giocatore, formazioni ufficiali, indisponibili",
    "notes": "Attivazione: crea un account su dashboard.api-football.com e salva la chiave come segreto API_FOOTBALL_KEY. "
             "Il piano gratuito puo' limitare le stagioni accessibili: lo stato reale compare qui dopo il primo aggiornamento.",
}
BASE = "https://v3.football.api-sports.io"
FORBIDDEN = ("/odds", "/predictions")

TEAM_STATS = {
    "Shots on Goal": "tiri_porta", "Shots off Goal": "tiri_fuori", "Total Shots": "tiri",
    "Blocked Shots": "tiri_respinti", "Shots insidebox": "tiri_area", "Shots outsidebox": "tiri_fuori_area",
    "Fouls": "falli", "Corner Kicks": "corner", "Offsides": "fuorigioco",
    "Ball Possession": "possesso", "Yellow Cards": "gialli", "Red Cards": "rossi",
    "Goalkeeper Saves": "parate", "Total passes": "passaggi", "Passes accurate": "passaggi_riusciti",
    "Passes %": "precisione_passaggi", "expected_goals": "xg", "goals_prevented": "gol_evitati",
}
POS = {"G": "Portiere", "D": "Difensore", "M": "Centrocampista", "F": "Attaccante"}
STATUS = {"NS": "SCHEDULED", "TBD": "SCHEDULED", "PST": "POSTPONED", "CANC": "CANCELLED",
          "SUSP": "SUSPENDED", "INT": "SUSPENDED", "ABD": "CANCELLED", "FT": "FINISHED",
          "AET": "FINISHED", "PEN": "FINISHED", "AWD": "FINISHED", "WO": "FINISHED"}


class Client:
    def __init__(self, budget):
        self.budget = budget
        self.used = 0

    def get(self, path, **params):
        if any(path.startswith(f) for f in FORBIDDEN):
            raise SourceError("endpoint escluso per regola (quote/pronostici esterni)")
        if self.used >= self.budget:
            raise SourceError("budget giornaliero esaurito")
        q = "&".join(f"{k}={v}" for k, v in params.items())
        self.used += 1
        data = json.loads(http_get(f"{BASE}{path}?{q}", headers={"x-apisports-key": config.API_FOOTBALL_KEY}))
        if data.get("errors"):
            raise SourceError(f"API-Football: {data['errors']}")
        return data.get("response", [])


def _num(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.replace("%", "").strip()
        if not v:
            return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch(con, cnt, resolver, league, season, log, client=None):
    if not config.API_FOOTBALL_KEY:
        raise SourceError("chiave API_FOOTBALL_KEY non configurata")
    client = client or Client(config.API_FOOTBALL_DAILY_BUDGET)
    lid = config.LEAGUES[league]["api_football"]
    fixtures = client.get("/fixtures", league=lid, season=config.season_start_year(season))
    now = datetime.now(timezone.utc)
    todo_stats, todo_inj = [], []
    for f in fixtures:
        fx, tm = f["fixture"], f["teams"]
        h = resolver.resolve(league, tm["home"]["name"], "apifootball")
        a = resolver.resolve(league, tm["away"]["name"], "apifootball")
        for tid in (h, a):
            canon, disp = resolver.names(tid)
            db.upsert_team(con, tid, league, canon, disp)
        st = STATUS.get(fx["status"]["short"], "LIVE")
        sc = f.get("score") or {}
        fin = st == "FINISHED"
        rnd = (f.get("league") or {}).get("round", "")
        md = int(rnd.rsplit("-", 1)[-1]) if rnd.rsplit("-", 1)[-1].strip().isdigit() else None
        ref = (fx.get("referee") or "").split(",")[0].strip()
        rid = db.upsert_referee(con, ref) if ref else None
        ko = datetime.fromisoformat(fx["date"]).astimezone(timezone.utc)
        mid = db.upsert_match(con, cnt, league=league, season=season, home_id=h, away_id=a,
                              source="apifootball", kickoff_utc=ko.strftime("%Y-%m-%dT%H:%M:%SZ"),
                              time_known=True, matchday=md, status=st,
                              fthg=(sc.get("fulltime") or {}).get("home") if fin else None,
                              ftag=(sc.get("fulltime") or {}).get("away") if fin else None,
                              hthg=(sc.get("halftime") or {}).get("home") if fin else None,
                              htag=(sc.get("halftime") or {}).get("away") if fin else None,
                              referee_id=rid, ext_apif=fx["id"])
        if fin and now - ko < timedelta(days=10):
            has = con.execute("SELECT 1 FROM team_match_stat WHERE match_id=? AND source='apifootball' LIMIT 1",
                              (mid,)).fetchone()
            if not has:
                todo_stats.append((mid, fx["id"], h, a))
        elif st == "SCHEDULED" and timedelta(0) < ko - now < timedelta(days=3):
            todo_inj.append((mid, fx["id"], h, a))
    done = 0
    for mid, fid, h, a in todo_stats:
        try:
            _stats(con, cnt, client, resolver, league, mid, fid, h, a)
            _players(con, cnt, client, resolver, league, mid, fid, h, a)
            _lineups(con, cnt, client, resolver, league, mid, fid, h, a)
            done += 1
        except SourceError as e:
            log(f"{league}: interrotto ({e})")
            break
    inj = 0
    for mid, fid, h, a in todo_inj:
        try:
            _injuries(con, cnt, client, resolver, league, mid, fid, h, a)
            inj += 1
        except SourceError as e:
            log(f"{league}: indisponibili interrotti ({e})")
            break
    log(f"{league} {season}: {len(fixtures)} partite, statistiche estese per {done}, indisponibili per {inj}; "
        f"richieste usate {client.used}/{client.budget}")
    return len(fixtures)


def _side(resolver, league, name, h, a):
    t = resolver.resolve(league, name, "apifootball")
    return ("H", h) if t == h else ("A", a)


def _stats(con, cnt, client, resolver, league, mid, fid, h, a):
    for blk in client.get("/fixtures/statistics", fixture=fid):
        side, tid = _side(resolver, league, blk["team"]["name"], h, a)
        for s in blk.get("statistics", []):
            m = TEAM_STATS.get(s.get("type"))
            v = _num(s.get("value"))
            if m and v is not None:
                db.upsert_stat(con, cnt, mid, side, tid, m, v, "apifootball")
            elif m and s.get("value") is None and m not in ("xg", "gol_evitati", "possesso", "precisione_passaggi"):
                db.upsert_stat(con, cnt, mid, side, tid, m, 0, "apifootball")  # la fonte usa null per zero


def _pid(p):
    return f"p-{p['id']}-{slug(p.get('name') or str(p['id']))}"


def _players(con, cnt, client, resolver, league, mid, fid, h, a):
    for blk in client.get("/fixtures/players", fixture=fid):
        side, tid = _side(resolver, league, blk["team"]["name"], h, a)
        for p in blk.get("players", []):
            st = (p.get("statistics") or [{}])[0]
            g = st.get("games") or {}
            pid = _pid(p["player"])
            con.execute("INSERT INTO player(id,name,team_id,position,source) VALUES(?,?,?,?,?) "
                        "ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id, position=COALESCE(excluded.position, player.position)",
                        (pid, p["player"].get("name"), tid, POS.get(g.get("position")), "apifootball"))
            vals = {
                "minuti": g.get("minutes"), "titolare": None if g.get("minutes") is None else (0 if g.get("substitute") else 1),
                "gol": (st.get("goals") or {}).get("total"), "assist": (st.get("goals") or {}).get("assists"),
                "gol_subiti": (st.get("goals") or {}).get("conceded"), "parate": (st.get("goals") or {}).get("saves"),
                "tiri": (st.get("shots") or {}).get("total"), "tiri_porta": (st.get("shots") or {}).get("on"),
                "passaggi": (st.get("passes") or {}).get("total"), "passaggi_chiave": (st.get("passes") or {}).get("key"),
                "contrasti": (st.get("tackles") or {}).get("total"), "intercetti": (st.get("tackles") or {}).get("interceptions"),
                "respinte": (st.get("tackles") or {}).get("blocks"), "duelli_vinti": (st.get("duels") or {}).get("won"),
                "dribbling_riusciti": (st.get("dribbles") or {}).get("success"),
                "dribbling_tentati": (st.get("dribbles") or {}).get("attempts"),
                "dribblato": (st.get("dribbles") or {}).get("past"),
                "duelli": (st.get("duels") or {}).get("total"),
                "rigori_ottenuti": (st.get("penalty") or {}).get("won"),
                "rigori_commessi": (st.get("penalty") or {}).get("commited"),
                "falli_commessi": (st.get("fouls") or {}).get("committed"), "falli_subiti": (st.get("fouls") or {}).get("drawn"),
                "gialli": (st.get("cards") or {}).get("yellow"), "rossi": (st.get("cards") or {}).get("red"),
                "rigori_segnati": (st.get("penalty") or {}).get("scored"), "rigori_sbagliati": (st.get("penalty") or {}).get("missed"),
                "rigori_parati": (st.get("penalty") or {}).get("saved"), "fuorigioco": st.get("offsides"),
            }
            played = bool(g.get("minutes"))
            for k, v in vals.items():
                v = _num(v)
                if v is None and played and k not in ("parate", "gol_subiti", "rigori_parati"):
                    v = 0.0  # giocatore in campo: la fonte usa null per zero
                if v is not None:
                    con.execute("INSERT INTO player_match_stat VALUES(?,?,?,?,?,?) ON CONFLICT DO UPDATE SET value=excluded.value",
                                (mid, pid, tid, k, v, "apifootball"))
                    cnt.rows_new += 1


def _lineups(con, cnt, client, resolver, league, mid, fid, h, a):
    for blk in client.get("/fixtures/lineups", fixture=fid):
        side, tid = _side(resolver, league, blk["team"]["name"], h, a)
        for grp, status in (("startXI", "titolare"), ("substitutes", "panchina")):
            for p in blk.get(grp, []) or []:
                pl = p.get("player") or {}
                if not pl.get("id"):
                    continue
                con.execute("INSERT INTO lineup VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at",
                            (mid, tid, _pid(pl), status, "ufficiale", "apifootball", db.now_iso(), blk.get("formation")))


def _injuries(con, cnt, client, resolver, league, mid, fid, h, a):
    for it in client.get("/injuries", fixture=fid):
        side, tid = _side(resolver, league, it["team"]["name"], h, a)
        pl = it.get("player") or {}
        if not pl.get("id"):
            continue
        con.execute("INSERT INTO player(id,name,team_id,position,source) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
                    (_pid(pl), pl.get("name"), tid, None, "apifootball"))
        con.execute("INSERT INTO lineup VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET detail=excluded.detail, updated_at=excluded.updated_at",
                    (mid, tid, _pid(pl), "indisponibile", "indisponibili", "apifootball", db.now_iso(),
                     f"{pl.get('type') or ''}: {pl.get('reason') or ''}".strip(": ")))
