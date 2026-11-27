"""Verifica del modello su partite successive ai dati usati per stimarlo.

Per ogni partita conclusa si usa l'ultimo pronostico salvato PRIMA del calcio d'inizio
(oppure quello ricostruito con i soli dati precedenti). Confronto con una previsione
semplice basata sulle medie del campionato (stessa distribuzione, nessun dato di squadra).
"""
import json
import math
from collections import defaultdict

from . import config
from .events import events, outcome, family_group

BINS = [i / 10 for i in range(11)]


def choose_predictions(con):
    rows = con.execute(
        "SELECT p.match_id, p.created_at, p.kind, p.data_cutoff, p.payload, m.kickoff_utc "
        "FROM prediction p JOIN match m ON m.id=p.match_id WHERE p.model_version=? ORDER BY p.created_at",
        (config.MODEL_VERSION,)).fetchall()
    best = {}
    for r in rows:
        ko = r["kickoff_utc"]
        if r["kind"] == "prepartita" and r["created_at"] >= ko:
            continue  # mai usare un pronostico creato dopo il calcio d'inizio
        cur = best.get(r["match_id"])
        rank = 2 if r["kind"] == "prepartita" else 1
        if cur is None or rank > cur[0] or (rank == cur[0] and r["created_at"] > cur[1]["created_at"]):
            best[r["match_id"]] = (rank, r)
    return {k: v[1] for k, v in best.items()}


def result_of(con, mid):
    m = con.execute("SELECT * FROM match WHERE id=?", (mid,)).fetchone()
    if m is None or m["fthg"] is None:
        return None, m
    res = {"gol": [m["fthg"], m["ftag"]], "gol_1t": [m["hthg"], m["htag"]]}
    st = defaultdict(dict)
    for r in con.execute("SELECT side, metric, value FROM team_match_stat WHERE match_id=?", (mid,)):
        st[r["metric"]][r["side"]] = r["value"]
    for k in ("corner", "tiri", "tiri_porta", "falli"):
        if "H" in st[k] and "A" in st[k]:
            res[k] = [st[k]["H"], st[k]["A"]]
    if all(s in st["gialli"] and s in st["rossi"] for s in "HA"):
        res["cartellini"] = [st["gialli"]["H"] + st["rossi"]["H"], st["gialli"]["A"] + st["rossi"]["A"]]
    return res, m


class Acc:
    def __init__(self):
        self.n = 0
        self.bm = self.bb = self.lm = self.lb = 0.0
        self.bins = [[0, 0.0, 0] for _ in range(10)]  # n, somma prob, verificati
        self.matches = set()

    def add(self, p, pb, y, mid):
        p = min(max(p, 1e-6), 1 - 1e-6)
        pb = min(max(pb, 1e-6), 1 - 1e-6)
        self.n += 1
        self.matches.add(mid)
        self.bm += (p - y) ** 2
        self.bb += (pb - y) ** 2
        self.lm += -math.log(p if y else 1 - p)
        self.lb += -math.log(pb if y else 1 - pb)
        b = min(int(p * 10), 9)
        self.bins[b][0] += 1
        self.bins[b][1] += p
        self.bins[b][2] += y

    def out(self):
        if not self.n:
            return None
        ece = sum(abs(b[1] - b[2]) for b in self.bins) / self.n
        return {"n": self.n, "partite": len(self.matches),
                "brier": round(self.bm / self.n, 4), "brier_base": round(self.bb / self.n, 4),
                "skill": round(1 - self.bm / self.bb, 4) if self.bb else None,
                "logloss": round(self.lm / self.n, 4), "logloss_base": round(self.lb / self.n, 4),
                "ece": round(ece, 4),
                "bins": [{"da": i / 10, "a": (i + 1) / 10, "n": b[0],
                          "p_media": round(b[1] / b[0], 4) if b[0] else None,
                          "verificati": b[2], "freq": round(b[2] / b[0], 4) if b[0] else None}
                         for i, b in enumerate(self.bins)]}


def reliability_label(o):
    """Affidabilita' del modello per un tipo di evento (separata dalla probabilita')."""
    if not o or o["n"] < 150:
        return "non valutabile"
    sk, ece = o["skill"] or 0, o["ece"]
    if o["partite"] >= 300 and sk > 0.03 and ece < 0.035:
        return "alta"
    if sk > 0.0 and ece < 0.06:
        return "media"
    return "bassa"


def evaluate(con, log):
    chosen = choose_predictions(con)
    acc = defaultdict(Acc)
    per_match = {}
    for mid, r in chosen.items():
        res, m = result_of(con, mid)
        if res is None:
            continue
        if m["season"] not in config.EVAL_SEASONS:
            continue
        pred = json.loads(r["payload"])
        ev = events(pred)
        base = {(f, k): p for f, k, _, p in events(pred, baseline=True)}
        lg = m["league"]
        hits = []
        for fam, key, k, p in ev:
            y = outcome(fam, key, k, res)
            if y is None or (fam, key) not in base:
                continue
            pb = base[(fam, key)]
            y = 1 if y else 0
            grp = family_group(fam)
            for scope in ((lg, fam), ("tutti", fam), (lg, "G:" + grp), ("tutti", "G:" + grp), (lg, "*"), ("tutti", "*")):
                acc[scope].add(p, pb, y, mid)
            hits.append([fam, key, round(p, 4), y])
        per_match[mid] = {"kind": r["kind"], "created": r["created_at"]}
    out = {"by": {}, "reliability": {}}
    for (lg, fam), a in acc.items():
        o = a.out()
        out["by"].setdefault(lg, {})[fam] = o
        if not fam.startswith("G:") and fam != "*":
            out["reliability"].setdefault(lg, {})[fam] = reliability_label(o)
    out["n_partite"] = len({mid for mid in per_match})
    out["stagioni"] = config.EVAL_SEASONS
    kinds = defaultdict(int)
    for v in per_match.values():
        kinds[v["kind"]] += 1
    out["tipi"] = dict(kinds)
    log(f"valutazione: {out['n_partite']} partite ({dict(kinds)})")
    return out
