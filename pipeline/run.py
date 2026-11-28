"""Aggiornamento completo: importa, ricalcola, verifica, esporta.

Uso:
  python -m pipeline.run                # aggiornamento quotidiano
  python -m pipeline.run --tune         # ripete anche la taratura dei parametri
  python -m pipeline.run --offline      # solo ricalcolo ed esportazione
"""
import argparse
import sys
import time
import traceback

from . import config, db
from .teams import TeamResolver
from .sources import fdcouk, openfootball, fdorg, apifootball, openmatchday, fplcore, designazioni, legaseriea, espn
from .sources.common import SourceError
from . import predict, evaluate, export

SOURCES = {
    "openfootball": (openfootball.INFO, openfootball.fetch),
    "fdcouk": (fdcouk.INFO, fdcouk.fetch),
    "mirror": (fdcouk.MIRROR_INFO, fdcouk.fetch_mirror),
    "openmatchday": (openmatchday.INFO, openmatchday.fetch),
    "fplcore": (fplcore.INFO, fplcore.fetch),
    "legaseriea": (legaseriea.INFO, legaseriea.fetch),
    "designazioni": (designazioni.INFO, designazioni.fetch),
    "espn": (espn.INFO, espn.fetch),
    "fdorg": (fdorg.INFO, fdorg.fetch),
    "apifootball": (apifootball.INFO, apifootball.fetch),
}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def has_stats(con, lg, s, sources):
    q = ("SELECT 1 FROM team_match_stat t JOIN match m ON m.id=t.match_id WHERE m.league=? AND m.season=? "
         f"AND t.metric='corner' AND t.source IN ({','.join('?' * len(sources))}) LIMIT 1")
    return con.execute(q, (lg, s, *sources)).fetchone() is not None


def has_matchdays(con, lg, s):
    r = con.execute("SELECT COUNT(*) n, SUM(matchday IS NOT NULL) k FROM match WHERE league=? AND season=?", (lg, s)).fetchone()
    return r["n"] > 0 and r["k"] == r["n"]


def seasons_for(sid, con, lg, failed):
    cur = config.CURRENT_SEASON
    if sid == "openfootball":
        return [s for s in config.SEASONS if s == cur or not has_matchdays(con, lg, s)]
    if sid == "fdcouk":
        return [s for s in config.SEASONS if s == cur or not has_stats(con, lg, s, ("fdcouk", "mirror"))]
    if sid == "mirror":
        out = [s for s in config.SEASONS if s != cur and not has_stats(con, lg, s, ("fdcouk", "mirror"))]
        if "fdcouk" in failed:  # riserva anche per la stagione corrente
            out.append(cur)
        return out
    if sid == "openmatchday":
        return [cur] if config.LEAGUES[lg].get("om") else []
    if sid == "fplcore":
        return [s for s in config.SEASONS if s >= "2025-26"] if config.LEAGUES[lg].get("fplcore") else []
    if sid == "legaseriea":
        return [cur] if lg == "sa" else []
    if sid == "designazioni":
        return [s for s in config.SEASONS if (config.MANUAL_DIR / f"designazioni_{lg}_{s}.csv").exists()]
    return [cur]


def fetch_all(con, resolver, run_id):
    failed = set()
    for sid, (info, fn) in SOURCES.items():
        started = db.now_iso()
        cnt = db.Counter()
        if sid not in config.SOURCES_ENABLED:
            status, msg = "saltata", "disattivata nella configurazione"
        elif info["needs_key"] and not {"fdorg": config.FOOTBALL_DATA_ORG_KEY,
                                         "apifootball": config.API_FOOTBALL_KEY}[sid]:
            status, msg = "saltata", f"chiave {info['key_env']} non configurata"
        else:
            ok, err, notes = 0, [], []
            client = apifootball.Client(config.API_FOOTBALL_DAILY_BUDGET) if sid == "apifootball" else None
            for lg in config.LEAGUES:
                for s in seasons_for(sid, con, lg, failed):
                    net = [e for e in err if "HTTP 404" not in e]
                    if not ok and len(net) >= 2:
                        err.append(f"{lg} {s}: non tentato (fonte irraggiungibile)")
                        continue
                    try:
                        if client:
                            fn(con, cnt, resolver, lg, s, lambda m: notes.append(m), client=client)
                        else:
                            fn(con, cnt, resolver, lg, s, lambda m: notes.append(m))
                        ok += 1
                        con.commit()
                    except SourceError as e:
                        if sid == "mirror" and "404" in str(e):
                            notes.append(f"{lg} {s}: stagione non presente nel mirror")
                            continue
                        err.append(f"{lg} {s}: {e}")
                    except Exception as e:  # dati malformati: non bloccare le altre fonti
                        err.append(f"{lg} {s}: {type(e).__name__}: {e}")
            for n in notes:
                log(f"  {sid}: {n}")
            if err and not ok:
                status = "errore"
                failed.add(sid)
            elif err:
                status = "parziale"
            else:
                status = "ok"
            msg = "; ".join(err[:4]) if err else (notes[-1] if notes else "nessuna stagione da aggiornare")
            for e in err:
                log(f"  {sid} ERRORE {e}")
        con.execute("INSERT INTO source_run(run_id,source_id,started_at,finished_at,status,rows_in,rows_new,rows_changed,message) "
                    "VALUES(?,?,?,?,?,?,?,?,?)", (run_id, sid, started, db.now_iso(), status, cnt.rows_in,
                                                  cnt.rows_new, cnt.rows_changed, msg[:500]))
        con.commit()
        log(f"{info['name']}: {status} — righe lette {cnt.rows_in}, nuove {cnt.rows_new}, corrette {cnt.rows_changed}")
    return failed


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tune", action="store_true")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--trigger", default="manuale")
    ap.add_argument("--nota", default=None, help="nota sull'ambiente da mostrare nell'app")
    ap.add_argument("--pianificazione", default=None, help="descrizione dell'aggiornamento automatico")
    a = ap.parse_args(argv)
    con = db.connect(config.DB_PATH)
    for sid, (info, _) in SOURCES.items():
        con.execute("INSERT OR REPLACE INTO source(id,name,url,license,needs_key,key_env,provides,notes) VALUES(?,?,?,?,?,?,?,?)",
                    (info["id"], info["name"], info["url"], info["license"], info["needs_key"], info["key_env"],
                     info["provides"], info["notes"]))
    if a.nota is not None:
        db.kv_set(con, "nota_ambiente", a.nota or None)
    if a.pianificazione is not None:
        db.kv_set(con, "pianificazione", a.pianificazione or None)
    cur = con.execute("INSERT INTO update_run(started_at,status,trigger) VALUES(?,?,?)",
                      (db.now_iso(), "in corso", a.trigger))
    run_id = cur.lastrowid
    con.commit()
    resolver = TeamResolver()
    try:
        predict.archive_import(con, log)
        failed = set() if a.offline else fetch_all(con, resolver, run_id)
        params = db.kv_get(con, "params")
        if a.tune or not params:
            chosen = predict.tune(con, log)
        else:
            chosen = params["chosen"]
        pred = predict.Predictor(con, chosen)
        db.kv_set(con, "priors", {s: pred.priors(s) for s in config.EVAL_SEASONS})
        predict.run_backtest(con, pred, config.EVAL_SEASONS, log)
        predict.run_live(con, pred, log)
        con.commit()
        predict.archive_export(con, log)
        ev = evaluate.evaluate(con, log)
        if a.offline:
            status, msg = "ricalcolo", "solo ricalcolo, nessuna fonte interrogata"
        else:
            status = "parziale" if failed else "ok"
            msg = ("fonti non riuscite: " + ", ".join(sorted(failed))) if failed else "completato"
        con.execute("UPDATE update_run SET finished_at=?, status=?, message=? WHERE id=?",
                    (db.now_iso(), status, msg, run_id))
        con.commit()
        export.export(con, ev, {sid: info for sid, (info, _) in SOURCES.items()}, resolver, log)
        log(f"aggiornamento {status}: {msg}")
        return 0
    except Exception as e:
        traceback.print_exc()
        con.execute("UPDATE update_run SET finished_at=?, status=?, message=? WHERE id=?",
                    (db.now_iso(), "errore", f"{type(e).__name__}: {e}"[:500], run_id))
        con.commit()
        return 1


if __name__ == "__main__":
    sys.exit(main())
