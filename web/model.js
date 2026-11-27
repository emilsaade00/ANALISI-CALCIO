/* Calcoli probabilistici dal pronostico salvato. Replica di pipeline/events.py:
   tests/test_parity.py verifica che i risultati coincidano. */
(function (root) {
  const GOAL_N = 10;
  function pois(l, n) { const o = new Array(n + 1).fill(0); let p = Math.exp(-l); o[0] = p; for (let k = 1; k <= n; k++) { p *= l / k; o[k] = p; } return o; }
  function nb(mu, size, n) {
    if (!size) return pois(mu, n);
    const o = new Array(n + 1).fill(0); const q = size / (size + mu); let p = Math.pow(q, size); o[0] = p;
    for (let k = 1; k <= n; k++) { p *= (k - 1 + size) / k * (1 - q); o[k] = p; } return o;
  }
  function conv(a, b, n) { const o = new Array(n + 1).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length && i + j <= n; j++) o[i + j] += a[i] * b[j]; return o; }
  function nmax(mu) { return Math.floor(Math.max(12, mu * 3 + 15)); }
  function metricPmfs(mp, useMu) {
    const [lh, la] = useMu ? mp.mu : mp.l; const r = mp.r || 0; const ref = mp.l;
    const n = nmax(ref[0] + ref[1]);
    const ph = nb(lh, r, n), pa = nb(la, r, n);
    return { ph, pa, pt: conv(ph, pa, 2 * n) };
  }
  function scoreMatrix(lh, la) {
    const ph = pois(lh, GOAL_N), pa = pois(la, GOAL_N); let s = 0; const M = [];
    for (let i = 0; i <= GOAL_N; i++) { M.push([]); for (let j = 0; j <= GOAL_N; j++) { const v = ph[i] * pa[j]; M[i].push(v); s += v; } }
    for (let i = 0; i <= GOAL_N; i++) for (let j = 0; j <= GOAL_N; j++) M[i][j] /= s;
    return M;
  }
  const ge = (p, k) => { let s = 0; for (let i = k; i < p.length; i++) s += p[i]; return s; };
  const le = (p, k) => { let s = 0; for (let i = 0; i <= k && i < p.length; i++) s += p[i]; return s; };
  function moments(p) { let m = 0, m2 = 0; p.forEach((v, i) => { m += i * v; m2 += i * i * v; }); return [m, Math.sqrt(Math.max(m2 - m * m, 0.25))]; }
  function range(p, loMin, span) {
    span = span || 2.2; const [m, sd] = moments(p);
    const lo = Math.max(loMin, Math.floor(m - span * sd)); const hi = Math.max(lo + 1, Math.ceil(m + span * sd));
    const o = []; for (let k = lo; k <= hi; k++) o.push(k); return o;
  }
  function interval(p, q) { // intervallo centrale (es. 80%)
    q = q || 0.8; const a = (1 - q) / 2; let c = 0, lo = 0, hi = p.length - 1;
    for (let i = 0; i < p.length; i++) { c += p[i]; if (c >= a) { lo = i; break; } }
    c = 0; for (let i = 0; i < p.length; i++) { c += p[i]; if (c >= 1 - a) { hi = i; break; } }
    return [lo, hi];
  }
  function goalBlock(pred, baseline) {
    const g = pred.m.gol; if (!g || !g.l) return null;
    const [lh, la] = baseline ? g.mu : g.l; const M = scoreMatrix(lh, la);
    let p1 = 0, px = 0, p2 = 0; const tot = new Array(2 * GOAL_N + 1).fill(0);
    const ph = new Array(GOAL_N + 1).fill(0), pa = new Array(GOAL_N + 1).fill(0);
    for (let i = 0; i <= GOAL_N; i++) for (let j = 0; j <= GOAL_N; j++) {
      const v = M[i][j]; if (i > j) p1 += v; else if (i === j) px += v; else p2 += v;
      tot[i + j] += v; ph[i] += v; pa[j] += v;
    }
    let btts = 0; for (let i = 1; i <= GOAL_N; i++) for (let j = 1; j <= GOAL_N; j++) btts += M[i][j];
    return { M, p1, px, p2, tot, ph, pa, btts, lh, la };
  }
  function events(pred, baseline) {
    const out = []; const m = pred.m; const G = goalBlock(pred, baseline);
    if (G) {
      out.push(['1x2', '1', null, G.p1], ['1x2', 'X', null, G.px], ['1x2', '2', null, G.p2]);
      out.push(['dc', '1X', null, G.p1 + G.px], ['dc', 'X2', null, G.px + G.p2], ['dc', '12', null, G.p1 + G.p2]);
      for (let k = 1; k <= 6; k++) out.push(['gol_tot_ge', 'ge' + k, k, ge(G.tot, k)]);
      for (let k = 0; k <= 4; k++) out.push(['gol_tot_le', 'le' + k, k, le(G.tot, k)]);
      for (let k = 1; k <= 4; k++) { out.push(['gol_h_ge', 'ge' + k, k, ge(G.ph, k)]); out.push(['gol_a_ge', 'ge' + k, k, ge(G.pa, k)]); }
      out.push(['btts', 'si', null, G.btts], ['btts', 'no', null, 1 - G.btts]);
      out.push(['cs_h', 'si', null, G.pa[0]], ['cs_a', 'si', null, G.ph[0]]);
      const share = pred.ht == null ? 0.44 : pred.ht; const p1t = pois((G.lh + G.la) * share, 12);
      for (let k = 1; k <= 3; k++) out.push(['gol_1t_ge', 'ge' + k, k, ge(p1t, k)]);
      const Mref = scoreMatrix(m.gol.l[0], m.gol.l[1]); const flat = [];
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) flat.push([Mref[i][j], i, j]);
      flat.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
      flat.slice(0, 6).forEach(([_, i, j]) => out.push(['score', i + '-' + j, null, G.M[i][j]]));
    }
    for (const metric of ['corner', 'tiri', 'tiri_porta', 'falli', 'cartellini']) {
      const mp = m[metric]; if (!mp || !mp.l) continue;
      const P = metricPmfs(mp, baseline), R = metricPmfs(mp, false);
      range(R.pt, 1).forEach(k => out.push([metric + '_tot_ge', 'ge' + k, k, ge(P.pt, k)]));
      range(R.ph, 1).forEach(k => out.push([metric + '_h_ge', 'ge' + k, k, ge(P.ph, k)]));
      range(R.pa, 1).forEach(k => out.push([metric + '_a_ge', 'ge' + k, k, ge(P.pa, k)]));
      if (metric === 'corner') {
        range(R.pt, 1).forEach(k => out.push(['corner_tot_le', 'le' + k, k, le(P.pt, k)]));
        let a = 0, b = 0, c = 0;
        for (let i = 0; i < P.ph.length; i++) for (let j = 0; j < P.pa.length; j++) { const v = P.ph[i] * P.pa[j]; if (i > j) a += v; else if (i === j) b += v; else c += v; }
        out.push(['corner_piu', 'casa', null, a], ['corner_piu', 'pari', null, b], ['corner_piu', 'ospite', null, c]);
      }
    }
    return out;
  }
  function outcome(fam, key, k, res) {
    const pair = mt => { const v = res[mt]; return v && v[0] != null && v[1] != null ? v : null; };
    if (['1x2', 'dc', 'btts', 'cs_h', 'cs_a', 'score'].includes(fam) || fam.startsWith('gol_')) {
      const g = pair('gol'); if (!g) return null; const [h, a] = g;
      switch (fam) {
        case '1x2': return { '1': h > a, 'X': h === a, '2': h < a }[key];
        case 'dc': return { '1X': h >= a, 'X2': h <= a, '12': h !== a }[key];
        case 'gol_tot_ge': return h + a >= k; case 'gol_tot_le': return h + a <= k;
        case 'gol_h_ge': return h >= k; case 'gol_a_ge': return a >= k;
        case 'btts': return (h > 0 && a > 0) === (key === 'si');
        case 'cs_h': return a === 0; case 'cs_a': return h === 0;
        case 'score': return h + '-' + a === key;
        case 'gol_1t_ge': { const g1 = pair('gol_1t'); return g1 ? g1[0] + g1[1] >= k : null; }
      }
    }
    if (fam === 'corner_piu') { const c = pair('corner'); if (!c) return null; return { casa: c[0] > c[1], pari: c[0] === c[1], ospite: c[0] < c[1] }[key]; }
    const parts = fam.split('_'); const op = parts.pop(), side = parts.pop(), metric = parts.join('_');
    const v = pair(metric); if (!v) return null;
    const x = side === 'tot' ? v[0] + v[1] : side === 'h' ? v[0] : v[1];
    return op === 'ge' ? x >= k : x <= k;
  }
  const api = { pois, nb, conv, metricPmfs, scoreMatrix, goalBlock, events, outcome, interval, moments, ge, le };
  if (typeof module !== 'undefined') module.exports = api; else root.CM = api;
})(this);
