"""Eventi derivati dal pronostico salvato. La stessa logica e' replicata in web/model.js
(il test tests/test_parity.py verifica che i due calcoli coincidano)."""
import math

import numpy as np

from .model import pmf_poisson, metric_pmfs

GOAL_N = 10

METRIC_LABEL = {"corner": "corner", "tiri": "tiri", "tiri_porta": "tiri in porta",
                "falli": "falli", "cartellini": "cartellini"}
FAMILY_NAMES = {
    "1x2": "Esito finale", "dc": "Doppia chance", "gol_tot_ge": "Gol totali (almeno)",
    "gol_tot_le": "Gol totali (al massimo)", "gol_h_ge": "Gol squadra di casa", "gol_a_ge": "Gol squadra ospite",
    "btts": "Entrambe a segno", "cs_h": "Porta inviolata casa", "cs_a": "Porta inviolata ospite",
    "gol_1t_ge": "Gol nel primo tempo", "score": "Risultato esatto",
    "corner_tot_ge": "Corner totali (almeno)", "corner_tot_le": "Corner totali (al massimo)",
    "corner_h_ge": "Corner squadra di casa", "corner_a_ge": "Corner squadra ospite", "corner_piu": "Squadra con piu' corner",
    "tiri_tot_ge": "Tiri totali", "tiri_h_ge": "Tiri squadra di casa", "tiri_a_ge": "Tiri squadra ospite",
    "tiri_porta_tot_ge": "Tiri in porta totali", "tiri_porta_h_ge": "Tiri in porta casa", "tiri_porta_a_ge": "Tiri in porta ospite",
    "falli_tot_ge": "Falli totali", "falli_h_ge": "Falli squadra di casa", "falli_a_ge": "Falli squadra ospite",
    "cartellini_tot_ge": "Cartellini totali", "cartellini_h_ge": "Cartellini squadra di casa", "cartellini_a_ge": "Cartellini squadra ospite",
}


def score_matrix(lh, la):
    ph, pa = pmf_poisson(lh, GOAL_N), pmf_poisson(la, GOAL_N)
    M = np.outer(ph, pa)
    return M / M.sum()


def _ge(p, k):
    return float(p[k:].sum()) if k < len(p) else 0.0


def _range(p, lo_min=0, span=2.2):
    mean = float((np.arange(len(p)) * p).sum())
    sd = math.sqrt(max(float((np.arange(len(p)) ** 2 * p).sum()) - mean ** 2, 0.25))
    lo = max(lo_min, int(math.floor(mean - span * sd)))
    hi = max(lo + 1, int(math.ceil(mean + span * sd)))
    return range(lo, hi + 1)


def events(pred, baseline=False):
    """Lista di (famiglia, chiave, k, probabilita'). baseline=True usa solo le medie di campionato."""
    out = []
    m = pred["m"]
    g = m.get("gol", {})
    if "l" in g:
        lh, la = (g["mu"] if baseline else g["l"])
        M = score_matrix(lh, la)
        p1 = float(np.tril(M, -1).sum()); px = float(np.trace(M)); p2 = float(np.triu(M, 1).sum())
        out += [("1x2", "1", None, p1), ("1x2", "X", None, px), ("1x2", "2", None, p2)]
        out += [("dc", "1X", None, p1 + px), ("dc", "X2", None, px + p2), ("dc", "12", None, p1 + p2)]
        tot = np.zeros(2 * GOAL_N + 1)
        for i in range(GOAL_N + 1):
            for j in range(GOAL_N + 1):
                tot[i + j] += M[i, j]
        for k in range(1, 7):
            out.append(("gol_tot_ge", f"ge{k}", k, _ge(tot, k)))
        for k in range(0, 5):
            out.append(("gol_tot_le", f"le{k}", k, float(tot[:k + 1].sum())))
        ph, pa = M.sum(1), M.sum(0)
        for k in range(1, 5):
            out.append(("gol_h_ge", f"ge{k}", k, _ge(ph, k)))
            out.append(("gol_a_ge", f"ge{k}", k, _ge(pa, k)))
        btts = float(M[1:, 1:].sum())
        out += [("btts", "si", None, btts), ("btts", "no", None, 1 - btts)]
        out += [("cs_h", "si", None, float(pa[0])), ("cs_a", "si", None, float(ph[0]))]
        share = pred.get("ht", 0.44)
        p1t = pmf_poisson((lh + la) * share, 12)
        for k in range(1, 4):
            out.append(("gol_1t_ge", f"ge{k}", k, _ge(p1t, k)))
        Mref = score_matrix(*g["l"])  # i risultati elencati dipendono dal pronostico
        flat = sorted(((float(Mref[i, j]), i, j) for i in range(7) for j in range(7)), reverse=True)[:6]
        for _, i, j in flat:
            out.append(("score", f"{i}-{j}", None, float(M[i, j])))
    for metric in ("corner", "tiri", "tiri_porta", "falli", "cartellini"):
        mp = m.get(metric, {})
        if "l" not in mp:
            continue
        ph, pa, pt = metric_pmfs(mp, use_mu=baseline)
        ref_ph, ref_pa, ref_pt = metric_pmfs(mp)  # le soglie dipendono dal pronostico, non dal baseline
        for k in _range(ref_pt, 1):
            out.append((f"{metric}_tot_ge", f"ge{k}", k, _ge(pt, k)))
        for k in _range(ref_ph, 1):
            out.append((f"{metric}_h_ge", f"ge{k}", k, _ge(ph, k)))
        for k in _range(ref_pa, 1):
            out.append((f"{metric}_a_ge", f"ge{k}", k, _ge(pa, k)))
        if metric == "corner":
            for k in _range(ref_pt, 1):
                out.append(("corner_tot_le", f"le{k}", k, float(pt[:k + 1].sum())))
            n = len(ph)
            J = np.outer(ph, pa)
            out += [("corner_piu", "casa", None, float(np.tril(J, -1).sum())),
                    ("corner_piu", "pari", None, float(np.trace(J))),
                    ("corner_piu", "ospite", None, float(np.triu(J, 1).sum()))]
    return out


def outcome(fam, key, k, res):
    """Esito reale di un evento. res: dict con gol, gol_1t e statistiche [casa, ospite]."""
    def pair(metric):
        v = res.get(metric)
        return v if v and v[0] is not None and v[1] is not None else None
    if fam in ("1x2", "dc", "btts", "cs_h", "cs_a", "score") or fam.startswith("gol_"):
        g = pair("gol")
        if not g:
            return None
        h, a = g
        if fam == "1x2":
            return {"1": h > a, "X": h == a, "2": h < a}[key]
        if fam == "dc":
            return {"1X": h >= a, "X2": h <= a, "12": h != a}[key]
        if fam == "gol_tot_ge":
            return h + a >= k
        if fam == "gol_tot_le":
            return h + a <= k
        if fam == "gol_h_ge":
            return h >= k
        if fam == "gol_a_ge":
            return a >= k
        if fam == "btts":
            return (h > 0 and a > 0) == (key == "si")
        if fam == "cs_h":
            return a == 0
        if fam == "cs_a":
            return h == 0
        if fam == "score":
            return f"{h}-{a}" == key
        if fam == "gol_1t_ge":
            g1 = pair("gol_1t")
            return None if not g1 else g1[0] + g1[1] >= k
    metric, rest = fam.rsplit("_", 2)[0], fam.rsplit("_", 2)[1:]
    if fam == "corner_piu":
        c = pair("corner")
        if not c:
            return None
        return {"casa": c[0] > c[1], "pari": c[0] == c[1], "ospite": c[0] < c[1]}[key]
    v = pair(metric)
    if not v:
        return None
    side, op = rest
    x = v[0] + v[1] if side == "tot" else (v[0] if side == "h" else v[1])
    return x >= k if op == "ge" else x <= k


def family_group(fam):
    """Raggruppa le famiglie per il report di precisione."""
    if fam in ("1x2", "dc"):
        return "Esito"
    if fam.startswith("gol") or fam in ("btts", "cs_h", "cs_a", "score"):
        return "Gol"
    for p, n in (("corner", "Corner"), ("tiri_porta", "Tiri in porta"), ("tiri", "Tiri"),
                 ("falli", "Falli"), ("cartellini", "Cartellini")):
        if fam.startswith(p):
            return n
    return "Altro"
