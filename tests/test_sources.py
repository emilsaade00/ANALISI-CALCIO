"""Prove dei connettori con risposte simulate nel formato documentato delle fonti
(nessuna rete). Verifica: parsing, quote scartate, niente duplicati, correzioni."""
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline import db
from pipeline.teams import TeamResolver
from pipeline.sources import fdcouk, fdorg, apifootball

tmp = Path(tempfile.mkdtemp()) / "t.sqlite"
con = db.connect(tmp); R = TeamResolver(); cnt = db.Counter()

csv = ("Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,B365H,B365D,B365A,AvgH,B365>2.5,AHh\n"
       "I1,22/08/2026,17:30,Inter,Monza,4,1,H,1,1,D,20,8,9,3,10,14,7,2,1,3,0,0,1.25,6.5,11,1.27,1.5,-1.75\n")
n, ignored = fdcouk.ingest_csv(con, cnt, R, "sa", "2026-27", csv, "fdcouk")
assert n == 1 and set(ignored) == {"B365H", "B365D", "B365A", "AvgH", "B365>2.5", "AHh"}, ignored
cols = {r[0] for r in con.execute("SELECT DISTINCT metric FROM team_match_stat")}
assert not any("B365" in c or "Avg" in c for c in cols), cols
m = con.execute("SELECT * FROM match").fetchone()
assert m["id"] == "sa-2627-inter-monza" and m["kickoff_utc"] == "2026-08-22T16:30:00Z" and m["fthg"] == 4, dict(m)
# stessa riga di nuovo: nessun duplicato; poi una correzione del dato corner
fdcouk.ingest_csv(con, cnt, R, "sa", "2026-27", csv, "fdcouk")
assert con.execute("SELECT COUNT(*) FROM match").fetchone()[0] == 1
c2 = db.Counter()
fdcouk.ingest_csv(con, c2, R, "sa", "2026-27", csv.replace(",7,2,1,3", ",8,2,1,3"), "fdcouk")
assert c2.rows_changed == 1 and con.execute("SELECT value FROM team_match_stat WHERE metric='corner' AND side='H'").fetchone()[0] == 8

# football-data.org: rinvio e arbitro designato, nomi lunghi
payload = {"matches": [
  {"id": 1, "utcDate": "2026-11-22T19:45:00Z", "status": "TIMED", "matchday": 12,
   "homeTeam": {"name": "SSC Napoli"}, "awayTeam": {"name": "Torino FC"},
   "score": {"fullTime": {"home": None, "away": None}, "halfTime": {}}, "referees": [{"name": "Daniele Doveri", "type": "REFEREE"}]},
  {"id": 2, "utcDate": "2026-12-20T14:00:00Z", "status": "POSTPONED", "matchday": 11,
   "homeTeam": {"name": "FC Internazionale Milano"}, "awayTeam": {"name": "AC Milan"}, "score": {}, "referees": []}]}
fdorg.ingest(con, cnt, R, "sa", "2026-27", payload)
nap = con.execute("SELECT * FROM match WHERE id='sa-2627-napoli-torino'").fetchone()
assert nap["referee_id"] == "ref-daniele-doveri" and nap["matchday"] == 12
der = con.execute("SELECT * FROM match WHERE id='sa-2627-inter-milan'").fetchone()
assert der["status"] == "POSTPONED" and der["matchday_orig"] == 11

# API-Football: client simulato, nessuna chiamata a /odds o /predictions
from datetime import datetime, timedelta, timezone
YESTERDAY = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT15:00:00+00:00")
class Fake(apifootball.Client):
    def __init__(self): super().__init__(50); self.calls = []
    def get(self, path, **p):
        if any(path.startswith(f) for f in apifootball.FORBIDDEN): raise AssertionError("endpoint vietato")
        self.calls.append(path); self.used += 1
        if path == "/fixtures":
            return [{"fixture": {"id": 99, "referee": "M. Oliver, England", "date": YESTERDAY, "status": {"short": "FT"}},
                     "league": {"round": "Regular Season - 11"}, "teams": {"home": {"name": "Arsenal"}, "away": {"name": "Chelsea"}},
                     "score": {"halftime": {"home": 1, "away": 0}, "fulltime": {"home": 2, "away": 1}}}]
        if path == "/fixtures/statistics":
            return [{"team": {"name": "Arsenal"}, "statistics": [{"type": "Ball Possession", "value": "61%"}, {"type": "expected_goals", "value": "1.84"}, {"type": "Corner Kicks", "value": 7}, {"type": "Red Cards", "value": None}]},
                    {"team": {"name": "Chelsea"}, "statistics": [{"type": "Ball Possession", "value": "39%"}, {"type": "Corner Kicks", "value": 3}]}]
        if path == "/fixtures/players":
            return [{"team": {"name": "Arsenal"}, "players": [{"player": {"id": 7, "name": "B. Saka"}, "statistics": [{"games": {"minutes": 90, "position": "F", "substitute": False}, "shots": {"total": 4, "on": 2}, "goals": {"total": 1, "assists": None}, "passes": {"key": 3}, "fouls": {"drawn": 2, "committed": None}, "cards": {"yellow": 0, "red": 0}}]}]}]
        if path == "/fixtures/lineups":
            return [{"team": {"name": "Arsenal"}, "formation": "4-3-3", "startXI": [{"player": {"id": 7, "name": "B. Saka"}}], "substitutes": []}]
        return []
import pipeline.config as cfg
cfg.API_FOOTBALL_KEY = "x"
from datetime import datetime, timezone
fk = Fake()
apifootball.fetch(con, cnt, R, "pl", "2026-27", lambda m: None, client=fk)
st = {(r["side"], r["metric"]): r["value"] for r in con.execute("SELECT * FROM team_match_stat WHERE match_id='pl-2627-arsenal-chelsea'")}
assert st[("H", "possesso")] == 61 and st[("H", "xg")] == 1.84 and st[("H", "rossi")] == 0, st
ps = {r["metric"]: r["value"] for r in con.execute("SELECT * FROM player_match_stat")}
assert ps["tiri_porta"] == 2 and ps["assist"] == 0 and ps["titolare"] == 1, ps
assert con.execute("SELECT referee_id FROM match WHERE id='pl-2627-arsenal-chelsea'").fetchone()[0] == "ref-m-oliver"
assert not R.unknown, R.unknown
print("connettori OK:", fk.calls)

# open-matchday: orari UTC+1, corner per tempo, minuti dei gol, file di quote ignorati
import os
from pipeline.sources import openmatchday, fplcore
om = Path(tempfile.mkdtemp()); (om / "ITA_1_serie-a").mkdir()
(om / "ITA_1_serie-a" / "results_2627.csv").write_text(
    "gw,date,time,home,away,ft_home,ft_away,ft_result,ht_home,ht_away,ht_result,home_shots,away_shots,home_target,away_target,home_fouls,away_fouls,home_corners,away_corners,home_corners_1h,away_corners_1h,home_corners_2h,away_corners_2h,home_yellow,away_yellow,home_red,away_red,goal_minutes,source\n"
    "12,2026-11-21,15:00,Como,Cagliari,2,1,H,1,0,H,15,9,6,3,10,12,7,4,3,1,4,3,2,3,0,0,\"12,55,80\",fixturedl\n")
(om / "ITA_1_serie-a" / "odds_1x2_2627.csv").write_text("non,deve,essere,letto\n")
openmatchday.BASE = str(om)
con2 = db.connect(Path(tempfile.mkdtemp()) / "o.sqlite"); R2 = TeamResolver(); c3 = db.Counter()
openmatchday.fetch(con2, c3, R2, "sa", "2026-27", lambda m: None)
mm = con2.execute("SELECT * FROM match").fetchone()
assert mm["kickoff_utc"] == "2026-11-21T14:00:00Z" and mm["matchday"] == 12 and mm["fthg"] == 2, dict(mm)
st = {(r["side"], r["metric"]): r["value"] for r in con2.execute("SELECT * FROM team_match_stat")}
assert st[("H", "corner_1t")] == 3 and st[("A", "corner_2t")] == 3 and st[("H", "tiri_porta")] == 6
assert json.loads(con2.execute("SELECT goals FROM match_goal").fetchone()[0]) == [[12, None], [55, None], [80, None]]
try:
    openmatchday._get("ITA_1_serie-a", "odds_1x2", "2627"); raise SystemExit("file di quote letto!")
except AssertionError:
    pass

# FPL-Core: vuoto = zero solo se il campo esiste nella partita
fp = Path(tempfile.mkdtemp()); g = fp / "2026-2027" / "By Tournament" / "Premier League" / "GW1"; g.mkdir(parents=True)
(g / "teams.csv").write_text("code,id,name\n3,1,Arsenal\n94,4,Brentford\n")
(g / "matches.csv").write_text("gameweek,kickoff_time,home_team,away_team,home_score,away_score,finished,match_id,home_possession,away_possession,home_successful_dribbles,away_successful_dribbles,home_successful_dribbles_pct,away_successful_dribbles_pct,stats_processed,player_stats_processed\n"
                               "1,2026-08-22T14:00:00,3.0,94.0,2,0,True,x1,60,40,8,4,50,40,True,True\n")
(g / "players.csv").write_text("player_code,player_id,first_name,second_name,web_name,team_code,position\n100,1,Bukayo,Saka,Saka,3,Midfielder\n200,2,Mario,Rossi,Rossi,94,Defender\n")
(g / "playermatchstats.csv").write_text("player_id,match_id,minutes_played,total_shots,was_fouled,successful_dribbles,start_min\n1,x1,90,3,2,,0\n2,x1,90,,,,0\n")
fplcore.BASE = str(fp)
db.upsert_match(con2, c3, league="pl", season="2026-27", home_id="pl-arsenal", away_id="pl-brentford", source="openmatchday", kickoff_utc="2026-08-22T14:00:00Z")
fplcore.fetch(con2, c3, R2, "pl", "2026-27", lambda m: None)
ps = {(r["player_id"][:7], r["metric"]): r["value"] for r in con2.execute("SELECT * FROM player_match_stat")}
assert ps[("fpl-200", "tiri")] == 0 and ps[("fpl-200", "falli_subiti")] == 0, ps   # vuoto -> zero
assert ("fpl-200", "dribbling_riusciti") not in ps                                    # vuoto per tutti -> mancante
st = {(r["side"], r["metric"]): r["value"] for r in con2.execute("SELECT * FROM team_match_stat WHERE match_id='pl-2627-arsenal-brentford'")}
assert st[("H", "dribbling_tentati")] == 16 and st[("H", "possesso")] == 60, st
print("open-matchday e FPL-Core OK")
