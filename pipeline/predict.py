"""Generazione e salvataggio dei pronostici (ricostruiti e prima della gara) e taratura."""
import hashlib
import json
import math
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np

from . import config, db
from .model import (LeagueData, fit_metric, predict_metric, promoted_priors, iso_to_ts,
                    ts_to_iso, ll_count, DAY, metric_pmfs)


def load_matches(con):
    """Tutte le partite (anche future) con statistiche, raggruppate per campionato."""
    stats = defaultdict(lambda: defaultdict(dict))
    for r in con.execute("SELECT match_id, side, metric, value FROM team_match_stat"):
        stats[r["match_id"]][r["metric"]][r["side"]] = r["value"]
    out = defaultdict(list)
    for r in con.execute("SELECT * FROM match ORDER BY kickoff_utc"):
        out[r["league"]].append({
            "id": r["id"], "league": r["league"], "season": r["season"], "ko": r["kickoff_utc"],
            "home": r["home_id"], "away": r["away_id"], "fthg": r["fthg"], "ftag": r["ftag"],
            "hthg": r["hthg"], "htag": r["htag"], "referee": r["referee_id"], "status": r["status"],
            "matchday": r["matchday"], "stats": stats.get(r["id"], {}),
        })
    return out


def ht_share(ld, cutoff_ts, window=730 * DAY):
    xh, xa = ld.vals["gol_1t"]
    gh, ga = ld.vals["gol"]
    sel = (ld.ts < cutoff_ts) & (ld.ts >= cutoff_ts - window) & np.isfinite(xh)
    if sel.sum() < 50:
        return 0.44
    return float((xh[sel] + xa[sel]).sum() / max(1.0, (gh[sel] + ga[sel]).sum()))


def season_promoted(all_matches, league, season):
    seasons = sorted({m["season"] for m in all_matches[league]})
    if season not in seasons:
        return set()
    i = seasons.index(season)
    if i == 0:
        return set()
    prev = {m["home"] for m in all_matches[league] if m["season"] == seasons[i - 1]}
    cur = {m["home"] for m in all_matches[league] if m["season"] == season} | \
          {m["away"] for m in all_matches[league] if m["season"] == season}
    return cur - prev


class Predictor:
    def __init__(self, con, params_by_metric):
        self.con = con
        self.all = load_matches(con)
        self.lds = {lg: LeagueData(lg, ms) for lg, ms in self.all.items()}
        self.params = params_by_metric
        self._priors = {}

    def priors(self, season):
        if season not in self._priors:
            pm = {lg: ld.matches for lg, ld in self.lds.items()}
            self._priors[season] = promoted_priors(self.lds, season, pm)
        return self._priors[season]

    def predict_day(self, league, cutoff_ts, matches):
        """Un adattamento per giorno e campionato; pronostici per le partite indicate."""
        ld = self.lds[league]
        out = {}
        if not matches:
            return out
        season = matches[0]["season"]
        promoted = season_promoted(self.all, league, season)
        pri = self.priors(season)
        fits = {mt: fit_metric(ld, mt, cutoff_ts, self.params[mt], promoted, pri[mt])
                for mt in config.MODELLED_METRICS}
        share = ht_share(ld, cutoff_ts)
        last = max((f.last_ts for f in fits.values() if f.ok), default=None)
        for m in matches:
            ref = m.get("referee")
            payload = {"m": {}, "ht": round(share, 4),
                       "lu": ts_to_iso(last) if last else None, "ref": ref,
                       "pro": [m["home"] in promoted, m["away"] in promoted]}
            for mt, f in fits.items():
                payload["m"][mt] = predict_metric(f, ld, m["home"], m["away"], self.params[mt],
                                                  ref if mt in config.REFEREE_METRICS else None)
            out[m["id"]] = payload
        return out


def _hash(payload):
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _same(a, b):
    """Nuova versione solo se cambiano i dati usati (partite, arbitro) o una stima di oltre l'1%."""
    if a.get("ref") != b.get("ref") or set(a["m"]) != set(b["m"]):
        return False
    for k, x in a["m"].items():
        y = b["m"][k]
        if ("l" in x) != ("l" in y) or x.get("n") != y.get("n") or x.get("ref") != y.get("ref"):
            return False
        if "l" in x and any(abs(u - v) > 0.01 * max(v, 0.05) for u, v in zip(x["l"], y["l"])):
            return False
    return True


def save(con, match_id, kind, cutoff, payload, created=None):
    created = created or db.now_iso()
    h = _hash(payload)
    last = con.execute("SELECT payload_hash, payload FROM prediction WHERE match_id=? AND kind=? AND model_version=? "
                       "ORDER BY created_at DESC LIMIT 1", (match_id, kind, config.MODEL_VERSION)).fetchone()
    if last and (last["payload_hash"] == h or _same(payload, json.loads(last["payload"]))):
        return False
    con.execute("INSERT OR REPLACE INTO prediction VALUES(?,?,?,?,?,?,?)",
                (match_id, created, config.MODEL_VERSION, kind, cutoff, json.dumps(payload, separators=(",", ":")), h))
    return True


def day_cutoff(ko_iso):
    d = datetime.strptime(ko_iso[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return d.timestamp()


def run_backtest(con, pred, seasons, log, now_ts=None):
    """Pronostici ricostruiti: per ogni giorno di gara usa solo i dati delle partite precedenti.

    Vale per le partite gia' disputate (o con data passata) senza pronostico registrato prima della gara.
    """
    now_ts = now_ts or time.time()
    have = {r["match_id"] for r in con.execute(
        "SELECT DISTINCT match_id FROM prediction WHERE model_version=?", (config.MODEL_VERSION,))}
    made = 0
    for lg, ms in pred.all.items():
        by_day = defaultdict(list)
        for m in ms:
            if m["season"] not in seasons or m["id"] in have:
                continue
            if iso_to_ts(m["ko"]) > now_ts:
                continue
            by_day[m["ko"][:10]].append(m)
        for day in sorted(by_day):
            cut = day_cutoff(day + "T00:00:00")
            preds = pred.predict_day(lg, cut, by_day[day])
            for mid, p in preds.items():
                save(con, mid, "ricostruito", ts_to_iso(cut), p, created=db.now_iso())
                made += 1
    log(f"pronostici ricostruiti generati: {made}")
    return made


def run_live(con, pred, log, days_ahead=14, now_ts=None):
    """Pronostici registrati prima della gara per le partite dei prossimi giorni."""
    now_ts = now_ts or time.time()
    made = 0
    for lg, ms in pred.all.items():
        up = [m for m in ms if m["fthg"] is None and m["status"] not in ("CANCELLED",)
              and now_ts < iso_to_ts(m["ko"]) <= now_ts + days_ahead * DAY]
        if not up:
            continue
        preds = pred.predict_day(lg, now_ts, up)
        for mid, p in preds.items():
            if save(con, mid, "prepartita", ts_to_iso(now_ts), p):
                made += 1
    log(f"pronostici prima della gara salvati o aggiornati: {made}")
    return made


def tune(con, log, season=None):
    """Sceglie emivita e prudenza per ogni metrica massimizzando la verosimiglianza
    sulle partite della stagione di taratura (dati sempre precedenti alla gara)."""
    season = season or config.TUNING_SEASON
    grid_hl = [60, 120, 180, 270, 365]
    grid_k = [4.0, 8.0, 15.0, 25.0, 40.0, 70.0, 120.0]
    base = dict(config.MODEL_DEFAULTS)
    pred = Predictor(con, {mt: base for mt in config.MODELLED_METRICS})
    pri = pred.priors(season)
    results = {mt: {} for mt in config.MODELLED_METRICS}
    t0 = time.time()
    for lg, ld in pred.lds.items():
        promoted = season_promoted(pred.all, lg, season)
        days = sorted({m["ko"][:10] for m in ld.matches if m["season"] == season})
        idx_by_day = defaultdict(list)
        for i, m in enumerate(ld.matches):
            if m["season"] == season:
                idx_by_day[m["ko"][:10]].append(i)
        for hl in grid_hl:
            for k in grid_k:
                p = dict(base, half_life_days=hl, k_shrink=k)
                for day in days:
                    cut = day_cutoff(day + "T00:00:00")
                    for mt in config.MODELLED_METRICS:
                        f = fit_metric(ld, mt, cut, p, promoted, pri[mt])
                        if not f.ok:
                            continue
                        xh, xa = ld.vals[mt]
                        for i in idx_by_day[day]:
                            m = ld.matches[i]
                            if not (math.isfinite(xh[i]) and math.isfinite(xa[i])):
                                continue
                            mp = predict_metric(f, ld, m["home"], m["away"], p)
                            if "l" not in mp:
                                continue
                            # obiettivo: verosimiglianza per squadra + verosimiglianza del totale partita
                            ll = ll_count(xh[i], mp["l"][0], mp["r"]) + ll_count(xa[i], mp["l"][1], mp["r"])
                            _, _, pt = metric_pmfs(mp)
                            tot = int(round(xh[i] + xa[i]))
                            ll += math.log(max(pt[tot] if tot < len(pt) else 0.0, 1e-12))
                            s, n = results[mt].get((hl, k), (0.0, 0))
                            results[mt][(hl, k)] = (s + ll, n + 1)
    chosen, table = {}, {}
    for mt, res in results.items():
        if not res:
            chosen[mt] = base
            continue
        best = max(res, key=lambda key: res[key][0] / max(1, res[key][1]))
        chosen[mt] = dict(base, half_life_days=best[0], k_shrink=best[1])
        table[mt] = [{"emivita": hl, "k": k, "loglik_medio": round(s / max(1, n), 4), "partite": n}
                     for (hl, k), (s, n) in sorted(res.items())]
    log(f"taratura su {season} completata in {time.time() - t0:.0f}s: " +
        ", ".join(f"{mt}: emivita {c['half_life_days']}g, k={c['k_shrink']}" for mt, c in chosen.items()))
    db.kv_set(con, "params", {"season": season, "chosen": chosen, "table": table, "at": db.now_iso()})
    return chosen


def archive_export(con, log):
    """Scrive in data/pronostici/ tutti i pronostici registrati prima della gara (testo, versionato in git).
    I pronostici ricostruiti non servono: si rigenerano dai dati."""
    config.PRED_DIR.mkdir(parents=True, exist_ok=True)
    rows = con.execute("SELECT p.*, m.league, m.season FROM prediction p JOIN match m ON m.id=p.match_id "
                       "WHERE p.kind='prepartita' ORDER BY m.league, m.season, p.match_id, p.created_at").fetchall()
    by = {}
    for r in rows:
        by.setdefault(f"{r['league']}-{config.season_code(r['season'])}", []).append(json.dumps(
            {"match_id": r["match_id"], "created_at": r["created_at"], "model_version": r["model_version"],
             "kind": r["kind"], "data_cutoff": r["data_cutoff"], "payload": json.loads(r["payload"])},
            separators=(",", ":"), sort_keys=True))
    for key, lines in by.items():
        (config.PRED_DIR / f"{key}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"archivio pronostici: {len(rows)} pronostici prima della gara in {len(by)} file")


def archive_import(con, log):
    """Ricarica l'archivio nel database (utile quando il database viene ricostruito da zero)."""
    if not config.PRED_DIR.exists():
        return 0
    n = 0
    for f in sorted(config.PRED_DIR.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            o = json.loads(line)
            cur = con.execute("INSERT OR IGNORE INTO prediction VALUES(?,?,?,?,?,?,?)",
                              (o["match_id"], o["created_at"], o["model_version"], o["kind"], o["data_cutoff"],
                               json.dumps(o["payload"], separators=(",", ":")), _hash(o["payload"])))
            n += cur.rowcount
    if n:
        log(f"archivio pronostici: {n} pronostici ripristinati")
    return n
