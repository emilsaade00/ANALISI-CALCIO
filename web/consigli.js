/* Scommesse consigliate: gli eventi che TUTTI i dati dell'app ritengono molto probabili (squadre e giocatori),
   ricerca per fascia di quota, schedina piu' probabile (anche con quota obiettivo), errori di quota rispetto
   alle quote che l'utente vede dal suo bookmaker, rendimento dei consigli passati e registro delle proprie giocate.
   Nessuna quota dei bookmaker viene scaricata ne' usata nei calcoli: quella inserita a mano resta sul dispositivo. */
(function () {
  const { esc, nf, pc } = C;
  const ui = { lg: 'tutti', per: 'giornata', minF: 0.7, rel: 'media', mk: 'tutti', n: 4, conPl: false, pstat: 'tutte', pOff: false,
    margin: 0.1, band: '', target: '', past: 14, only: null, raw: false };
  const band = h => `<section class="band">${h}</section>`;
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`;
  const MAXP = 0.95; // sopra questa soglia l'evento e' quasi certo e non dice nulla
  // fasce di quota giusta (1 / fiducia) per cercare i consigli come in una schedina
  const BANDS = [[1.10, 1.25], [1.26, 1.35], [1.36, 1.45], [1.46, 1.55], [1.56, 1.65], [1.66, 1.75], [1.76, 1.85], [1.86, 2.00], [2.01, 2.50], [2.51, 3.50]];
  const bandOf = () => ui.band === '' ? null : BANDS[+ui.band];
  const q2 = f => Math.round(100 / f) / 100; // quota giusta arrotondata a 2 decimali
  const inScope = fid => { const b = bandOf(); if (!b) return fid >= ui.minF; const q = q2(fid); return q >= b[0] && q <= b[1]; };
  const pMin = () => bandOf() ? Math.max(0.2, 1 / bandOf()[1] - 0.2) : 0.5;
  const GROUPS = {
    esito: ['1x2', 'dc'], gol: ['gol_tot_ge', 'gol_tot_le', 'gol_h_ge', 'gol_a_ge', 'btts'],
    corner: ['corner_tot_ge', 'corner_tot_le', 'corner_h_ge', 'corner_a_ge'],
    tiri: ['tiri_tot_ge', 'tiri_h_ge', 'tiri_a_ge', 'tiri_porta_tot_ge', 'tiri_porta_h_ge', 'tiri_porta_a_ge'],
    disciplina: ['falli_tot_ge', 'falli_h_ge', 'falli_a_ge', 'cartellini_tot_ge', 'cartellini_h_ge', 'cartellini_a_ge'],
  };
  const GN = { tutti: 'Tutti i mercati', esito: 'Esito e doppia chance', gol: 'Gol, over/under, goal/no goal', corner: 'Corner', tiri: 'Tiri e tiri in porta', disciplina: 'Falli e cartellini' };
  const GSHORT = { esito: 'Esito', gol: 'Gol', corner: 'Corner', tiri: 'Tiri', disciplina: 'Disciplina', giocatore: 'Giocatore' };
  const groupOf = fam => Object.keys(GROUPS).find(g => GROUPS[g].includes(fam));
  // codice, plurale, singolare, soglie, statistica di squadra che ne influenza il ritmo, di chi (propria o avversaria)
  const PST = [['tiri', 'tiri', 'tiro', [1, 2, 3, 4], 'tiri', 'own'], ['tiri_porta', 'tiri in porta', 'tiro in porta', [1, 2, 3], 'tiri_porta', 'own'],
    ['gol', 'gol', 'gol', [1, 2], 'gol', 'own'], ['assist', 'assist', 'assist', [1], 'gol', 'own'], ['ga', 'gol o assist', 'gol o assist', [1, 2], 'gol', 'own'],
    ['falli_commessi', 'falli commessi', 'fallo commesso', [1, 2, 3], 'falli', 'own'], ['falli_subiti', 'falli subiti', 'fallo subito', [1, 2, 3], 'falli', 'opp']];
  const PSTN = { tiri: 'Tiri', tiri_porta: 'Tiri in porta', gol: 'Gol', assist: 'Assist', ga: 'Gol o assist', falli_commessi: 'Falli commessi', falli_subiti: 'Falli subiti' };
  // pesi dell'indice di fiducia
  const WT = { modello: 0.45, storico: 0.2, squadre: 0.25, campionato: 0.1 };
  const WP = { modello: 0.45, storico: 0.2, ultime5: 0.2, stagione: 0.15 };
  // calibrazione della fiducia: rendimento reale dei consigli passati (calcolato ogni mattina su GitHub, file data/calib.json)
  let CAL = null;
  async function loadCal() { if (CAL === null) CAL = (await C.getJSON('data/calib.json', true)) || {}; return CAL; }
  function cal(kind, f) {
    if (ui.raw || !CAL || !CAL[kind] || f == null) return f;
    const pts = CAL[kind].filter(b => b.n >= 20).map(b => [b.f, (b.y + 40 * b.f) / (b.n + 40)]);
    if (pts.length < 2) return f;
    if (f <= pts[0][0]) return Math.max(0.01, f + pts[0][1] - pts[0][0]);
    for (let i = 1; i < pts.length; i++) if (f <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (f - x0) / (x1 - x0); }
    const L = pts[pts.length - 1]; return Math.min(0.99, f + L[1] - L[0]);
  }
  function blend(sig, W) {
    let s = 0, w = 0; Object.entries(sig).forEach(([k, v]) => { if (v && v.f != null && W[k]) { s += W[k] * v.f; w += W[k]; } });
    return w ? s / w : null;
  }

  // ---------- etichette in stile scommessa
  function market(fam, key, k) {
    if (fam === '1x2' || fam === 'dc') return key;
    if (fam === 'btts') return key === 'si' ? 'Goal' : 'No goal';
    const parts = fam.split('_'); const op = parts.pop(), side = parts.pop(), mt = parts.join('_');
    const name = { gol: '', corner: 'Corner ', tiri: 'Tiri ', tiri_porta: 'Tiri in porta ', falli: 'Falli ', cartellini: 'Cartellini ' }[mt] || '';
    const who = side === 'h' ? 'casa ' : side === 'a' ? 'ospite ' : '';
    const s = (name + who + (op === 'ge' ? 'over ' + nf(k - 0.5, 1) : 'under ' + nf(k + 0.5, 1))).trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const fair = f => nf(1 / f, 2);
  function hist(ev, lg, fam, p) {
    const b = ((((ev.by || {})[lg] || {})[fam]) || {}).bins; if (!b) return null;
    const bin = b.find(z => p >= z.da && p < z.a) || b[b.length - 1];
    return bin && bin.n ? { f: bin.verificati / bin.n, n: bin.n } : null;
  }
  const relChip = r => `<span class="rel rel-${String(r).replace(' ', '-')}">${esc(r)}</span>`;
  const SIGN = { modello: 'Modello', storico: 'Storico', squadre: 'Squadre', campionato: 'Campionato', ultime5: 'Ultime 5', stagione: 'Stagione' };
  const sigLine = sig => Object.entries(sig).filter(([, v]) => v && v.f != null).map(([k, v]) =>
    `<span class="sg ${v.f >= 0.6 ? 'ok' : v.f < 0.45 ? 'ko' : ''}">${SIGN[k]} ${v.y != null ? `${v.y}/${v.n}` : pc(v.f)}</span>`).join('');
  const agree = sig => { const v = Object.values(sig).filter(z => z && z.f != null); return { si: v.filter(z => z.f >= 0.6).length, n: v.length }; };
  const level = f => f >= 0.85 ? 'l4' : f >= 0.75 ? 'l3' : f >= 0.65 ? 'l2' : 'l1';

  // ---------- partite del periodo
  function currentMd(d) {
    const now = Date.now();
    const up = d.matches.filter(m => !m.g && m.t > now - 864e5 && m.st !== 'POSTPONED').sort((a, b) => a.t - b.t)[0];
    return up ? up.mo || up.md || 1 : null;
  }
  function pickMatches(x) {
    const now = Date.now();
    let list = x.d.matches.filter(m => !m.g && m.t > now - 10 * 60e3 && !['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(m.st));
    if (ui.only) return list.filter(m => ui.only.has(m.i));
    if (ui.per === 'giornata') { const md = currentMd(x.d); list = list.filter(m => (m.mo || m.md) === md); }
    else if (ui.per === 'oggi') { const k = C.dayKey(now); list = list.filter(m => C.dayKey(m.t) === k); }
    else { const days = ui.per === '3g' ? 3 : 7; list = list.filter(m => m.t <= now + days * 864e5); }
    return list.sort((a, b) => a.t - b.t);
  }
  function pickPast(x) {
    const now = Date.now(), from = now - ui.past * 864e5;
    return x.d.matches.filter(m => m.g && m.t >= from && m.t < now).sort((a, b) => b.t - a.t);
  }

  // ---------- partite e squadre: modello + storico verificato + storico delle due squadre + frequenza del campionato
  async function teamTips(x, m, ev) {
    const pr = x.P[m.i]; if (!pr || !pr.p) return [];
    const mx = await MatchView.load(m.i); if (!mx || !mx.p) return [];
    const rel = ev.reliability[x.L.code] || {};
    const byFam = {}; const pm = pMin(); const B = bandOf();
    MatchView.eventRows(mx).forEach(r => {
      if (r.na) return;
      const g = groupOf(r.fam); if (!g || (ui.mk !== 'tutti' && ui.mk !== g)) return;
      if (r.p < pm || r.p > MAXP) return;
      const rl = rel[r.fam] || 'non valutabile';
      if (ui.rel === 'alta' ? rl !== 'alta' : !['alta', 'media'].includes(rl)) return;
      const h = hist(ev, x.L.code, r.fam, r.p);
      const tm = [r.hf, r.af].filter(Boolean); const ty = tm.reduce((a, z) => a + z.y, 0), tn = tm.reduce((a, z) => a + z.n, 0);
      const sig = { modello: { f: r.p }, storico: h && h.n >= 30 ? { f: h.f, n: h.n } : null,
        squadre: tn >= 6 ? { f: ty / tn, y: ty, n: tn } : null, campionato: r.lf && r.lf.n >= 50 ? { f: r.lf.f } : null };
      const raw = blend(sig, WT); const fid = cal('squadra', raw);
      if (fid == null || !inScope(fid)) return;
      const cur = byFam[r.fam];
      // senza fascia: la linea piu' impegnativa sopra la soglia; con la fascia: la piu' solida dentro la fascia
      const better = !cur || (B ? fid > cur.fid : (r.fam.endsWith('_ge') ? r.k > cur.k : r.fam.endsWith('_le') ? r.k < cur.k : fid > cur.fid));
      if (better) byFam[r.fam] = { fam: r.fam, key: r.key, k: r.k, p: r.p, fid, raw, sig, rel: rl, h, label: r.label };
    });
    return Object.values(byFam).map(t => Object.assign(t, { kind: 'squadra', id: `${m.i}|${t.fam}|${t.key}|${t.k}`, m, x, g: groupOf(t.fam), mk: market(t.fam, t.key, t.k), H: mx.H, A: mx.A }));
  }

  // ---------- giocatori: ritmo stagionale corretto per la partita + storico verificato + ultime 5 + stagione
  const pois = (lam, k) => { let s = 0, t = Math.exp(-lam); for (let i = 0; i < k; i++) { s += t; t *= lam / (i + 1); } return 1 - s; };
  function rateOf(tot, minK, code) {
    if (code === 'ga') {
      if (tot.gol == null || tot.assist == null) return null;
      const mk = Math.min(minK.gol || 0, minK.assist || 0); return mk >= 450 ? (tot.gol + tot.assist) / mk * 90 : null;
    }
    if (tot[code] == null) return null; const mk = minK[code] || 0; return mk >= 450 ? tot[code] / mk * 90 : null;
  }
  const outcomeOf = (v, code) => code === 'ga' ? (v.gol != null && v.assist != null ? v.gol + v.assist : null) : v[code];
  function pCalib(x) {
    if (x.pd._calib) return x.pd._calib;
    const B = {};
    Object.values(x.pd.byPlayer).forEach(list => {
      const rows = list.filter(r => x.d.byId[r.mid]).slice().sort((a, b) => a.t - b.t);
      const tot = {}, minK = {}, sm = []; let min = 0;
      rows.forEach(r => {
        const mins = r.v.minuti || 0;
        if (mins && r.v.titolare && min >= 450 && sm.length >= 3) {
          const last = sm.slice(-5); const exp = last.reduce((a, b) => a + b, 0) / last.length;
          PST.forEach(([code, , , ks]) => {
            const rt = rateOf(tot, minK, code); if (rt == null) return;
            const y = outcomeOf(r.v, code); if (y == null) return;
            ks.forEach(k => {
              const p = pois(rt * exp / 90, k); const b = Math.min(9, Math.floor(p * 10));
              const arr = B[code + ':' + k] = B[code + ':' + k] || Array.from({ length: 10 }, () => [0, 0]);
              arr[b][0]++; if (y >= k) arr[b][1]++;
            });
          });
        }
        if (mins) {
          min += mins; if (r.v.titolare) sm.push(mins);
          Object.entries(r.v).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v; minK[k] = (minK[k] || 0) + mins; });
        }
      });
    });
    return (x.pd._calib = B);
  }
  function phist(x, code, k, p) {
    const a = (pCalib(x)[code + ':' + k] || [])[Math.min(9, Math.floor(p * 10))];
    return a && a[0] ? { f: a[1] / a[0], n: a[0] } : null;
  }
  function starters(x, m, tid) {
    const lu = ((x.pd.lineups || {})[m.i] || []).filter(r => r[1] === tid && r[3] === 'ufficiale' && r[2] === 'titolare').map(r => r[0]);
    if (lu.length >= 9) return { ids: new Set(lu), off: true };
    if (m.g) return { ids: new Set((x.pd.byMatch[m.i] || []).filter(r => r.tid === tid && r.v.titolare).map(r => r.pid)), off: true };
    const past = x.d.matches.filter(z => z.g && z.t < m.t && (z.h === tid || z.a === tid) && x.pd.byMatch[z.i]).sort((a, b) => b.t - a.t).slice(0, 5);
    if (past.length < 3) return { ids: new Set(), off: false };
    const cnt = {};
    past.forEach(z => x.pd.byMatch[z.i].forEach(r => { if (r.tid === tid && r.v.titolare && r.v.minuti) cnt[r.pid] = (cnt[r.pid] || 0) + 1; }));
    const need = Math.max(3, Math.ceil(past.length * 0.8));
    return { ids: new Set(Object.keys(cnt).filter(p => cnt[p] >= need)), off: false };
  }
  // media stagionale di una statistica di squadra prima della partita (per correggere il ritmo del giocatore)
  function teamAvg(x, tid, metric, before) {
    let s = 0, n = 0;
    x.d.matches.forEach(z => {
      if (!z.g || z.t >= before || (z.h !== tid && z.a !== tid)) return;
      const v = metric === 'gol' ? z.g : z.s && z.s[metric]; if (!v || v[0] == null) return;
      s += z.h === tid ? v[0] : v[1]; n++;
    });
    return n >= 4 ? s / n : null;
  }
  function matchFactor(x, m, tid, metric, who) {
    const pm = x.P[m.i] && x.P[m.i].p && x.P[m.i].p.m[metric]; if (!pm || !pm.l) return 1;
    const t = who === 'own' ? tid : (tid === m.h ? m.a : m.h);
    const exp = pm.l[t === m.h ? 0 : 1], typ = teamAvg(x, t, metric, m.t);
    return typ ? Math.min(1.35, Math.max(0.75, exp / typ)) : 1;
  }
  function playerTips(x, m) {
    if (!x.pd) return [];
    const out = []; const pm = pMin(); const B = bandOf();
    [m.h, m.a].forEach(tid => {
      const st = starters(x, m, tid); if (!st.ids.size || (ui.pOff && !st.off)) return;
      C.pAgg(x.pd, { tid, before: m.t, d: x.d }).forEach(o => {
        if (!st.ids.has(o.pid) || o.min < 450) return;
        const startsRows = o.ms.filter(r => r.v.titolare && r.v.minuti).sort((a, b) => a.t - b.t);
        const sm = startsRows.map(r => r.v.minuti).slice(-5);
        if (sm.length < 3) return;
        const exp = sm.reduce((a, b) => a + b, 0) / sm.length;
        PST.forEach(([code, plur, sing, ks, metric, who]) => {
          if (ui.pstat !== 'tutte' && ui.pstat !== code) return;
          const rt = rateOf(o.tot, o.minK, code); if (rt == null) return;
          const fac = matchFactor(x, m, tid, metric, who);
          const ys = startsRows.map(r => outcomeOf(r.v, code)).filter(v => v != null);
          let best = null;
          ks.forEach(k => {
            const p = pois(rt * fac * exp / 90, k); if (p < pm || p > MAXP) return;
            const l5 = ys.slice(-5), hy = l5.filter(v => v >= k).length, sy = ys.filter(v => v >= k).length;
            const h = phist(x, code, k, p);
            const sig = { modello: { f: p }, storico: h && h.n >= 30 ? { f: h.f, n: h.n } : null,
              ultime5: l5.length >= 3 ? { f: hy / l5.length, y: hy, n: l5.length } : null, stagione: ys.length >= 5 ? { f: sy / ys.length, y: sy, n: ys.length } : null };
            const raw = blend(sig, WP); const fid = cal('giocatore', raw);
            if (fid != null && inScope(fid) && (!best || (B ? fid > best.fid : k > best.k))) best = { k, p, fid, raw, sig, h };
          });
          if (!best) return;
          const what = code === 'gol' ? (best.k === 1 ? 'Segna' : `Almeno ${best.k} gol`) : code === 'assist' ? 'Fa almeno un assist' : code === 'ga' ? (best.k === 1 ? 'Segna o fa assist' : `Almeno ${best.k} tra gol e assist`) : `Almeno ${best.k} ${best.k === 1 ? sing : plur}`;
          out.push(Object.assign(best, { kind: 'giocatore', g: 'giocatore', id: `${m.i}|${o.pid}|${code}|${best.k}`, m, x, pid: o.pid, name: o.name, role: o.role, tid,
            team: C.teamName(x.d, tid), code, off: st.off, exp, rate: rt, fac, mk: what, label: `${esc(o.name)}: ${what.toLowerCase()}`,
            H: C.teamName(x.d, m.h), A: C.teamName(x.d, m.a) }));
        });
      });
    });
    return out;
  }

  // ---------- schedina: una selezione per partita, le piu' solide secondo tutti i dati
  function schedina(all) {
    const pool = all.filter(t => (ui.conPl || t.kind === 'squadra') && t.fid >= 0.5).sort((a, b) => b.fid - a.fid);
    const target = +ui.target || 0;
    const greedy = list => { const used = new Set(), pick = []; for (const t of list) { if (used.has(t.m.i)) continue; pick.push(t); used.add(t.m.i); if (pick.length >= 8) break; } return pick; };
    if (!target) return greedy(pool);
    // quota obiettivo: il minor numero di selezioni (ognuna almeno al 50%) che arriva alla quota. Per definizione la probabilita'
    // della schedina e' 1/quota giusta, quindi conta non sforare troppo la quota e usare poche selezioni (meno errori del modello)
    const byM = new Map(); for (const t of pool) { if (!byM.has(t.m.i)) byM.set(t.m.i, []); byM.get(t.m.i).push(t); } // ogni lista: dalla piu' sicura
    const Q = p => p.reduce((a, z) => a / z.fid, 1);
    const upgrade = start => { // alza la quota col passo piu' piccolo possibile finche' si arriva all'obiettivo
      const pick = start.slice();
      for (let it = 0; it < 80 && Q(pick) < target * 0.97; it++) {
        let bi = -1, bz = null, step = Infinity;
        pick.forEach((t, i) => { const z = byM.get(t.m.i).find(o => o.fid < t.fid - 1e-9); if (z && t.fid / z.fid < step) { step = t.fid / z.fid; bi = i; bz = z; } });
        if (bi < 0) break; pick[bi] = bz;
      }
      return pick;
    };
    for (let n = 1; n <= Math.min(10, byM.size); n++) {
      const qn = Math.pow(target, 1 / n);
      const first = [...byM.values()].map(L => L.find(z => 1 / z.fid >= qn * 0.93)).filter(Boolean).sort((a, b) => b.fid - a.fid).slice(0, n);
      if (first.length < n) continue;
      const pick = upgrade(first), q = Q(pick);
      if (q >= target * 0.97 && q <= target * 1.3) return pick;
    }
    // obiettivo troppo alto (o troppo preciso) per le partite scelte: tutte le partite, dalla giocata piu' sicura, alzate a piccoli passi
    const tops = [...byM.values()].map(L => L[0]).sort((a, b) => b.fid - a.fid);
    let pick = [];
    for (const t of tops) { pick.push(t); if (Q(pick) >= target * 0.97 || pick.length >= 12) break; }
    if (Q(pick) < target * 0.97) pick = upgrade(tops.slice(0, 12));
    return pick;
  }

  // ---------- registro delle giocate e quote inserite: solo su questo dispositivo
  const QK = 'calcio-quote', GK = 'calcio-giocate';
  const load = k => { try { return JSON.parse(localStorage.getItem(k) || (k === GK ? '[]' : '{}')); } catch (e) { return k === GK ? [] : {}; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* non disponibile */ } };
  function verdict(q, f) {
    if (!q || !(q > 1)) return '';
    const v = q * f - 1;
    const cls = v >= ui.margin ? 'ok' : v >= 0 ? 'mid' : 'ko';
    const txt = v >= ui.margin ? 'Possibile errore di quota' : v >= 0 ? 'Poco sopra il giusto' : 'Quota nella norma o bassa';
    return `<span class="vq ${cls}"><b>${v >= 0 ? '+' : '−'}${nf(Math.abs(v) * 100, 0)}%</b> ${txt}<span class="sub"> · su 10 € il valore atteso è ${v >= 0 ? '+' : '−'}${nf(Math.abs(v) * 10, 2)} €</span></span>`;
  }
  const legOf = t => ({ lg: t.x.L.code, s: t.x.s, mid: t.m.i, kind: t.kind, fam: t.fam, key: t.key, k: t.k, pid: t.pid, code: t.code,
    mk: t.mk, name: t.name || '', H: t.H, A: t.A, ko: t.m.ko, fid: t.fid });
  async function legStatus(l) {
    const d = await C.season(l.lg, l.s); const m = d && d.byId[l.mid];
    if (!m) return 'n.d.';
    if (['POSTPONED', 'CANCELLED'].includes(m.st)) return 'nulla';
    if (!m.g) return 'attesa';
    if (l.kind === 'squadra') { const o = CM.outcome(l.fam, l.key, l.k, C.res(m)); return o == null ? 'n.d.' : o ? 'vinta' : 'persa'; }
    const pd = await C.players(l.lg, l.s); const r = pd && (pd.byMatch[l.mid] || []).find(z => z.pid === l.pid);
    if (!r || !r.v.minuti) return pd && pd.byMatch[l.mid] ? 'nulla' : 'attesa';
    const y = outcomeOf(r.v, l.code); return y == null ? 'n.d.' : y >= l.k ? 'vinta' : 'persa';
  }
  const ST = { vinta: '✓ vinta', persa: '✗ persa', attesa: 'in attesa', nulla: 'nulla (rimborso)', 'n.d.': 'non verificabile' };

  // ---------- tabelle
  const matchCell = t => `<a href="${C.matchUrl(t.m, t.kind === 'giocatore' ? 'giocatori' : 'eventi')}">${esc(t.H)} – ${esc(t.A)}</a><div class="sub">${esc(t.x.L.name)} · ${C.dshort(t.m.ko)} ${C.hm(t.m.ko)}</div>`;
  const fidCell = t => { const a = agree(t.sig); return `<b class="big ${level(t.fid)}" title="${t.raw != null && Math.abs(t.raw - t.fid) >= 0.005 ? 'prima della calibrazione ' + pc(t.raw) : ''}">${pc(t.fid)}</b><span class="meter ${level(t.fid)}"><i style="width:${Math.round(t.fid * 100)}%"></i></span><div class="sub">${a.si}/${a.n} dati d'accordo</div>`; };
  const mkCell = t => `<span class="mkt mk-${t.g}">${GSHORT[t.g] || ''}</span> <b>${esc(t.mk)}</b><div class="sub">${t.kind === 'giocatore' ? esc(PSTN[t.code]) + ` · ${nf(t.rate, 2)}/90'` + (Math.abs(t.fac - 1) >= 0.05 ? ` · partita ×${nf(t.fac, 2)}` : '') + ` · ${Math.round(t.exp)}' attesi` : t.label}</div>`;
  const addBtn = t => `<button class="add" data-add="${esc(t.id)}" title="Aggiungi alle mie giocate" aria-label="Aggiungi alle mie giocate">＋</button>`;
  function kpis(list) {
    if (!list.length) return '';
    const avg = list.reduce((a, t) => a + t.fid, 0) / list.length; const top = list.slice().sort((a, b) => b.fid - a.fid)[0];
    return `<div class="kpis"><div class="kpi hi"><b>${list.length}</b><span>scommesse trovate</span><i>${bandOf() ? 'quota giusta tra ' + nf(bandOf()[0], 2) + ' e ' + nf(bandOf()[1], 2) : 'fiducia almeno ' + pc(ui.minF)}</i></div>
      <div class="kpi"><b>${pc(avg)}</b><span>fiducia media</span><i>quota giusta media ${nf(1 / avg, 2)}</i></div>
      <div class="kpi"><b>${pc(top.fid)}</b><span>la più solida</span><i>${esc(top.H)} – ${esc(top.A)}: ${esc(top.kind === 'giocatore' ? top.name + ', ' + top.mk.toLowerCase() : top.mk)}</i></div></div>`;
  }
  function teamTable(tips) {
    const byMatch = {};
    tips.slice().sort((a, b) => b.fid - a.fid).forEach(t => {
      const o = byMatch[t.m.i] = byMatch[t.m.i] || { g: new Set(), list: [] };
      if (o.g.has(t.g) || o.list.length >= 3) return; o.g.add(t.g); o.list.push(t);
    });
    const shown = Object.values(byMatch).flatMap(o => o.list).sort((a, b) => b.fid - a.fid);
    if (!shown.length) return '<p class="empty">Nessuna scommessa con questi filtri. Prova un\'altra fascia di quota, abbassa la fiducia minima o allarga il periodo.</p>';
    return kpis(shown) + `<div class="scroll"><table class="evt tips"><thead><tr><th>Partita</th><th>Scommessa</th><th class="num">Fiducia</th><th>Cosa dicono i dati</th><th class="num">Quota giusta</th><th>Affidabilità</th><th></th></tr></thead><tbody>${shown.map(t =>
      `<tr><td>${matchCell(t)}</td><td>${mkCell(t)}</td><td class="num">${fidCell(t)}</td><td class="sigs">${sigLine(t.sig)}</td><td class="num"><b>${fair(t.fid)}</b></td><td>${relChip(t.rel)}</td><td>${addBtn(t)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note"><b>Fiducia</b>: media pesata di tutti i dati dell'app: probabilità del <b>modello</b> (forza delle squadre, campo, avversario, arbitro), <b>storico</b> verificato del modello per quel tipo di evento, <b>squadre</b> (quante volte l'evento si è verificato nelle partite in casa della squadra di casa e in trasferta dell'ospite) e frequenza nel <b>campionato</b>. In verde i dati sopra il 60%. Al massimo 3 scommesse per partita, di tipo diverso. La fiducia è <b>calibrata</b> ogni mattina sul rendimento reale dei consigli della stagione (scheda Rendimento): se in passato le scommesse date all'85% sono riuscite l'80% delle volte, l'app lo corregge. <b>Quota giusta</b> = 1 ÷ fiducia: quanto dovrebbe pagare la scommessa se i dati hanno ragione. Con ＋ la aggiungi alle tue giocate.</p>`;
  }
  function playerTable(tips) {
    const shown = tips.sort((a, b) => b.fid - a.fid).slice(0, 150);
    if (!shown.length) return '<p class="empty">Nessuna scommessa sui giocatori con questi filtri. Servono almeno 450 minuti e 3 partite da titolare.</p>';
    return kpis(shown) + `<div class="scroll"><table class="evt tips"><thead><tr><th>Giocatore</th><th>Partita</th><th>Scommessa</th><th class="num">Fiducia</th><th>Cosa dicono i dati</th><th class="num">Quota giusta</th><th></th></tr></thead><tbody>${shown.map(t =>
      `<tr><td><a href="#giocatore-${esc(t.pid)}">${esc(t.name)}</a><div class="sub">${esc(t.team)} · ${esc(t.role)} · ${t.off ? '<b>titolare ufficiale</b>' : 'titolare probabile'}</div></td><td>${matchCell(t)}</td><td>${mkCell(t)}</td><td class="num">${fidCell(t)}</td><td class="sigs">${sigLine(t.sig)}</td><td class="num"><b>${fair(t.fid)}</b></td><td>${addBtn(t)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Solo titolari: dalla formazione ufficiale se già uscita (controllo ogni 30 minuti), altrimenti chi è partito titolare in almeno 4 delle ultime 5. <b>Modello</b>: ritmo stagionale ogni 90 minuti × minuti attesi, corretto per la partita (per esempio più tiri se la squadra è attesa sopra la sua media, più falli subiti se l'avversario fa molti falli). <b>Storico</b>: stessa regola verificata sulle partite già giocate. <b>Ultime 5</b> e <b>stagione</b>: in quante partite da titolare il giocatore ci è riuscito. Se il giocatore va in panchina la scommessa non vale.</p>`;
  }
  function slipView(all) {
    const pick = schedina(all);
    if (!pick.length) return '<p class="empty">Nessuna selezione disponibile con questi filtri.</p>';
    const target = +ui.target || 0;
    const sel = target ? pick : pick.slice(0, ui.n);
    const F = sel.reduce((a, t) => a * t.fid, 1);
    const reached = !target || 1 / F >= target * 0.97;
    let cum = 1; const curve = pick.map((t, i) => { cum *= t.fid; return [i + 1, cum]; });
    return `${target && !reached ? `<p class="warn">Con le partite e i filtri scelti non si arriva a quota ${nf(target, 2)}: qui sotto la migliore combinazione possibile.</p>` : ''}
      <div class="kpis"><div class="kpi hi"><b>${pc(F, 1)}</b><span>probabilità che vadano tutte bene, secondo tutti i dati</span><i>circa 1 volta ogni ${nf(1 / F, 1)}</i></div>
      <div class="kpi"><b>${nf(1 / F, 2)}</b><span>quota giusta della schedina</span><i>se il bookmaker paga di più, è sopra il valore</i></div>
      <div class="kpi"><b>${sel.length}</b><span>selezioni</span><i>una per partita</i></div></div>
      <div class="scroll"><table class="evt tips"><thead><tr><th>#</th><th>Partita</th><th>Selezione</th><th class="num">Fiducia</th><th>Cosa dicono i dati</th><th class="num">Quota giusta</th></tr></thead><tbody>${sel.map((t, i) =>
        `<tr><td>${i + 1}</td><td>${matchCell(t)}</td><td>${mkCell(t)}${t.kind === 'giocatore' ? `<div class="sub">${esc(t.name)} · ${t.off ? 'titolare ufficiale' : 'titolare probabile'}</div>` : ''}</td><td class="num">${fidCell(t)}</td><td class="sigs">${sigLine(t.sig)}</td><td class="num"><b>${fair(t.fid)}</b></td></tr>`).join('')}</tbody></table></div>
      <p><button class="btn primary" id="c-saveslip">＋ Salva questa schedina tra le mie giocate</button></p>
      ${target ? '' : `<h3>Quante selezioni mettere</h3><div class="scroll"><table><thead><tr><th>Selezioni</th>${curve.map(c => `<th class="num${c[0] === ui.n ? ' hl' : ''}">${c[0]}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Tutte vincenti</td>${curve.map(c => `<td class="num${c[0] === ui.n ? ' hl' : ''}">${pc(c[1], 0)}</td>`).join('')}</tr>
      <tr><td>Quota giusta</td>${curve.map(c => `<td class="num${c[0] === ui.n ? ' hl' : ''}">${nf(1 / c[1], 2)}</td>`).join('')}</tr></tbody></table></div>`}
      <p class="note"><b>Perché non esiste una schedina perfetta.</b> Ogni selezione in più moltiplica le probabilità: anche con eventi all'80%, cinque insieme riescono circa una volta su tre (0,8 × 0,8 × 0,8 × 0,8 × 0,8 = 33%). Qui c'è la combinazione più solida secondo tutti i dati dell'app: per ogni partita al massimo un evento, così le selezioni non dipendono l'una dall'altra. Con la <b>quota obiettivo</b> l'app cerca il minor numero di selezioni (ognuna almeno al 50%) che arriva a quella quota: a parità di quota la probabilità di vincere è sempre circa 1 ÷ quota, ma con meno selezioni si sommano meno errori.</p>`;
  }
  function oddsView(all) {
    const q = load(QK);
    const shown = all.slice().sort((a, b) => b.fid - a.fid).slice(0, 150);
    if (!shown.length) return '<p class="empty">Nessuna scommessa con questi filtri.</p>';
    return `<p class="info">L'app non può leggere da sola le quote di bet365 e Sisal: le loro condizioni non permettono di prelevarle automaticamente e i servizi che le rivendono sono a pagamento. <b>Scrivi tu la quota</b> che vedi su bet365, Sisal o un altro sito: l'app la confronta subito con la quota giusta e ti dice se è un errore di quota. Le quote che scrivi restano solo su questo dispositivo.</p>
      <div class="toolbar"><label class="sel">Errore di quota se sopra il giusto di <select id="c-mg">${[0.05, 0.1, 0.15, 0.2].map(v => opt(v, '+' + Math.round(v * 100) + '%', ui.margin)).join('')}</select></label>
      <button class="btn" id="c-clear">Cancella le quote inserite</button></div>
      <div class="scroll"><table class="evt tips quote"><thead><tr><th>Partita</th><th>Scommessa</th><th class="num">Fiducia</th><th class="num">Quota giusta</th><th class="num">Errore se sopra</th><th>Quota del bookmaker</th><th></th></tr></thead><tbody>${shown.map(t =>
        `<tr><td>${matchCell(t)}</td><td>${mkCell(t)}${t.kind === 'giocatore' ? `<div class="sub">${esc(t.name)}</div>` : ''}</td><td class="num">${fidCell(t)}</td><td class="num">${fair(t.fid)}</td><td class="num"><b>${nf((1 + ui.margin) / t.fid, 2)}</b></td>
        <td><input class="qin" type="text" inputmode="decimal" autocomplete="off" placeholder="es. ${nf(Math.max(1.05, 1 / t.fid * 1.05), 2)}" data-qid="${esc(t.id)}" data-f="${t.fid}" value="${q[t.id] ? nf(q[t.id], 2) : ''}" aria-label="Quota del bookmaker"><div class="qv" data-qv="${esc(t.id)}">${verdict(q[t.id], t.fid)}</div></td><td>${addBtn(t)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note"><b>Come leggerlo.</b> Quota giusta = 1 ÷ fiducia. Se il bookmaker paga più della soglia "errore se sopra", la quota è più alta di quanto i dati dicono che dovrebbe essere: è un possibile errore di quota. Il valore atteso indica quanto renderebbe in media ogni 10 € giocati se la fiducia è corretta. Una quota molto alta può anche voler dire che il bookmaker sa qualcosa che i dati non vedono (un infortunio, un cambio di formazione): controlla sempre le notizie e la verifica in <a href="#precisione">Quanto è preciso?</a>.</p>`;
  }
  async function trackerView() {
    const gs = load(GK);
    if (!gs.length) return `<p class="empty">Non hai ancora salvato giocate. Tocca ＋ accanto a una scommessa (o "Salva questa schedina") e la ritrovi qui: l'app controlla da sola l'esito dopo la partita.</p>`;
    let stake = 0, ret = 0, won = 0, lost = 0, open = 0;
    const rows = [];
    for (const g of gs.slice().reverse()) {
      const sts = []; for (const l of g.legs) sts.push(await legStatus(l));
      const st = sts.includes('persa') ? 'persa' : sts.every(s => s === 'vinta' || s === 'nulla') && sts.some(s => s === 'vinta') ? 'vinta' : sts.every(s => s === 'nulla') ? 'nulla' : sts.includes('attesa') ? 'attesa' : 'n.d.';
      const q = +g.quota || 0, s = +g.stake || 0;
      if (st === 'vinta') { won++; if (s && q) { stake += s; ret += s * q; } }
      else if (st === 'persa') { lost++; if (s) stake += s; }
      else if (st === 'attesa') open++;
      rows.push(`<tr class="gst-${st.replace('.', '')}"><td>${g.legs.map((l, i) => `<div><b>${esc(l.mk)}</b>${l.kind === 'giocatore' ? ' · ' + esc(l.name) : ''} <span class="sub">${esc(l.H)} – ${esc(l.A)} · ${C.dshort(l.ko)}</span> <span class="lst lst-${sts[i].replace('.', '')}">${ST[sts[i]]}</span></div>`).join('')}<div class="sub">salvata ${C.dtime(g.ts)} · fiducia ${pc(g.legs.reduce((a, l) => a * (l.fid || 1), 1))}</div></td>
        <td><input class="qin" type="text" inputmode="decimal" data-gq="${esc(g.id)}" value="${g.quota ? nf(g.quota, 2) : ''}" placeholder="quota" aria-label="Quota giocata"></td>
        <td><input class="qin" type="text" inputmode="decimal" data-gs="${esc(g.id)}" value="${g.stake ? nf(g.stake, 2) : ''}" placeholder="€" aria-label="Importo giocato"></td>
        <td><span class="lst lst-${st.replace('.', '')}">${ST[st]}</span>${st === 'vinta' && q && s ? `<div class="sub">+${nf(s * q - s, 2)} €</div>` : st === 'persa' && s ? `<div class="sub">−${nf(s, 2)} €</div>` : ''}</td>
        <td><button class="add del" data-del="${esc(g.id)}" title="Elimina" aria-label="Elimina">✕</button></td></tr>`);
    }
    const bal = ret - stake; const done = won + lost;
    return `<div class="kpis"><div class="kpi hi"><b>${done ? pc(won / done) : 'n.d.'}</b><span>giocate vinte</span><i>${won} vinte, ${lost} perse, ${open} in attesa</i></div>
      <div class="kpi"><b>${(bal >= 0 ? '+' : '−') + nf(Math.abs(bal), 2)} €</b><span>bilancio</span><i>giocate concluse con quota e importo</i></div>
      <div class="kpi"><b>${nf(stake, 2)} €</b><span>giocato</span><i>${stake ? 'rendimento ' + (bal >= 0 ? '+' : '−') + nf(Math.abs(bal) / stake * 100, 1) + '%' : 'inserisci quota e importo'}</i></div></div>
      <div class="scroll"><table class="evt tips track"><thead><tr><th>Giocata</th><th>Quota</th><th>Importo</th><th>Esito</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p class="note">L'esito si aggiorna da solo con i risultati e le statistiche della partita (controllo ogni 30 minuti). Una scommessa su un giocatore che non entra in campo è considerata nulla. Il registro resta solo su questo dispositivo.</p>`;
  }
  async function perfView(team, pl) {
    const all = team.concat(pl).filter(t => t.res === 'vinta' || t.res === 'persa');
    if (!all.length) return '<p class="empty">Nessuna partita conclusa nel periodo scelto.</p>';
    const w = all.filter(t => t.res === 'vinta').length;
    const units = all.reduce((a, t) => a + (t.res === 'vinta' ? 1 / t.fid - 1 : -1), 0);
    const expW = all.reduce((a, t) => a + t.fid, 0);
    const grp = (keyFn, order) => {
      const g = {}; all.forEach(t => { const k = keyFn(t); (g[k] = g[k] || []).push(t); });
      return (order || Object.keys(g)).filter(k => g[k]).map(k => { const L = g[k]; const y = L.filter(t => t.res === 'vinta').length; const e = L.reduce((a, t) => a + t.fid, 0) / L.length;
        return `<tr><td>${esc(k)}</td><td class="num">${L.length}</td><td class="num">${y}</td><td class="num"><b>${pc(y / L.length)}</b></td><td class="num">${pc(e)}</td><td class="num ${y / L.length >= e ? 'pos' : 'neg'}">${(y / L.length - e >= 0 ? '+' : '−') + nf(Math.abs(y / L.length - e) * 100, 0)} pp</td></tr>`; }).join('');
    };
    const head = `<thead><tr><th></th><th class="num">Scommesse</th><th class="num">Vinte</th><th class="num">% vinte</th><th class="num">Fiducia media</th><th class="num">Differenza</th></tr></thead>`;
    const fb = t => { const f = t.fid; return f >= 0.85 ? '85% e oltre' : f >= 0.75 ? '75–85%' : f >= 0.65 ? '65–75%' : f >= 0.55 ? '55–65%' : 'sotto 55%'; };
    const qb = t => { const q = q2(t.fid); const b = BANDS.find(z => q >= z[0] && q <= z[1]); return b ? `${nf(b[0], 2)}–${nf(b[1], 2)}` : q < 1.10 ? 'sotto 1,10' : 'oltre 3,50'; };
    const last = all.slice().sort((a, b) => b.m.t - a.m.t).slice(0, 40);
    return `<div class="kpis"><div class="kpi hi"><b>${pc(w / all.length)}</b><span>scommesse vinte</span><i>${w} su ${all.length}, ultimi ${ui.past} giorni</i></div>
      <div class="kpi"><b>${pc(expW / all.length)}</b><span>fiducia media dichiarata</span><i>se le due percentuali sono vicine, la fiducia è affidabile</i></div>
      <div class="kpi"><b>${(units >= 0 ? '+' : '−') + nf(Math.abs(units), 1)}</b><span>bilancio a quota giusta</span><i>unità da 1 €: positivo = la fiducia era prudente</i></div></div>
      <h3>Per fascia di fiducia</h3><div class="scroll"><table>${head}<tbody>${grp(fb, ['85% e oltre', '75–85%', '65–75%', '55–65%', 'sotto 55%'])}</tbody></table></div>
      <h3>Per fascia di quota giusta</h3><div class="scroll"><table>${head}<tbody>${grp(qb, ['sotto 1,10'].concat(BANDS.map(b => `${nf(b[0], 2)}–${nf(b[1], 2)}`)).concat(['oltre 3,50']))}</tbody></table></div>
      <h3>Per mercato</h3><div class="scroll"><table>${head}<tbody>${grp(t => t.kind === 'giocatore' ? 'Giocatori: ' + PSTN[t.code] : GN[t.g] || t.g)}</tbody></table></div>
      <h3>Ultime scommesse verificate</h3><div class="scroll"><table class="evt tips"><thead><tr><th>Partita</th><th>Scommessa</th><th class="num">Fiducia</th><th>Esito</th></tr></thead><tbody>${last.map(t =>
        `<tr><td>${matchCell(t)} <span class="sub">${t.m.g.join('–')}</span></td><td>${mkCell(t)}${t.kind === 'giocatore' ? `<div class="sub">${esc(t.name)}</div>` : ''}</td><td class="num">${fidCell(t)}</td><td><span class="lst lst-${t.res}">${ST[t.res]}</span></td></tr>`).join('')}</tbody></table></div>
      <p class="note">Stessi filtri delle altre schede, applicati alle partite già giocate. Le scommesse sulle squadre usano il pronostico ricostruito con i soli dati disponibili prima di ogni partita; il segnale "storico" usa la verifica dell'intera stagione, quindi questi numeri possono essere un po' ottimistici. Le scommesse sui giocatori considerano i titolari effettivi.</p>`;
  }

  // ---------- calcolo (usato anche dallo script delle notifiche su GitHub)
  async function compute(tab) {
    const meta = C.S.meta; const ev = await C.evalData(); await loadCal();
    const Ls = meta.campionati.filter(L => ui.lg === 'tutti' || L.code === ui.lg);
    const xs = await Promise.all(Ls.map(async L => {
      const s = L.current; const [d, P, pd] = await Promise.all([C.season(L.code, s), C.preds(L.code, s), C.players(L.code, s)]);
      return { L, s, d, P: P || {}, pd };
    }));
    const team = [], pl = []; let nMatch = 0, noPred = 0; const mds = [];
    const perf = tab === 'rendimento';
    const wantTeam = tab !== 'giocatori', wantPl = tab === 'giocatori' || tab === 'quote' || perf || (tab === 'schedina' && ui.conPl);
    for (const x of xs) {
      if (!x.d) continue;
      const ms = perf ? pickPast(x) : pickMatches(x); nMatch += ms.length;
      if (!perf && ui.per === 'giornata' && ms.length) mds.push(`${x.L.name} ${ms[0].mo || ms[0].md}ª`);
      for (const m of ms) {
        if (!(x.P[m.i] && x.P[m.i].p)) noPred++;
        const tt = wantTeam ? await teamTips(x, m, ev) : [], pp = wantPl ? playerTips(x, m) : [];
        if (perf) {
          tt.forEach(t => { const o = CM.outcome(t.fam, t.key, t.k, C.res(m)); t.res = o == null ? 'n.d.' : o ? 'vinta' : 'persa'; });
          pp.forEach(t => { const r = (x.pd.byMatch[m.i] || []).find(z => z.pid === t.pid); const y = r && r.v.minuti ? outcomeOf(r.v, t.code) : null; t.res = y == null ? 'n.d.' : y >= t.k ? 'vinta' : 'persa'; });
        }
        team.push(...tt); pl.push(...pp);
      }
    }
    return { team, pl, nMatch, noPred, mds };
  }

  async function view(app, tab) {
    const meta = C.S.meta;
    app.innerHTML = band('<h1>Scommesse consigliate</h1><p class="empty">Calcolo in corso…</p>');
    let res;
    if (tab === 'giocate') res = { team: [], pl: [], nMatch: 0, noPred: 0, mds: [] };
    else if (tab === 'schedina' && +ui.target) { const keep = { minF: ui.minF, band: ui.band }; Object.assign(ui, { minF: 0.5, band: '' }); try { res = await compute(tab); } finally { Object.assign(ui, keep); } }
    else res = await compute(tab);
    const { team, pl, nMatch, noPred, mds } = res;
    const TABS = [['squadre', 'Partite'], ['giocatori', 'Giocatori'], ['schedina', 'Schedina'], ['quote', 'Errori di quota'], ['rendimento', 'Rendimento'], ['giocate', 'Le mie giocate']];
    const seg = `<div class="seg tabsx" role="tablist">${TABS.map(([k, t]) => `<a role="tab" class="segbtn ${tab === k ? 'on' : ''}" href="#consigli${k === 'squadre' ? '' : '-' + k}">${t}</a>`).join('')}</div>`;
    const bandSel = `<label class="sel">Fascia di quota <select id="c-band">${opt('', 'Tutte (usa la fiducia minima)', ui.band)}${BANDS.map((b, i) => opt(i, `${nf(b[0], 2)} – ${nf(b[1], 2)}`, ui.band)).join('')}</select></label>`;
    const tools = tab === 'giocate' ? '' : `<div class="toolbar">
      <label class="sel">Campionato <select id="c-lg">${opt('tutti', 'Tutti', ui.lg)}${meta.campionati.map(L => opt(L.code, L.name, ui.lg)).join('')}</select></label>
      ${tab === 'rendimento' ? `<label class="sel">Periodo <select id="c-past">${[[14, 'Ultimi 14 giorni'], [30, 'Ultimi 30 giorni'], [60, 'Ultimi 60 giorni'], [120, 'Ultimi 120 giorni']].map(([v, t]) => opt(v, t, ui.past)).join('')}</select></label>` :
        `<label class="sel">Periodo <select id="c-per">${[['giornata', 'Prossima giornata'], ['oggi', 'Oggi'], ['3g', 'Prossimi 3 giorni'], ['7g', 'Prossimi 7 giorni']].map(([v, t]) => opt(v, t, ui.per)).join('')}</select></label>`}
      ${bandSel}
      <label class="sel">Fiducia minima <select id="c-min" ${bandOf() ? 'disabled' : ''}>${[0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9].map(v => opt(v, pc(v), ui.minF)).join('')}</select></label>
      ${tab !== 'giocatori' ? `<label class="sel">Affidabilità del modello <select id="c-rel">${opt('media', 'Alta e media', ui.rel)}${opt('alta', 'Solo alta', ui.rel)}</select></label>
        <label class="sel">Mercato <select id="c-mk">${Object.entries(GN).map(([v, t]) => opt(v, t, ui.mk)).join('')}</select></label>` : ''}
      ${['giocatori', 'quote', 'rendimento'].includes(tab) ? `<label class="sel">Statistica giocatore <select id="c-ps">${opt('tutte', 'Tutte', ui.pstat)}${PST.map(([c]) => opt(c, PSTN[c], ui.pstat)).join('')}</select></label>` : ''}
      ${tab === 'giocatori' || tab === 'quote' ? `<label class="sel chk"><input type="checkbox" id="c-off" ${ui.pOff ? 'checked' : ''}> Solo formazioni ufficiali</label>` : ''}
      ${tab === 'schedina' ? `<label class="sel">Quota obiettivo <select id="c-tg">${opt('', 'Nessuna', ui.target)}${[1.5, 2, 3, 5, 10].map(v => opt(v, nf(v, 2), ui.target)).join('')}</select></label>
        <label class="sel">Selezioni <select id="c-n" ${ui.target ? 'disabled' : ''}>${[2, 3, 4, 5, 6, 7, 8].map(v => opt(v, v, ui.n)).join('')}</select></label>
        <label class="sel chk"><input type="checkbox" id="c-pl" ${ui.conPl ? 'checked' : ''}> Includi giocatori</label>` : ''}</div>`;
    const scope = tab === 'giocate' ? '' : tab === 'rendimento' ? `${nMatch} partite giocate negli ultimi ${ui.past} giorni` :
      `${nMatch} partite${ui.per === 'giornata' && mds.length ? ' · giornata: ' + mds.join(', ') : ''}${noPred ? ` · ${noPred} senza pronostico (calcolato nei 14 giorni prima della gara)` : ''}`;
    const body = tab === 'giocatori' ? playerTable(pl) : tab === 'schedina' ? slipView(team.concat(pl)) : tab === 'quote' ? oddsView(team.concat(pl)) :
      tab === 'rendimento' ? await perfView(team, pl) : tab === 'giocate' ? await trackerView() : teamTable(team);
    const shown = team.concat(pl); const byId = {}; shown.forEach(t => byId[t.id] = t);
    app.innerHTML = band(`<div class="betshead"><h1>Scommesse consigliate</h1>
      <p class="lead">Le giocate che tutti i dati dell'app ritengono molto probabili: modello, storico verificato, andamento delle squadre e dei giocatori, campionato. Nessuna quota dei bookmaker entra nel calcolo.</p></div>
      ${seg}${tools}${scope ? `<p class="note">${esc(scope)}</p>` : ''}`) + band(body) +
      band(`<details class="howto"><summary><b>Ricevi le notifiche sul tablet</b></summary><ol class="steps">
        <li>Installa l'app gratuita <b>ntfy</b> dal Play Store.</li>
        <li>Inventa un nome difficile da indovinare (es. <code>calcio-${Math.random().toString(36).slice(2, 10)}</code>) e in ntfy tocca <b>+</b> → scrivilo come argomento → <b>Iscriviti</b>.</li>
        <li>Su GitHub, nel repository dell'app: <i>Settings → Secrets and variables → Actions → New repository secret</i>, nome <code>NTFY_TOPIC</code>, valore lo stesso nome.</li>
        <li>Da quel momento ricevi ogni mattina le scommesse più solide del giorno e, circa un'ora prima delle partite, l'avviso delle formazioni ufficiali con i consigli sui titolari.</li></ol></details>
        <p class="note"><b>Gioco responsabile.</b> Il gioco è vietato ai minori di 18 anni e può causare dipendenza. Queste sono stime statistiche, non certezze: punta solo ciò che puoi permetterti di perdere. Se il gioco ti crea problemi, il Telefono Verde Nazionale dell'Istituto Superiore di Sanità risponde gratis e in anonimo all'<b>800 558822</b> (lunedì–venerdì, 10–16).</p>`);
    const re = () => view(app, tab);
    const on = (id, f) => { const el = document.getElementById(id); if (el) el.onchange = e => { f(e.target); re(); }; };
    on('c-lg', t => ui.lg = t.value); on('c-per', t => ui.per = t.value); on('c-min', t => ui.minF = +t.value); on('c-rel', t => ui.rel = t.value);
    on('c-mk', t => ui.mk = t.value); on('c-ps', t => ui.pstat = t.value); on('c-off', t => ui.pOff = t.checked); on('c-n', t => ui.n = +t.value);
    on('c-pl', t => ui.conPl = t.checked); on('c-mg', t => ui.margin = +t.value); on('c-band', t => ui.band = t.value); on('c-tg', t => ui.target = t.value);
    on('c-past', t => ui.past = +t.value);
    const clr = document.getElementById('c-clear'); if (clr) clr.onclick = () => { save(QK, {}); re(); };
    const ss = document.getElementById('c-saveslip');
    if (ss) ss.onclick = () => {
      const pick = schedina(team.concat(pl)); const sel = +ui.target ? pick : pick.slice(0, ui.n);
      const gs = load(GK); gs.push({ id: 'g' + Date.now(), ts: new Date().toISOString(), legs: sel.map(legOf), quota: Math.round(sel.reduce((a, t) => a / t.fid, 1) * 100) / 100 });
      save(GK, gs); ss.textContent = '✓ Salvata in "Le mie giocate"'; ss.disabled = true;
    };
    app.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.add && byId[b.dataset.add]) {
        const t = byId[b.dataset.add]; const q = load(QK)[t.id];
        const gs = load(GK); gs.push({ id: 'g' + Date.now(), ts: new Date().toISOString(), legs: [legOf(t)], quota: q || null });
        save(GK, gs); b.textContent = '✓'; b.disabled = true;
      }
      if (b.dataset.del) { save(GK, load(GK).filter(g => g.id !== b.dataset.del)); re(); }
    };
    app.oninput = e => {
      const el = e.target; if (!el.dataset) return;
      const v = parseFloat(String(el.value).replace(',', '.'));
      if (el.dataset.qid) {
        const qs = load(QK); if (v > 1) qs[el.dataset.qid] = v; else delete qs[el.dataset.qid]; save(QK, qs);
        const out = app.querySelector(`[data-qv="${CSS.escape(el.dataset.qid)}"]`); if (out) out.innerHTML = verdict(v, +el.dataset.f);
      }
      if (el.dataset.gq || el.dataset.gs) {
        const gs = load(GK); const g = gs.find(z => z.id === (el.dataset.gq || el.dataset.gs)); if (!g) return;
        if (el.dataset.gq) g.quota = v > 1 ? v : null; else g.stake = v > 0 ? v : null; save(GK, gs);
      }
    };
    app.onchange = e => { if (e.target.dataset && (e.target.dataset.gq || e.target.dataset.gs)) re(); };
  }
  window.Consigli = { view, compute, setUi: o => Object.assign(ui, o), market, PSTN, BANDS, schedina, reloadCal: () => { CAL = null; } };
})();
