"""Modello statistico trasparente (solo dati sportivi, nessuna quota).

Per ogni metrica di conteggio (gol, corner, tiri, tiri in porta, falli, cartellini):

  atteso_casa  = media_campionato_casa  x produzione_casa x fattore_casa_in_casa
                 x concessione_ospite x fattore_ospite_in_trasferta [x arbitro]
  atteso_ospite = media_campionato_trasf x produzione_ospite x fattore_ospite_in_trasferta
                 x concessione_casa x fattore_casa_in_casa [x arbitro]

- Produzione e concessione si stimano insieme, tenendo conto della forza degli
  avversari affrontati (procedura iterativa).
- Ogni partita pesa meno quanto piu' e' vecchia (emivita in giorni: forma recente).
- Ogni stima e' "tirata" verso la media del campionato con k partite fittizie:
  con pochi dati la stima resta prudente. Per le neopromosse il punto di partenza
  e' il rendimento medio storico delle neopromosse, calcolato dai dati.
- Gol: distribuzione di Poisson. Altre metriche: binomiale negativa, con dispersione
  stimata dai dati del campionato.
- Arbitro (solo falli e cartellini): fattore prudente con k_referee partite fittizie,
  applicato solo se la designazione e' nota prima della gara.
"""
import math
from datetime import datetime, timezone

import numpy as np

from . import config

DAY = 86400.0


def iso_to_ts(s):
    return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()


def ts_to_iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class LeagueData:
    """Partite giocate di un campionato in forma vettoriale."""

    def __init__(self, league, matches):
        self.league = league
        ms = sorted([m for m in matches if m["fthg"] is not None], key=lambda m: m["ko"])
        self.matches = ms
        teams = sorted({m["home"] for m in matches} | {m["away"] for m in matches})
        self.teams = teams
        self.tidx = {t: i for i, t in enumerate(teams)}
        self.T = len(teams)
        self.ts = np.array([iso_to_ts(m["ko"]) for m in ms]) if ms else np.zeros(0)
        self.h = np.array([self.tidx[m["home"]] for m in ms], dtype=int)
        self.a = np.array([self.tidx[m["away"]] for m in ms], dtype=int)
        self.season = np.array([m["season"] for m in ms])
        self.ref = [m.get("referee") for m in ms]
        self.vals = {}
        nan = float("nan")

        def col(fn):
            xh = np.array([fn(m, "H") for m in ms], dtype=float) if ms else np.zeros(0)
            xa = np.array([fn(m, "A") for m in ms], dtype=float) if ms else np.zeros(0)
            return xh, xa

        self.vals["gol"] = col(lambda m, s: m["fthg"] if s == "H" else m["ftag"])
        self.vals["gol_1t"] = col(lambda m, s: (m["hthg"] if s == "H" else m["htag"]) if m["hthg"] is not None else nan)
        for k in ("corner", "tiri", "tiri_porta", "falli"):
            self.vals[k] = col(lambda m, s, k=k: m["stats"].get(k, {}).get(s, nan))

        def cards(m, s):
            y, r = m["stats"].get("gialli", {}).get(s), m["stats"].get("rossi", {}).get(s)
            return y + r if y is not None and r is not None else nan
        self.vals["cartellini"] = col(cards)

    def teams_in_season(self, season):
        return {m["home"] for m in self.matches if m["season"] == season} | \
               {m["away"] for m in self.matches if m["season"] == season}


def promoted_priors(leagues_data, target_season, all_matches_by_league):
    """Rendimento medio storico delle neopromosse (solo stagioni precedenti a target_season).

    Restituisce {metrica: (produzione, concessione)} rispetto alla media del campionato.
    """
    out = {}
    for metric in config.MODELLED_METRICS:
        num_f = den_f = num_a = den_a = 0.0
        for lg, ld in leagues_data.items():
            seasons = sorted({s for s in ld.season})
            for i, s in enumerate(seasons):
                if s >= target_season or i == 0:
                    continue
                prev = seasons[i - 1]
                if int(prev[:4]) != int(s[:4]) - 1:
                    continue
                prev_teams = {m["home"] for m in all_matches_by_league[lg] if m["season"] == prev}
                xh, xa = ld.vals[metric]
                sel = (ld.season == s) & np.isfinite(xh) & np.isfinite(xa)
                if sel.sum() < 50:
                    continue
                mu_h, mu_a = xh[sel].mean(), xa[sel].mean()
                for j in np.where(sel)[0]:
                    hn, an = ld.teams[ld.h[j]], ld.teams[ld.a[j]]
                    if hn not in prev_teams:
                        num_f += xh[j]; den_f += mu_h; num_a += xa[j]; den_a += mu_a
                    if an not in prev_teams:
                        num_f += xa[j]; den_f += mu_a; num_a += xh[j]; den_a += mu_h
        if den_f > 0 and den_a > 0:
            out[metric] = (round(num_f / den_f, 3), round(num_a / den_a, 3))
        else:
            out[metric] = (1.0, 1.0)
    return out


class Fit:
    pass


def fit_metric(ld, metric, cutoff_ts, params, promoted=None, prior=(1.0, 1.0)):
    """Stima i parametri di una metrica usando solo partite con calcio d'inizio < cutoff."""
    xh_all, xa_all = ld.vals[metric]
    win = params["window_days"] * DAY
    sel = (ld.ts < cutoff_ts) & (ld.ts >= cutoff_ts - win) & np.isfinite(xh_all) & np.isfinite(xa_all)
    f = Fit()
    f.metric = metric
    f.n_matches = int(sel.sum())
    if f.n_matches < 30:
        f.ok = False
        return f
    f.ok = True
    idx = np.where(sel)[0]
    h, a = ld.h[idx], ld.a[idx]
    xh, xa = xh_all[idx], xa_all[idx]
    w = 0.5 ** ((cutoff_ts - ld.ts[idx]) / (params["half_life_days"] * DAY))
    T = ld.T
    sw = w.sum()
    mu_h, mu_a = (w * xh).sum() / sw, (w * xa).sum() / sw
    E0 = (mu_h + mu_a) / 2
    k = params["k_shrink"]
    pa = np.ones(T)
    pd = np.ones(T)
    if promoted:
        for t in promoted:
            if t in ld.tidx:
                pa[ld.tidx[t]], pd[ld.tidx[t]] = prior
    att, dfn = pa.copy(), pd.copy()
    bc = lambda ix, v: np.bincount(ix, weights=v, minlength=T)
    num_att = bc(h, w * xh) + bc(a, w * xa)
    num_def = bc(h, w * xa) + bc(a, w * xh)
    for _ in range(params["iterations"]):
        den_att = bc(h, w * mu_h * dfn[a]) + bc(a, w * mu_a * dfn[h])
        att = (num_att + k * E0 * pa) / (den_att + k * E0)
        den_def = bc(h, w * mu_a * att[a]) + bc(a, w * mu_h * att[h])
        dfn = (num_def + k * E0 * pd) / (den_def + k * E0)
    # fattori casa/trasferta specifici della squadra, molto prudenti
    kv = params["k_venue"]
    base_h = mu_h * att[h] * dfn[a]
    base_a = mu_a * att[a] * dfn[h]
    va_home = (bc(h, w * xh) + kv * E0) / (bc(h, w * base_h) + kv * E0)
    va_away = (bc(a, w * xa) + kv * E0) / (bc(a, w * base_a) + kv * E0)
    vd_home = (bc(h, w * xa) + kv * E0) / (bc(h, w * base_a) + kv * E0)
    vd_away = (bc(a, w * xh) + kv * E0) / (bc(a, w * base_h) + kv * E0)
    lam_h = mu_h * att[h] * va_home[h] * dfn[a] * vd_away[a]
    lam_a = mu_a * att[a] * va_away[a] * dfn[h] * vd_home[h]
    # ricalibra le medie perche' la previsione media coincida con quella osservata
    mu_h *= (w * xh).sum() / (w * lam_h).sum()
    mu_a *= (w * xa).sum() / (w * lam_a).sum()
    lam_h = mu_h * att[h] * va_home[h] * dfn[a] * vd_away[a]
    lam_a = mu_a * att[a] * va_away[a] * dfn[h] * vd_home[h]
    # dispersione (varianza = l + l^2/size): metodo dei momenti sui residui
    x = np.concatenate([xh, xa]); lam = np.concatenate([lam_h, lam_a]); ww = np.concatenate([w, w])
    phi = (ww * ((x - lam) ** 2 - lam)).sum() / (ww * lam ** 2).sum()
    f.size = 0.0 if (config.MODELLED_METRICS.get(metric) == "poisson" or phi <= 0.004) else float(1.0 / phi)
    f.mu = (float(mu_h), float(mu_a))
    f.att, f.dfn = att, dfn
    f.va_home, f.va_away, f.vd_home, f.vd_away = va_home, va_away, vd_home, vd_away
    f.n_all = np.bincount(h, minlength=T) + np.bincount(a, minlength=T)
    f.n_home = np.bincount(h, minlength=T)
    f.n_away = np.bincount(a, minlength=T)
    f.last_ts = float(ld.ts[idx].max())
    # arbitri: rapporto osservato/atteso sul totale partita, prudente
    f.ref = {}
    if metric in config.REFEREE_METRICS:
        kr = params["k_referee"]
        Et = mu_h + mu_a
        acc = {}
        for j, i in enumerate(idx):
            r = ld.ref[i]
            if r:
                o, e, n = acc.get(r, (0.0, 0.0, 0))
                acc[r] = (o + w[j] * (xh[j] + xa[j]), e + w[j] * (lam_h[j] + lam_a[j]), n + 1)
        for r, (o, e, n) in acc.items():
            f.ref[r] = ((o + kr * Et) / (e + kr * Et), n)
    return f


def predict_metric(f, ld, home, away, params, referee=None):
    """Parametri salvati per una partita: medie, fattori e numerosita'."""
    if not f.ok:
        return {"na": "dati di campionato insufficienti"}
    if home not in ld.tidx or away not in ld.tidx:
        return {"na": "squadra senza dati"}
    hi, ai = ld.tidx[home], ld.tidx[away]
    nh, na_ = int(f.n_all[hi]), int(f.n_all[ai])
    if nh < params["min_obs"] or na_ < params["min_obs"]:
        return {"na": "campione insufficiente", "n": [[nh, int(f.n_home[hi])], [na_, int(f.n_away[ai])]]}
    fh = [f.att[hi], f.va_home[hi], f.dfn[ai], f.vd_away[ai]]
    fa = [f.att[ai], f.va_away[ai], f.dfn[hi], f.vd_home[hi]]
    lh = f.mu[0] * fh[0] * fh[1] * fh[2] * fh[3]
    la = f.mu[1] * fa[0] * fa[1] * fa[2] * fa[3]
    out = {"mu": [round(f.mu[0], 4), round(f.mu[1], 4)],
           "fh": [round(float(v), 4) for v in fh], "fa": [round(float(v), 4) for v in fa],
           "n": [[nh, int(f.n_home[hi])], [na_, int(f.n_away[ai])]],
           "r": round(f.size, 3), "N": f.n_matches}
    rf = None
    if referee and referee in f.ref:
        rf = f.ref[referee]
        lh *= rf[0]
        la *= rf[0]
        out["ref"] = [round(rf[0], 4), rf[1]]
    elif referee and f.ref is not None and f.metric in config.REFEREE_METRICS:
        out["ref"] = [1.0, 0]
    out["l"] = [round(float(lh), 4), round(float(la), 4)]
    return out


# ---------------------------------------------------------------- distribuzioni

def pmf_poisson(lam, n):
    out = np.zeros(n + 1)
    p = math.exp(-lam)
    out[0] = p
    for k in range(1, n + 1):
        p *= lam / k
        out[k] = p
    return out


def pmf_negbin(mu, size, n):
    if not size:
        return pmf_poisson(mu, n)
    out = np.zeros(n + 1)
    q = size / (size + mu)
    p = q ** size
    out[0] = p
    for k in range(1, n + 1):
        p *= (k - 1 + size) / k * (1 - q)
        out[k] = p
    return out


def nmax_for(mu):
    return int(max(12, mu * 3 + 15))


def metric_pmfs(mp, use_mu=False):
    """pmf casa, ospite, totale per una metrica salvata (use_mu: solo medie di campionato)."""
    lh, la = mp["mu"] if use_mu else mp["l"]
    r = mp.get("r", 0)
    n = nmax_for(mp["l"][0] + mp["l"][1])
    ph, pa = pmf_negbin(lh, r, n), pmf_negbin(la, r, n)
    pt = np.convolve(ph, pa)[: 2 * n + 1]
    return ph, pa, pt


def ll_count(x, lam, size):
    """Log-verosimiglianza di un conteggio osservato."""
    x = int(round(x))
    if not size:
        return -lam + x * math.log(lam) - math.lgamma(x + 1)
    return (math.lgamma(x + size) - math.lgamma(size) - math.lgamma(x + 1)
            + size * math.log(size / (size + lam)) + x * math.log(lam / (size + lam)))
