/* Dati, indici e calcoli statistici dell'app. */
(function () {
  const TZ = 'Europe/Rome';
  const S = { meta: null, seasons: {}, preds: {}, players: {}, evalData: null };
  const NA = { na: true }; // statistica non applicabile
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d = 1) => v == null || Number.isNaN(v) ? 'n.d.' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pc = (p, d = 0) => p == null ? 'n.d.' : (p * 100).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const scode = s => s.slice(2, 4) + s.slice(5, 7);
  const sfrom = c => '20' + c.slice(0, 2) + '-' + c.slice(2, 4);
  const dfmt = (iso, opt) => new Intl.DateTimeFormat('it-IT', Object.assign({ timeZone: TZ }, opt)).format(new Date(iso));
  const dayKey = t => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  const hm = iso => dfmt(iso, { hour: '2-digit', minute: '2-digit' });
  const dlong = iso => dfmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dshort = iso => dfmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const dnum = iso => dfmt(iso, { day: '2-digit', month: '2-digit', year: '2-digit' });
  const dtime = iso => iso ? dfmt(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  async function getJSON(path, optional) {
    try {
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) { if (optional) return null; throw new Error(path + ': ' + r.status); }
      return await r.json();
    } catch (e) { if (optional) return null; throw e; }
  }
  async function meta() { if (!S.meta) S.meta = await getJSON('data/meta.json'); return S.meta; }
  async function evalData() { if (!S.evalData) S.evalData = await getJSON('data/eval.json', true) || { by: {}, reliability: {} }; return S.evalData; }
  function leagueInfo(lg) { return S.meta.campionati.find(c => c.code === lg); }
  const LGN = lg => (leagueInfo(lg) || { name: lg }).name;

  const has = path => !S.meta || !S.meta.file || S.meta.file.includes(path);
  async function season(lg, s) {
    const key = lg + '-' + scode(s);
    if (!has('m/' + key)) return (S.seasons[key] = null);
    if (S.seasons[key] === undefined) S.seasons[key] = build(await getJSON('data/m/' + key + '.json', true));
    return S.seasons[key];
  }
  async function preds(lg, s) {
    const key = lg + '-' + scode(s);
    if (S.preds[key] === undefined && !has('p/' + key)) S.preds[key] = {};
    if (S.preds[key] === undefined) S.preds[key] = await getJSON('data/p/' + key + '.json', true) || {};
    return S.preds[key];
  }
  async function players(lg, s) {
    const key = lg + '-' + scode(s);
    if (S.players[key] === undefined && !has('pl/' + key)) S.players[key] = null;
    if (S.players[key] === undefined) {
      const d = await getJSON('data/pl/' + key + '.json', true);
      const sd = d ? await season(lg, s) : null;
      if (d) {
        d.byMatch = {}; d.byPlayer = {};
        d.rows.forEach(r => {
          const mid = d.mids[r[0]], pid = d.pids[r[1]], tid = d.tids[r[2]]; const v = {};
          d.metrics.forEach((k, i) => { if (r[3 + i] != null) v[k] = r[3 + i]; });
          const o = { mid, pid, tid, v, t: sd && sd.byId[mid] ? sd.byId[mid].t : 0 };
          (d.byMatch[mid] = d.byMatch[mid] || []).push(o); (d.byPlayer[pid] = d.byPlayer[pid] || []).push(o);
        });
        Object.values(d.byPlayer).forEach(l => l.sort((a, b) => a.t - b.t));  // ordine cronologico per le ultime partite
        d.stats = null; d.rows = null;
      }
      S.players[key] = d;
    }
    return S.players[key];
  }
  function prevSeason(s) { const y = +s.slice(0, 4) - 1; return y + '-' + String(y + 1).slice(2); }

  function build(d) {
    if (!d) return null;
    d.byId = {}; d.byTeam = {};
    const byMd = {};
    d.matches.forEach(m => {
      m.lg = d.league; m.season = d.season; m.t = Date.parse(m.ko);
      d.byId[m.i] = m;
      (d.byTeam[m.h] = d.byTeam[m.h] || []).push(m); (d.byTeam[m.a] = d.byTeam[m.a] || []).push(m);
      const md = m.mo != null ? m.mo : m.md; if (md != null) (byMd[md] = byMd[md] || []).push(m.t);
    });
    d.mdMedian = {};
    Object.entries(byMd).forEach(([k, v]) => { v.sort((a, b) => a - b); d.mdMedian[k] = v[Math.floor(v.length / 2)]; });
    d.matches.forEach(m => { m.tag = tagOf(m, d); });
    d.mds = Object.keys(byMd).map(Number).sort((a, b) => a - b);
    return d;
  }
  function tagOf(m, d) {
    if (m.st === 'POSTPONED') return 'Rinviata';
    if (m.st === 'CANCELLED') return 'Annullata';
    if (m.st === 'SUSPENDED') return 'Sospesa';
    const md = m.mo != null ? m.mo : m.md; const med = d.mdMedian[md]; if (med == null) return '';
    const diff = (m.t - med) / 864e5;
    if (diff > 7) return 'Recupero'; if (diff > 2.5) return 'Posticipo'; if (diff < -2.5) return 'Anticipo';
    return '';
  }
  const teamName = (d, id) => (d && d.teams[id] ? d.teams[id][1] : id.split('-').slice(1).join(' '));
  const played = m => !!m.g;

  // --- valori per partita secondo il catalogo
  function res(m) {
    const r = { gol: m.g, gol_1t: m.ht };
    ['corner', 'tiri', 'tiri_porta', 'falli'].forEach(k => { if (m.s[k]) r[k] = m.s[k]; });
    if (m.s.gialli && m.s.rossi && m.s.gialli[0] != null && m.s.rossi[0] != null && m.s.gialli[1] != null && m.s.rossi[1] != null)
      r.cartellini = [m.s.gialli[0] + m.s.rossi[0], m.s.gialli[1] + m.s.rossi[1]];
    return r;
  }
  function raw(m, side, k, s) {
    const v = m.s[k]; if (!v) return null;
    const i = side === 'H' ? 0 : 1, o = 1 - i;
    if (s === 'total') return v[0] == null || v[1] == null ? null : v[0] + v[1];
    return s === 'against' ? v[o] : v[i];
  }
  function goals(m, side, which, p) {
    if (!m.g) return null; let g = m.g;
    if (p === 'ht') { if (!m.ht) return null; g = m.ht; }
    if (p === 'st') { if (!m.ht) return null; g = [m.g[0] - m.ht[0], m.g[1] - m.ht[1]]; }
    const i = side === 'H' ? 0 : 1, f = g[i], a = g[1 - i];
    return { for: f, against: a, total: f + a, diff: f - a }[which];
  }
  function val(m, side, f, ctx) {
    switch (f.t) {
      case 'na': return NA;
      case 'res': { const gf = goals(m, side, 'for'), ga = goals(m, side, 'against'); if (gf == null) return null;
        const r = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
        return f.v === 'pts' ? { W: 3, D: 1, L: 0 }[r] : (r === f.v ? 1 : 0); }
      case 'goals': return goals(m, side, f.v, f.p);
      case 'flag': { const gf = goals(m, side, 'for'), ga = goals(m, side, 'against'); if (gf == null) return null;
        return f.v === 'cs' ? +(ga === 0) : f.v === 'fts' ? +(gf === 0) : +(gf > 0 && ga > 0); }
      case 'raw': return raw(m, side, f.k, f.s);
      case 'diff': { const a = raw(m, side, f.a, f.s), b = raw(m, side, f.b, f.s); return a == null || b == null ? null : a - b; }
      case 'sum': { let t = 0; for (const k of f.k) { const v = raw(m, side, k, f.s); if (v == null) return null; t += v; } return t; }
      case 'ratio': { const a = f.a === '@gol' ? goals(m, side, 'for') : raw(m, side, f.a, f.s); const b = raw(m, side, f.b, f.bs || f.s);
        return a == null || b == null ? null : [a, b]; }
      case 'gband': {
        if (!m.g) return null; if (!m.gm) return m.g[0] + m.g[1] === 0 ? 0 : null;
        let n = 0;
        for (const [mn, sd] of m.gm) {
          if (mn == null) return null; const mm = Math.min(mn, 90); if (mm < f.a || mm > f.b) continue;
          if (f.s === 'total') n++; else { if (sd == null) return null; if ((f.s === 'for') === (sd === side)) n++; }
        }
        return n; }
      case 'rawp': { const r = raw(m, side, f.k, 'for'); if (r != null) return r; return val(m, side, { t: 'psum', k: f.k }, ctx); }
      case 'psum': { const pd = ctx && ctx.players; if (!pd || !pd.byMatch[m.i]) return null;
        const tid = side === 'H' ? m.h : m.a; let t = 0, any = false;
        pd.byMatch[m.i].forEach(x => { if (x.tid === tid && x.v[f.k] != null) { t += x.v[f.k]; any = true; } });
        return any ? t : null; }
    }
    return null;
  }
  // aggrega su un elenco di {m, side}
  function agg(metric, list, ctx) {
    const f = metric.f;
    if (f.t === 'na') return { state: 'na', n: 0, of: list.length };
    let n = 0, s = 0, num = 0, den = 0; const rows = [];
    list.forEach(x => {
      const v = val(x.m, x.side, f, ctx); rows.push({ m: x.m, side: x.side, v });
      if (v == null || v === NA) return;
      n++;
      if (Array.isArray(v)) { num += v[0]; den += v[1]; } else s += v;
    });
    if (!n) return { state: 'missing', n: 0, of: list.length, rows };
    if (metric.agg === 'ratio') {
      if (!den) return { state: 'nonapp', n, of: list.length, rows };
      return { state: 'ok', v: num / den * (f.pct ? 100 : 1), n, of: list.length, rows };
    }
    if (metric.agg === 'rate') return { state: 'ok', v: s / n * 100, n, of: list.length, rows };
    return { state: 'ok', v: s / n, n, of: list.length, rows };
  }
  function show(a, d) {
    if (!a) return '<span class="miss" title="non rilevato dalla fonte">n.r.</span>';
    if (a.state === 'na') return '<span class="nd" title="non disponibile con le fonti attive">n.d.</span>';
    if (a.state === 'missing') return '<span class="miss" title="non rilevato dalla fonte">n.r.</span>';
    if (a.state === 'nonapp') return '<span class="nd" title="non applicabile">n/a</span>';
    return nf(a.v, d == null ? 1 : d);
  }
  function cellVal(v, d) {
    if (v === NA) return '<span class="nd" title="non disponibile">n.d.</span>';
    if (v == null) return '<span class="miss" title="non rilevato dalla fonte">n.r.</span>';
    if (Array.isArray(v)) return v[1] ? nf(v[0] / v[1] * 100, 0) + '%' : '<span class="nd" title="non applicabile">n/a</span>';
    return nf(v, d == null ? (Number.isInteger(v) ? 0 : 2) : d);
  }

  // partite giocate di una squadra con filtri
  function teamMatches(d, tid, o) {
    o = o || {};
    let ms = (d.byTeam[tid] || []).filter(m => played(m) && (o.before == null || m.t < o.before));
    if (o.venue === 'home') ms = ms.filter(m => m.h === tid);
    if (o.venue === 'away') ms = ms.filter(m => m.a === tid);
    if (o.from) ms = ms.filter(m => m.t >= o.from);
    if (o.to) ms = ms.filter(m => m.t <= o.to);
    ms.sort((a, b) => a.t - b.t);
    if (o.last) ms = ms.slice(-o.last);
    return ms.map(m => ({ m, side: m.h === tid ? 'H' : 'A' }));
  }
  function leagueList(d, o) {
    o = o || {}; const out = [];
    d.matches.forEach(m => {
      if (!played(m) || (o.before != null && m.t >= o.before)) return;
      if (o.venue !== 'away') out.push({ m, side: 'H' });
      if (o.venue !== 'home') out.push({ m, side: 'A' });
    });
    return out;
  }
  function standings(d, before, venue, last) {
    const T = {};
    const row = id => T[id] = T[id] || { id, p: 0, w: 0, dr: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
    let ms = d.matches.filter(m => played(m) && (before == null || m.t < before)).sort((a, b) => a.t - b.t);
    if (last) { const cnt = {}; ms = ms.slice().reverse().filter(m => { const ok = (cnt[m.h] || 0) < last && (cnt[m.a] || 0) < last; if (ok) { cnt[m.h] = (cnt[m.h] || 0) + 1; cnt[m.a] = (cnt[m.a] || 0) + 1; } return ok; }).reverse(); }
    ms.forEach(m => {
      const [x, y] = m.g;
      if (venue === 'home') { const h = row(m.h); h.p++; h.gf += x; h.ga += y; if (x > y) { h.w++; h.pts += 3; h.form.push('V'); } else if (x < y) { h.l++; h.form.push('S'); } else { h.dr++; h.pts++; h.form.push('N'); } return; }
      if (venue === 'away') { const a = row(m.a); a.p++; a.gf += y; a.ga += x; if (y > x) { a.w++; a.pts += 3; a.form.push('V'); } else if (y < x) { a.l++; a.form.push('S'); } else { a.dr++; a.pts++; a.form.push('N'); } return; }
      const h = row(m.h), a = row(m.a);
      h.p++; a.p++; h.gf += x; h.ga += y; a.gf += y; a.ga += x;
      if (x > y) { h.w++; a.l++; h.pts += 3; h.form.push('V'); a.form.push('S'); }
      else if (x < y) { a.w++; h.l++; a.pts += 3; h.form.push('S'); a.form.push('V'); }
      else { h.dr++; a.dr++; h.pts++; a.pts++; h.form.push('N'); a.form.push('N'); }
    });
    Object.keys(d.teams).forEach(row);
    return Object.values(T).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || teamName(d, a.id).localeCompare(teamName(d, b.id)));
  }
  const metricByCode = code => S.meta.catalogo.find(x => x.code === code);
  // --- giocatori: aggregati su un insieme di partite
  function pAgg(pd, opt) {
    opt = opt || {}; const by = {};
    Object.values(pd.byPlayer).forEach(list => list.forEach(r => {
      if (opt.tid && r.tid !== opt.tid) return;
      if (opt.before != null || opt.season) { const m = opt.d && opt.d.byId[r.mid]; if (!m) return; if (opt.before != null && m.t >= opt.before) return; }
      if (opt.mids && !opt.mids.has(r.mid)) return;
      const o = by[r.pid] = by[r.pid] || { pid: r.pid, app: 0, starts: 0, min: 0, tot: {}, minK: {}, nK: {}, ms: [], tid: r.tid };
      const mins = r.v.minuti || 0; o.ms.push(r); o.tid = r.tid;
      if (!mins) return;
      o.app++; o.min += mins; if (r.v.titolare) o.starts++;
      Object.entries(r.v).forEach(([k, x]) => { o.tot[k] = (o.tot[k] || 0) + x; o.minK[k] = (o.minK[k] || 0) + mins; o.nK[k] = (o.nK[k] || 0) + 1; });
    }));
    Object.values(by).forEach(o => { const inf = pd.players[o.pid] || [o.pid, o.tid, null]; o.name = inf[0]; o.role = inf[2] || 'ruolo n.d.'; });
    return Object.values(by);
  }
  // valore di una metrica giocatore: {v, n} oppure null se il dato manca
  // media delle ultime n presenze (con minuti) in cui la fonte ha il dato; per i rapporti: somma num / somma den
  function pLast(o, code, n) {
    n = n || 5; const pl = o.ms.filter(r => (r.v.minuti || 0) > 0).sort((a, b) => (a.t || 0) - (b.t || 0)).slice(-n);
    const R = (S.meta.rapporti_giocatore || []).find(x => x.code === code);
    if (R) { let a = 0, b = 0, k = 0; pl.forEach(r => { if (r.v[R.num] != null && r.v[R.den] != null) { a += r.v[R.num]; b += r.v[R.den]; k++; } }); return k ? (b ? { v: a / b * 100, pct: true, n: k } : { nonapp: true }) : null; }
    const vals = pl.filter(r => r.v[code] != null).map(r => r.v[code]); if (!vals.length) return null;
    return { v: vals.reduce((x, y) => x + y, 0) / vals.length, n: vals.length };
  }
  function pShowL(x) { if (!x || x.nonapp) return pShow(x); return pShow(x, x.pct ? 0 : 2) + (x.n < 5 ? `<span class="sub" title="presenze con il dato"> (${x.n})</span>` : ''); }
  function pVal(o, code, mode) {
    if (mode === 'l5') return pLast(o, code, 5);
    const R = (S.meta.rapporti_giocatore || []).find(x => x.code === code);
    if (R) { const a = o.tot[R.num], b = o.tot[R.den]; if (a == null || b == null) return null; return b ? { v: a / b * 100, pct: true } : { nonapp: true }; }
    const t = o.tot[code]; if (t == null) return null;
    const M = (S.meta.metriche_giocatore || []).find(x => x.code === code);
    if (mode === 'p90' && M && M.per90) { const mk = o.minK[code] || 0; return mk ? { v: t / mk * 90 } : { nonapp: true }; }
    return { v: t };
  }
  function pShow(x, d) { if (!x) return '<span class="miss" title="non rilevato dalla fonte">n.r.</span>'; if (x.nonapp) return '<span class="nd" title="non applicabile">n/a</span>'; return x.pct ? nf(x.v, 0) + '%' : nf(x.v, d == null ? (Number.isInteger(x.v) ? 0 : 2) : d); }
  function pAvail(pd) {
    if (!pd) return new Set();
    if (pd._avail) return pd._avail;
    const a = new Set(); Object.values(pd.byPlayer).forEach(l => l.forEach(r => { if (r.v.minuti > 0) Object.keys(r.v).forEach(k => a.add(k)); }));
    return (pd._avail = a);
  }
  // metriche giocatore; con pd restituisce solo quelle presenti nei dati di quel campionato
  function pMetricMeta(pd) {
    const M = S.meta.metriche_giocatore.map(x => Object.assign({ kind: 'sum' }, x));
    (S.meta.rapporti_giocatore || []).forEach(x => M.push(Object.assign({ kind: 'ratio', per90: false }, x)));
    if (!pd) return M;
    const a = pAvail(pd);
    return M.filter(x => x.kind === 'ratio' ? a.has(x.num) && a.has(x.den) : a.has(x.code));
  }
  function pMissing(pd) {
    const have = new Set(pMetricMeta(pd).map(x => x.code));
    return S.meta.metriche_giocatore.filter(x => !have.has(x.code) && !['distanza_km', 'contributi_difensivi', 'rigori_parati', 'rigori_ottenuti', 'rigori_commessi', 'respinte_portiere'].includes(x.code)).map(x => x.name);
  }
  // alternativa quando una statistica scelta non esiste in un campionato
  const P_ALT = { contrasti: 'contrasti_vinti', contrasti_vinti: 'recuperi', dribbling_tentati: 'dribbling_riusciti', dribbling_riusciti: 'tocchi_area', falli_commessi: 'falli_subiti', perc_contrasti: 'contrasti_vinti', perc_dribbling: 'dribbling_riusciti', intercetti: 'recuperi', duelli_vinti: 'recuperi', cross: 'cross_riusciti' };
  function pPick(pd, code, dflt) {
    const M = pMetricMeta(pd); const ok = c => M.find(x => x.code === c);
    let c = code, guard = 0; while (c && !ok(c) && guard++ < 4) c = P_ALT[c];
    return ok(c) ? c : ok(dflt) ? dflt : (M[0] || {}).code;
  }
  const formChips = arr => arr.slice(-5).map(r => `<i class="fc fc-${r}" title="${{ V: 'vittoria', N: 'pareggio', S: 'sconfitta' }[r]}">${r}</i>`).join('');
  const matchUrl = (m, tab) => '#partita-' + m.i + (tab ? '--' + tab : '');
  const teamUrl = id => '#squadra-' + id;

  const APP_VERSION = '2026-11-28.4';
  window.C = { APP_VERSION, S, NA, TZ, esc, nf, pc, scode, sfrom, dfmt, dayKey, hm, dlong, dshort, dnum, dtime, getJSON, meta, evalData,
    leagueInfo, LGN, season, preds, players, prevSeason, teamName, played, res, val, agg, show, cellVal, teamMatches,
    leagueList, standings, metricByCode, formChips, matchUrl, teamUrl, pAgg, pVal, pShow, pMetricMeta, pMissing, pPick, pAvail, pLast, pShowL };
})();
