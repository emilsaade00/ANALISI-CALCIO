"""Esporta il database in file JSON letti dall'app web (nessun server necessario)."""
import json
import time
from collections import defaultdict
from datetime import datetime, timezone

from . import config, db, catalog
from .evaluate import choose_predictions
from .model import iso_to_ts


def _w(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size


def export(con, evaluation, sources_info, resolver, log, now_ts=None):
    now_ts = now_ts or time.time()
    out = config.EXPORT_DIR
    sizes = {}
    teams = {r["id"]: [r["canonical"], r["display"]] for r in con.execute("SELECT * FROM team")}
    refs = {r["id"]: r["name"] for r in con.execute("SELECT * FROM referee")}
    stats = defaultdict(lambda: defaultdict(lambda: [None, None]))
    for r in con.execute("SELECT match_id, side, metric, value FROM team_match_stat"):
        v = r["value"]
        stats[r["match_id"]][r["metric"]][0 if r["side"] == "H" else 1] = int(v) if v == int(v) else round(v, 3)
    goals = {r["match_id"]: json.loads(r["goals"]) for r in con.execute("SELECT * FROM match_goal")}
    chosen = choose_predictions(con)
    latest = {}
    nsnap = defaultdict(int)
    for r in con.execute("SELECT match_id, created_at, kind, data_cutoff, payload FROM prediction "
                         "WHERE model_version=? ORDER BY created_at", (config.MODEL_VERSION,)):
        latest[r["match_id"]] = r
        nsnap[r["match_id"]] += 1

    coverage, fresh = {}, {}
    leagues_meta = []
    for lg, info in config.LEAGUES.items():
        seasons_present = [s for s in config.SEASONS if con.execute(
            "SELECT 1 FROM match WHERE league=? AND season=? LIMIT 1", (lg, s)).fetchone()]
        leagues_meta.append({"code": lg, "name": info["name"], "country": info["country"],
                             "seasons": seasons_present, "current": config.CURRENT_SEASON,
                             "predicted": [s for s in seasons_present if s in config.EVAL_SEASONS]})
        for s in seasons_present:
            rows = con.execute("SELECT * FROM match WHERE league=? AND season=? ORDER BY kickoff_utc", (lg, s)).fetchall()
            ms, used_teams, used_refs = [], set(), set()
            preds = {}
            for r in rows:
                g = [r["fthg"], r["ftag"]] if r["fthg"] is not None else None
                ht = [r["hthg"], r["htag"]] if r["hthg"] is not None else None
                o = {"i": r["id"], "md": r["matchday"], "mo": r["matchday_orig"], "ko": r["kickoff_utc"],
                     "tk": r["time_known"], "st": r["status"], "h": r["home_id"], "a": r["away_id"],
                     "g": g, "ht": ht, "r": r["referee_id"], "s": dict(stats.get(r["id"], {})),
                     "src": [r["src_calendar"], r["src_result"]]}
                if r["id"] in goals:
                    o["gm"] = goals[r["id"]]
                if r["referee_src"]:
                    o["rs"] = r["referee_src"]
                ms.append(o)
                used_teams.update([r["home_id"], r["away_id"]])
                if r["referee_id"]:
                    used_refs.add(r["referee_id"])
                pr = chosen.get(r["id"]) if g else None
                if pr is None and r["id"] in latest:
                    lr = latest[r["id"]]
                    if not g or lr["created_at"] < r["kickoff_utc"] or lr["kind"] == "ricostruito":
                        pr = lr
                if pr is not None:
                    preds[r["id"]] = {"t": pr["created_at"], "k": pr["kind"], "c": pr["data_cutoff"],
                                      "v": config.MODEL_VERSION, "ns": nsnap[r["id"]], "p": json.loads(pr["payload"])}
            code = config.season_code(s)
            sizes[f"m/{lg}-{code}"] = _w(out / "m" / f"{lg}-{code}.json", {
                "league": lg, "season": s, "teams": {t: teams.get(t, [t, t]) for t in used_teams},
                "referees": {x: refs[x] for x in used_refs if x in refs}, "matches": ms})
            if preds:
                sizes[f"p/{lg}-{code}"] = _w(out / "p" / f"{lg}-{code}.json", preds)
            # copertura per metrica
            played = [m for m in ms if m["g"]]
            cov = {"partite": len(ms), "giocate": len(played)}
            mets = defaultdict(int)
            for m in played:
                for k, v in m["s"].items():
                    if v[0] is not None and v[1] is not None:
                        mets[k] += 1
                if m["ht"]:
                    mets["primo_tempo"] += 1
                if m["r"]:
                    mets["arbitro"] += 1
            cov["metriche"] = dict(mets)
            coverage.setdefault(lg, {})[s] = cov
            if s == config.CURRENT_SEASON:
                last = max((m["ko"] for m in played), default=None)
                late = [m for m in ms if not m["g"] and m["st"] not in ("POSTPONED", "CANCELLED")
                        and iso_to_ts(m["ko"]) < now_ts - 36 * 3600]
                nostats = [m for m in played if not m["s"].get("corner")]
                fresh[lg] = {"ultimo_risultato": last, "senza_risultato": len(late),
                             "prima_senza_risultato": min((m["ko"] for m in late), default=None),
                             "giocate_senza_statistiche": len(nostats), "in_ritardo": len(late) > 0}
            # giocatori (solo se una fonte li fornisce)
            pl = con.execute("SELECT DISTINCT p.* FROM player p JOIN player_match_stat s ON s.player_id=p.id "
                             "JOIN match m ON m.id=s.match_id WHERE m.league=? AND m.season=?", (lg, s)).fetchall()
            lu = con.execute("SELECT l.* FROM lineup l JOIN match m ON m.id=l.match_id WHERE m.league=? AND m.season=?",
                             (lg, s)).fetchall()
            if pl or lu:
                pst = defaultdict(dict)
                for r in con.execute("SELECT s.* FROM player_match_stat s JOIN match m ON m.id=s.match_id "
                                     "WHERE m.league=? AND m.season=?", (lg, s)):
                    pst[(r["match_id"], r["player_id"], r["team_id"])][r["metric"]] = r["value"]
                pnames = {r["id"]: [r["name"], r["team_id"], r["position"]] for r in con.execute(
                    "SELECT * FROM player WHERE id IN (SELECT player_id FROM lineup UNION SELECT player_id FROM player_match_stat)")}
                lus = defaultdict(list)
                for r in lu:
                    lus[r["match_id"]].append([r["player_id"], r["team_id"], r["status"], r["kind"], r["detail"], r["updated_at"], r["source"]])
                metrics = sorted({k for v in pst.values() for k in v})
                mids = sorted({k[0] for k in pst}); pids = sorted({k[1] for k in pst} | {r[0] for v in lus.values() for r in v})
                tids = sorted({k[2] for k in pst} | {r[1] for v in lus.values() for r in v})
                mi = {x: i for i, x in enumerate(mids)}; pi = {x: i for i, x in enumerate(pids)}; ti = {x: i for i, x in enumerate(tids)}
                cv = lambda v: None if v is None else (int(v) if v == int(v) else round(v, 2))
                rows = [[mi[k[0]], pi[k[1]], ti[k[2]]] + [cv(v.get(mm)) for mm in metrics] for k, v in pst.items()]
                NAMES = {"fplcore": "FPL-Core-Insights (FotMob, Fantasy Premier League)", "apifootball": "API-Football", "legaseriea": "Match Report ufficiali Lega Serie A"}
                fonte = ", ".join(sorted({NAMES.get(x[0], x[0]) for x in con.execute(
                    "SELECT DISTINCT s.source FROM player_match_stat s JOIN match m ON m.id=s.match_id WHERE m.league=? AND m.season=?", (lg, s))}))
                sizes[f"pl/{lg}-{code}"] = _w(out / "pl" / f"{lg}-{code}.json", {
                    "fonte": fonte, "metrics": metrics, "mids": mids, "pids": pids, "tids": tids,
                    "players": {p: pnames.get(p, [p, None, None]) for p in pids}, "rows": rows, "lineups": lus})

    # stato fonti
    fonti = []
    for sid, info in sources_info.items():
        last = con.execute("SELECT * FROM source_run WHERE source_id=? ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
        ok = con.execute("SELECT finished_at FROM source_run WHERE source_id=? AND status IN ('ok','parziale') "
                         "ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
        key_set = bool(info["key_env"]) and bool({"FOOTBALL_DATA_ORG_KEY": config.FOOTBALL_DATA_ORG_KEY,
                                                    "API_FOOTBALL_KEY": config.API_FOOTBALL_KEY}.get(info["key_env"]))
        fonti.append({**info, "key_configured": key_set,
                      "stato": last["status"] if last else "mai eseguita",
                      "ultimo_tentativo": last["finished_at"] if last else None,
                      "ultimo_successo": ok["finished_at"] if ok else None,
                      "messaggio": last["message"] if last else "",
                      "righe": [last["rows_in"], last["rows_new"], last["rows_changed"]] if last else None})
    runs = [dict(r) for r in con.execute("SELECT * FROM update_run ORDER BY id DESC LIMIT 15")]
    last_ok = con.execute("SELECT finished_at FROM update_run WHERE status IN ('ok','parziale') "
                          "ORDER BY id DESC LIMIT 1").fetchone()
    avvisi = []
    it = lambda iso: f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}" if iso else "-"
    for lg, f in fresh.items():
        name = config.LEAGUES[lg]["name"]
        if f["in_ritardo"]:
            avvisi.append({"livello": "ritardo", "lega": lg, "n": f["senza_risultato"], "ultimo": f["ultimo_risultato"],
                           "testo": f"{name}: {f['senza_risultato']} partite gia' disputate senza risultato importato "
                                    f"(dalla gara del {it(f['prima_senza_risultato'])}). Ultimo risultato disponibile: {it(f['ultimo_risultato'])}."})
        if f["giocate_senza_statistiche"]:
            avvisi.append({"livello": "mancante", "lega": lg, "n": f["giocate_senza_statistiche"],
                           "testo": f"{name}: {f['giocate_senza_statistiche']} partite con risultato ma senza statistiche (tiri, corner, falli, cartellini)."})
    for fo in fonti:
        if fo["stato"] == "errore":
            avvisi.append({"livello": "fonte", "testo": f"{fo['name']}: ultimo aggiornamento non riuscito ({fo['messaggio']})."})
        if fo["needs_key"] and not fo["key_configured"]:
            avvisi.append({"livello": "info", "testo": f"{fo['name']} non attiva: manca la chiave {fo['key_env']}."})
    unknown = sorted({(lg, n) for lg, n, _ in resolver.unknown})
    if unknown:
        avvisi.append({"livello": "mancante", "testo": "Nomi squadra non riconosciuti: " +
                       ", ".join(f"{n} ({lg})" for lg, n in unknown[:12])})
    params = db.kv_get(con, "params", {})
    meta = {
        "generato": db.now_iso(), "ultimo_aggiornamento_riuscito": last_ok["finished_at"] if last_ok else None,
        "versione_modello": config.MODEL_VERSION, "fuso": config.TZ_DISPLAY,
        "stagione_corrente": config.CURRENT_SEASON, "stagione_taratura": config.TUNING_SEASON,
        "stagioni_valutazione": config.EVAL_SEASONS,
        "campionati": leagues_meta, "fonti": fonti, "avvisi": avvisi, "copertura": coverage,
        "freschezza": fresh, "aggiornamenti": runs,
        "catalogo": catalog.TEAM_METRICS,
        "metriche_giocatore": [{"code": c, "name": n, "cat": k, "per90": p} for c, n, k, p in catalog.PLAYER_METRICS],
        "rapporti_giocatore": [{"code": c, "name": n, "num": a, "den": b, "cat": k} for c, n, a, b, k in catalog.PLAYER_RATIOS],
        "metriche_giocatore_na": [{"code": c, "name": n, "nota": t} for c, n, t in catalog.PLAYER_NA],
        "metriche_arbitro": [{"code": c, "name": n} for c, n in catalog.REFEREE_METRICS],
        "parametri": params, "priori_neopromosse": db.kv_get(con, "priors", {}),
        "dati_dimostrativi": False,
        "nota_ambiente": db.kv_get(con, "nota_ambiente", None),
        "pianificazione": db.kv_get(con, "pianificazione", None) or config.SCHEDULE_NOTE,
        "file": sorted(k for k in sizes if "/" in k),
    }
    sizes["meta"] = _w(out / "meta.json", meta)
    sizes["eval"] = _w(out / "eval.json", evaluation)
    log("esportazione: " + ", ".join(f"{k} {v // 1024}KB" for k, v in sorted(sizes.items()) if v > 150_000) +
        f" ({len(sizes)} file, {sum(sizes.values()) // 1024} KB in totale)")
    return meta
