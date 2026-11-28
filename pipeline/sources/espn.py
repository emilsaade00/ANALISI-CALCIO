"""ESPN: statistiche di ogni partita dei 4 campionati (stagione in corso), senza chiave.

Squadra: contrasti tentati e vinti, intercetti, spazzate, passaggi e cross (tentati e riusciti),
lanci lunghi, possesso, tiri, tiri in porta, falli, fuorigioco, corner, cartellini, parate.
Giocatore: falli commessi e subiti, tiri, tiri in porta, gol, assist, fuorigioco, autogol,
cartellini, titolare/subentrato; portieri: parate e gol subiti. Minuti ricavati dalle sostituzioni.

Serie A: i giocatori vengono abbinati a quelli dei Match Report ufficiali della Lega (numero di
maglia e nome) e ESPN aggiunge solo cio' che i report non hanno (falli commessi, fuorigioco,
titolari effettivi). Premier League: per i giocatori resta FPL-Core (piu' ricco); ESPN da' le
statistiche di squadra. Bundesliga e LaLiga: ESPN e' l'unica fonte dei giocatori.

Si leggono SOLO le sezioni header, boxscore, rosters e keyEvents della risposta: le sezioni
'odds' e 'pickcenter' (quote e pronostici) vengono scartate senza essere lette.
"""
import json
import os
import re
import time
import unicodedata
from collections import Counter
from datetime import date

from .. import config, db
from .common import http_get, SourceError

INFO = {
    "id": "espn", "name": "ESPN (statistiche partita)",
    "url": "https://www.espn.com/soccer/",
    "license": "Dati ESPN letti dall'interfaccia pubblica del sito (site.api.espn.com, non documentata); uso personale e non commerciale",
    "needs_key": 0, "key_env": "",
    "provides": "4 campionati: contrasti tentati/vinti/persi, intercetti, spazzate, passaggi, cross, possesso, falli per squadra; "
                "falli commessi e subiti, tiri, fuorigioco, cartellini e minuti per giocatore",
    "notes": "Stagione in corso. Minuti dei giocatori stimati dalle sostituzioni (recupero escluso) quando manca una fonte ufficiale. "
             "Le sezioni con quote presenti nella risposta vengono scartate.",
}
BASE = os.environ.get("CALCIO_ESPN_BASE", "https://site.api.espn.com/apis/site/v2/sports/soccer")
CODES = {"sa": "ita.1", "pl": "eng.1", "bl": "ger.1", "ll": "esp.1"}
PAUSE = float(os.environ.get("CALCIO_ESPN_PAUSE", "0.25"))
REFRESH_DAYS = 3  # le partite degli ultimi giorni si rileggono: ESPN corregge le statistiche dopo la gara

TEAM = {"foulsCommitted": "falli", "yellowCards": "gialli", "redCards": "rossi", "offsides": "fuorigioco",
        "wonCorners": "corner", "saves": "parate", "possessionPct": "possesso", "totalShots": "tiri",
        "shotsOnTarget": "tiri_porta", "accuratePasses": "passaggi_riusciti", "totalPasses": "passaggi",
        "accurateCrosses": "cross_riusciti", "totalCrosses": "cross", "totalLongBalls": "lanci_lunghi",
        "accurateLongBalls": "lanci_lunghi_riusciti", "effectiveTackles": "contrasti_vinti", "totalTackles": "contrasti",
        "interceptions": "intercetti", "totalClearance": "spazzate"}
PLAYER = {"foulsCommitted": "falli_commessi", "foulsSuffered": "falli_subiti", "ownGoals": "autogol",
          "redCards": "rossi", "yellowCards": "gialli", "goalAssists": "assist", "offsides": "fuorigioco",
          "shotsOnTarget": "tiri_porta", "totalGoals": "gol", "totalShots": "tiri"}
GK_ONLY = {"saves": "parate", "goalsConceded": "gol_subiti"}
# Serie A: metriche che ESPN aggiunge ai giocatori dei report ufficiali (gli altri valori restano quelli della Lega)
SA_EXTRA = ("falli_commessi", "fuorigioco", "autogol", "titolare")

ROLE = {"G": "Portiere", "GK": "Portiere"}
for _k in ("D", "DF", "CD", "CB", "LB", "RB", "WB", "LWB", "RWB", "SW", "LCB", "RCB", "FB"):
    ROLE[_k] = "Difensore"
for _k in ("M", "MF", "DM", "CM", "AM", "LM", "RM", "CDM", "CAM", "LCM", "RCM", "LDM", "RDM", "LAM", "RAM"):
    ROLE[_k] = "Centrocampista"
for _k in ("F", "FW", "CF", "ST", "S", "LW", "RW", "W", "SS", "LF", "RF", "A"):
    ROLE[_k] = "Attaccante"


def _get(url):
    time.sleep(PAUSE)
    return json.loads(http_get(url, headers={"Accept": "application/json"}))


def _months(season):
    """Mesi da agosto dell'anno di inizio stagione fino al mese corrente (al massimo giugno dell'anno dopo)."""
    y0 = int(season[:4])
    today = date.today()
    last = min((today.year, today.month), (y0 + 1, 6))
    out, y, m = [], y0, 8
    while (y, m) <= last:
        out.append(f"{y}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def _minute(clock):
    mt = re.match(r"\s*(\d+)", (clock or {}).get("displayValue") or "")
    return min(90, int(mt.group(1))) if mt else None


def compact(summary):
    """Riduce la risposta ESPN a cio' che serve. Legge solo header, boxscore, rosters, keyEvents."""
    comp = summary["header"]["competitions"][0]
    teams = {c["team"]["id"]: c.get("homeAway") for c in comp["competitors"]}
    names = {c.get("homeAway"): c["team"]["displayName"] for c in comp["competitors"]}
    out = {"date": comp.get("date"), "home": names.get("home"), "away": names.get("away"),
           "status": (comp.get("status") or {}).get("type", {}).get("completed"), "team": {}, "players": [], "subs": [], "reds": []}
    for t in (summary.get("boxscore") or {}).get("teams", []):
        side = teams.get(t["team"]["id"])
        if side:
            out["team"][side] = {x["name"]: x.get("displayValue") for x in t.get("statistics", []) if x.get("name") in TEAM}
    for r in summary.get("rosters") or []:
        side = r.get("homeAway") or teams.get((r.get("team") or {}).get("id"))
        for p in r.get("roster") or []:
            a = p.get("athlete") or {}
            st = {x.get("name"): x.get("value") for x in p.get("stats") or []}
            out["players"].append({"id": a.get("id"), "name": a.get("displayName"), "full": a.get("fullName"),
                                   "last": a.get("lastName"), "jersey": p.get("jersey"), "side": side,
                                   "pos": (p.get("position") or {}).get("abbreviation"), "starter": bool(p.get("starter")),
                                   "in": bool(p.get("subbedIn")), "out": bool(p.get("subbedOut")),
                                   "stats": {k: v for k, v in st.items() if k in PLAYER or k in GK_ONLY or k == "appearances"}})
    for k in summary.get("keyEvents") or []:
        txt = ((k.get("type") or {}).get("text") or "").lower()
        parts = [((x.get("athlete") or {}).get("id")) for x in k.get("participants") or []]
        mi = _minute(k.get("clock"))
        if "substitution" in txt and len(parts) >= 2:
            out["subs"].append([mi, parts[0], parts[1]])
        elif "red card" in txt and parts:
            out["reds"].append([mi, parts[0]])
    return out


def minutes(c):
    """Minuti giocati stimati: 90 per chi parte titolare, salvo sostituzione o espulsione."""
    start, end = {}, {}
    for p in c["players"]:
        if p["starter"]:
            start[p["id"]] = 0
    for mi, pin, pout in c["subs"]:
        if mi is None:
            continue
        start.setdefault(pin, mi)
        end[pout] = min(end.get(pout, 90), mi)
    for mi, pid in c["reds"]:
        if mi is not None:
            end[pid] = min(end.get(pid, 90), mi)
    return {pid: max(1, end.get(pid, 90) - s) for pid, s in start.items()}


def _n(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def name_score(lega, p):
    """Somiglianza tra il nome del report Lega (es. 'L. MARTINEZ', 'PEDRO GONCALVES') e quello ESPN."""
    L, full, last = _n(lega), _n(p.get("full") or p.get("name")), _n(p.get("last"))
    if not L:
        return 0
    if L in (full, _n(p.get("name"))) or (last and L == last):
        return 3
    first = full[: len(full) - len(last)].strip() if last and full.endswith(last) else full.split(" ")[0]
    tk = L.split()
    if len(tk) >= 2:
        if len(tk[0]) <= 2 and " ".join(tk[1:]) == last and first.startswith(tk[0]):
            return 2
        if len(tk[-1]) <= 2 and " ".join(tk[:-1]) == last and first.startswith(tk[-1]):
            return 2
    if last and (L.endswith(" " + last) or last.endswith(" " + L) or L in last.split()):
        return 1
    return 1 if L in full.split() else 0


def _role(pos):
    return ROLE.get((pos or "").split("-")[0].upper(), "Giocatore di movimento")


def _vote(stats, pid, pos):
    role = _role(pos)
    if role == "Giocatore di movimento":
        stats["sigle"][pos or "-"] += 1
        return
    stats["ruoli"].setdefault(pid, Counter())[role] += 1


def _apply(con, cnt, resolver, league, season, eid, c, log, unknown, stats):
    h = resolver.resolve(league, c["home"] or "", "espn", allow_new=False)
    a = resolver.resolve(league, c["away"] or "", "espn", allow_new=False)
    if not h or not a:
        unknown.update(x for x, t in ((c["home"], h), (c["away"], a)) if not t)
        return False
    mid = db.match_id(league, season, h, a)
    if not con.execute("SELECT 1 FROM match WHERE id=?", (mid,)).fetchone():
        return False
    tids = {"home": h, "away": a}
    for side, st in c["team"].items():
        for k, v in st.items():
            try:
                val = float(str(v).replace("%", ""))
            except ValueError:
                continue
            db.upsert_stat(con, cnt, mid, "H" if side == "home" else "A", tids[side], TEAM[k], val, "espn")
    mins = minutes(c)
    played = [p for p in c["players"] if p["id"] in mins and p["side"] in tids]
    if league == "pl" or not played:
        return True
    lega = {}
    if league == "sa":
        for r in con.execute("SELECT s.player_id, s.team_id, p.name, "
                             "(SELECT value FROM player_match_stat j WHERE j.match_id=s.match_id AND j.player_id=s.player_id AND j.metric='_maglia') AS maglia "
                             "FROM player_match_stat s JOIN player p ON p.id=s.player_id "
                             "WHERE s.match_id=? AND s.metric='minuti' AND s.source='legaseriea' AND s.value>0", (mid,)):
            lega.setdefault(r["team_id"], []).append(r)
    if lega:
        # report ufficiale presente: via eventuali righe ESPN provvisorie e abbinamento ai giocatori della Lega
        con.execute("DELETE FROM player_match_stat WHERE match_id=? AND source='espn' AND player_id LIKE 'espn-%'", (mid,))
    known = {r["ext_id"]: r["player_id"] for r in con.execute("SELECT ext_id, player_id FROM player_map WHERE source='espn'")}
    for p in played:
        tid = tids[p["side"]]
        gk = _role(p["pos"]) == "Portiere"
        vals = {PLAYER[k]: float(v) for k, v in p["stats"].items() if k in PLAYER and v is not None}
        if gk:
            vals.update({GK_ONLY[k]: float(v) for k, v in p["stats"].items() if k in GK_ONLY and v is not None})
        vals["titolare"] = 1.0 if p["starter"] else 0.0
        if lega:
            cands = lega.get(tid, [])
            scored = []
            for r in cands:
                s = name_score(r["name"], p)
                if r["maglia"] is not None and p.get("jersey") and str(int(r["maglia"])) == str(p["jersey"]).strip():
                    s += 3
                if known.get(p["id"]) == r["player_id"]:
                    s += 4
                scored.append((s, r["player_id"]))
            scored.sort(reverse=True)
            if not scored or scored[0][0] < 2 or (len(scored) > 1 and scored[1][0] == scored[0][0]):
                stats["non_abbinati"] += 1
                if len(stats["esempi"]) < 8:
                    stats["esempi"].append(f"{p['name']} #{p.get('jersey')}")
                continue
            stats["abbinati"] += 1
            pid = scored[0][1]
            con.execute("INSERT OR REPLACE INTO player_map(source, ext_id, player_id) VALUES('espn',?,?)", (p["id"], pid))
            known[p["id"]] = pid
            _vote(stats, pid, p["pos"])
            vals = {k: v for k, v in vals.items() if k in SA_EXTRA}
        else:
            pid = known.get(p["id"]) or f"espn-{p['id']}"
            stats["solo_espn"] += 1
            _vote(stats, pid, p["pos"])
            if pid.startswith("espn-"):
                con.execute("INSERT INTO player(id,name,team_id,position,source) VALUES(?,?,?,?,?) "
                            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, team_id=excluded.team_id, position=excluded.position",
                            (pid, p["name"], tid, _role(p["pos"]), "espn"))
            vals["minuti"] = float(mins[p["id"]])
        for metric, v in vals.items():
            con.execute("INSERT INTO player_match_stat VALUES(?,?,?,?,?,?) ON CONFLICT(match_id, player_id, metric) "
                        "DO UPDATE SET value=excluded.value, team_id=excluded.team_id, source=excluded.source "
                        "WHERE player_match_stat.source='espn' OR excluded.metric='titolare'",
                        (mid, pid, tid, metric, v, "espn"))
            cnt.rows_new += 1
    return True


def fetch(con, cnt, resolver, league, season, log):
    if season != config.CURRENT_SEASON or league not in CODES:
        return 0
    code = CODES[league]
    today = date.today().isoformat()
    events = []
    for ym in _months(season):
        try:
            sb = _get(f"{BASE}/{code}/scoreboard?dates={ym}")
        except SourceError as e:
            if "HTTP 400" in str(e):
                continue
            raise
        for e in sb.get("events", []):
            if ((e.get("status") or {}).get("type") or {}).get("completed"):
                events.append((e["id"], (e.get("date") or "")[:10]))
    cnt.rows_in += len(events)
    fetched = 0
    for eid, d in events:
        key = f"espn:{league}:{eid}"
        have = db.kv_get(con, key)
        recent = d and (date.fromisoformat(today) - date.fromisoformat(d)).days <= REFRESH_DAYS
        if have and not recent:
            continue
        try:
            s = _get(f"{BASE}/{code}/summary?event={eid}")
        except SourceError as e:
            log(f"{league}: partita {eid} non letta ({e})")
            continue
        s.pop("odds", None), s.pop("pickcenter", None)  # quote: mai lette ne' salvate
        db.kv_set(con, key, compact(s))
        fetched += 1
        if fetched % 25 == 0:
            con.commit()
    applied, unknown = 0, set()
    stats = {"abbinati": 0, "non_abbinati": 0, "solo_espn": 0, "esempi": [], "ruoli": {}, "sigle": Counter()}
    for r in con.execute("SELECT k, v FROM kv WHERE k LIKE ?", (f"espn:{league}:%",)).fetchall():
        if _apply(con, cnt, resolver, league, season, r["k"].split(":")[2], json.loads(r["v"]), log, unknown, stats):
            applied += 1
    # ruolo prevalente (difensore, centrocampista, attaccante) dalle posizioni in campo ESPN;
    # i portieri dei report Lega restano portieri
    for pid, cn in stats["ruoli"].items():
        role = cn.most_common(1)[0][0]
        if role != "Giocatore di movimento":
            con.execute("UPDATE player SET position=? WHERE id=? AND position != 'Portiere'", (role, pid))
    if stats["sigle"]:
        log(f"{league}: posizioni ESPN senza ruolo {dict(stats['sigle'].most_common(6))}")
    if unknown:
        log(f"{league}: squadre ESPN non riconosciute {sorted(unknown)}")
    log(f"{league} {season}: {len(events)} partite concluse su ESPN, {fetched} lette ora, {applied} abbinate")
    if league != "pl":
        log(f"{league} {season}: presenze giocatore abbinate ai report ufficiali {stats['abbinati']}, non abbinate {stats['non_abbinati']}"
            f"{' (es. ' + ', '.join(stats['esempi']) + ')' if stats['esempi'] else ''}, solo ESPN {stats['solo_espn']}")
    return applied
