"""Database SQLite: schema e funzioni di scrittura idempotenti (niente duplicati)."""
import json
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY, name TEXT, url TEXT, license TEXT, needs_key INTEGER,
  key_env TEXT, provides TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS source_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, source_id TEXT,
  started_at TEXT, finished_at TEXT, status TEXT, rows_in INTEGER DEFAULT 0,
  rows_new INTEGER DEFAULT 0, rows_changed INTEGER DEFAULT 0, message TEXT
);
CREATE TABLE IF NOT EXISTS update_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT,
  status TEXT, message TEXT, trigger TEXT
);
CREATE TABLE IF NOT EXISTS team (
  id TEXT PRIMARY KEY, league TEXT, canonical TEXT, display TEXT
);
CREATE TABLE IF NOT EXISTS referee (
  id TEXT PRIMARY KEY, name TEXT
);
CREATE TABLE IF NOT EXISTS match (
  id TEXT PRIMARY KEY, league TEXT, season TEXT, matchday INTEGER,
  matchday_orig INTEGER, kickoff_utc TEXT, time_known INTEGER DEFAULT 0,
  status TEXT, home_id TEXT, away_id TEXT,
  fthg INTEGER, ftag INTEGER, hthg INTEGER, htag INTEGER,
  referee_id TEXT, referee_src TEXT,
  src_calendar TEXT, src_result TEXT, ext_fdorg INTEGER, ext_apif INTEGER,
  first_seen TEXT, updated_at TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS ix_match_ls ON match(league, season);
CREATE INDEX IF NOT EXISTS ix_match_ko ON match(kickoff_utc);
CREATE TABLE IF NOT EXISTS team_match_stat (
  match_id TEXT, side TEXT, team_id TEXT, metric TEXT, value REAL, source TEXT,
  updated_at TEXT, PRIMARY KEY (match_id, side, metric)
);
CREATE TABLE IF NOT EXISTS player (
  id TEXT PRIMARY KEY, name TEXT, team_id TEXT, position TEXT, source TEXT
);
CREATE TABLE IF NOT EXISTS player_match_stat (
  match_id TEXT, player_id TEXT, team_id TEXT, metric TEXT, value REAL, source TEXT,
  PRIMARY KEY (match_id, player_id, metric)
);
CREATE TABLE IF NOT EXISTS player_map (
  source TEXT, ext_id TEXT, player_id TEXT, PRIMARY KEY (source, ext_id)
);
CREATE TABLE IF NOT EXISTS lineup (
  match_id TEXT, team_id TEXT, player_id TEXT, status TEXT, kind TEXT,
  source TEXT, updated_at TEXT, detail TEXT,
  PRIMARY KEY (match_id, player_id, kind)
);
CREATE TABLE IF NOT EXISTS prediction (
  match_id TEXT, created_at TEXT, model_version TEXT, kind TEXT,
  data_cutoff TEXT, payload TEXT, payload_hash TEXT,
  PRIMARY KEY (match_id, created_at, kind)
);
CREATE INDEX IF NOT EXISTS ix_pred_match ON prediction(match_id);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS match_goal (
  match_id TEXT PRIMARY KEY, goals TEXT, source TEXT
);
"""


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def kv_get(con, k, default=None):
    r = con.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return json.loads(r[0]) if r else default


def kv_set(con, k, v):
    con.execute("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                (k, json.dumps(v)))


class Counter:
    def __init__(self):
        self.rows_in = self.rows_new = self.rows_changed = 0


def upsert_team(con, tid, league, canonical, display):
    con.execute("INSERT INTO team(id,league,canonical,display) VALUES(?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET display=excluded.display",
                (tid, league, canonical, display))


def match_id(league, season, home_id, away_id):
    # Una squadra ospita l'altra una sola volta per stagione: chiave stabile e permanente.
    code = season[2:4] + season[5:7]
    return f"{league}-{code}-{home_id.split('-', 1)[1]}-{away_id.split('-', 1)[1]}"


# Priorita' delle fonti per ciascun campo (indice piu' basso = piu' affidabile)
PRIORITY = {
    "kickoff": ["fdorg", "apifootball", "fdcouk", "openmatchday", "openfootball", "mirror", "fplcore", "legaseriea"],
    "result": ["fdcouk", "fdorg", "apifootball", "openmatchday", "legaseriea", "espn", "mirror", "openfootball", "fplcore"],
    "calendar": ["fdorg", "apifootball", "openfootball", "openmatchday", "fdcouk", "mirror", "fplcore", "legaseriea"],
}


def _better(field, new_src, old_src):
    if not old_src:
        return True
    order = PRIORITY[field]
    ni = order.index(new_src) if new_src in order else 99
    oi = order.index(old_src) if old_src in order else 99
    return ni <= oi


def upsert_match(con, cnt, *, league, season, home_id, away_id, source,
                 kickoff_utc=None, time_known=False, matchday=None, status=None,
                 fthg=None, ftag=None, hthg=None, htag=None, referee_id=None,
                 ext_fdorg=None, ext_apif=None):
    """Inserisce o aggiorna una partita senza creare duplicati.

    Restituisce l'id. Ogni campo viene sovrascritto solo da una fonte di pari o
    maggiore priorita'. La giornata originale non viene mai sovrascritta.
    """
    cnt.rows_in += 1
    mid = match_id(league, season, home_id, away_id)
    ts = now_iso()
    row = con.execute("SELECT * FROM match WHERE id=?", (mid,)).fetchone()
    if row is None:
        con.execute(
            "INSERT INTO match(id,league,season,matchday,matchday_orig,kickoff_utc,time_known,status,"
            "home_id,away_id,fthg,ftag,hthg,htag,referee_id,referee_src,src_calendar,src_result,"
            "ext_fdorg,ext_apif,first_seen,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mid, league, season, matchday, matchday, kickoff_utc, int(bool(time_known)),
             status or ("FINISHED" if fthg is not None else "SCHEDULED"), home_id, away_id,
             fthg, ftag, hthg, htag, referee_id, source if referee_id else None,
             source if kickoff_utc else None, source if fthg is not None else None,
             ext_fdorg, ext_apif, ts, ts))
        cnt.rows_new += 1
        return mid
    upd = {}
    if kickoff_utc and (_better("kickoff", source, row["src_calendar"]) or not row["kickoff_utc"]):
        # una data senza orario non sostituisce un orario gia' noto per lo stesso giorno
        if not (row["time_known"] and not time_known and row["kickoff_utc"][:10] == kickoff_utc[:10]):
            if kickoff_utc != row["kickoff_utc"]:
                upd["kickoff_utc"] = kickoff_utc
            if int(bool(time_known)) != row["time_known"]:
                upd["time_known"] = int(bool(time_known))
            upd["src_calendar"] = source
    if matchday is not None and row["matchday"] is None:
        upd["matchday"] = matchday
    if matchday is not None and row["matchday_orig"] is None:
        upd["matchday_orig"] = matchday
    if matchday is not None and row["matchday"] != matchday and _better("calendar", source, row["src_calendar"]):
        upd["matchday"] = matchday
    if fthg is not None and _better("result", source, row["src_result"]):
        for k, v in (("fthg", fthg), ("ftag", ftag), ("hthg", hthg), ("htag", htag)):
            if v is not None and row[k] != v:
                upd[k] = v
        upd["src_result"] = source
        if row["status"] != "FINISHED":
            upd["status"] = "FINISHED"
    if status and status != row["status"] and source in ("fdorg", "apifootball"):
        if not (row["status"] == "FINISHED" and status not in ("FINISHED", "AWARDED")):
            upd["status"] = status
    if referee_id and (not row["referee_id"] or row["referee_src"] != "fdcouk"):
        if row["referee_id"] != referee_id:
            upd["referee_id"] = referee_id
            upd["referee_src"] = source
    if ext_fdorg and row["ext_fdorg"] != ext_fdorg:
        upd["ext_fdorg"] = ext_fdorg
    if ext_apif and row["ext_apif"] != ext_apif:
        upd["ext_apif"] = ext_apif
    meaningful = {k for k in upd if k not in ("src_calendar", "src_result", "referee_src")}
    if upd:
        upd["updated_at"] = ts
        sets = ",".join(f"{k}=?" for k in upd)
        con.execute(f"UPDATE match SET {sets} WHERE id=?", (*upd.values(), mid))
        if meaningful:
            cnt.rows_changed += 1
    return mid


def upsert_stat(con, cnt, match_id_, side, team_id_, metric, value, source):
    if value is None:
        return
    row = con.execute("SELECT value, source FROM team_match_stat WHERE match_id=? AND side=? AND metric=?",
                      (match_id_, side, metric)).fetchone()
    if row is None:
        con.execute("INSERT INTO team_match_stat VALUES(?,?,?,?,?,?,?)",
                    (match_id_, side, team_id_, metric, float(value), source, now_iso()))
        cnt.rows_new += 1
    elif row["value"] != float(value) and (row["source"] == source or _better("result", source, row["source"])):
        con.execute("UPDATE team_match_stat SET value=?, source=?, updated_at=? WHERE match_id=? AND side=? AND metric=?",
                    (float(value), source, now_iso(), match_id_, side, metric))
        cnt.rows_changed += 1


def upsert_referee(con, name):
    from .teams import slug
    rid = "ref-" + slug(name)
    con.execute("INSERT OR IGNORE INTO referee(id,name) VALUES(?,?)", (rid, name))
    return rid
