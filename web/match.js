/* Centro partita: schede, confronto, corner, pronostico, eventi, risultato. */
(function () {
  const { esc, nf, pc } = C;
  const TABS = [['panoramica', 'Panoramica'], ['confronto', 'Confronto squadre'], ['giocatori', 'Giocatori'], ['arbitro', 'Arbitro'],
    ['corner', 'Corner'], ['pronostico', 'Pronostico'], ['eventi', 'Eventi'], ['risultato', 'Risultato']];
  const MLAB = { gol: 'gol', corner: 'corner', tiri: 'tiri', tiri_porta: 'tiri in porta', falli: 'falli', cartellini: 'cartellini' };
  const MLAB1 = { gol: 'gol', corner: 'corner', tiri: 'tiro', tiri_porta: 'tiro in porta', falli: 'fallo', cartellini: 'cartellino' };
  const lab = (mt, k) => (k === 1 ? MLAB1 : MLAB)[mt];
  const PAIRS = [['gol', 'gol_fatti', 'gol_subiti'], ['tiri', 'tiri', 'tiri_concessi'], ['tiri_porta', 'tiri_porta', 'tiri_porta_concessi'],
    ['corner', 'corner', 'corner_contro'], ['falli', 'falli', 'falli_subiti'], ['cartellini', 'cartellini', 'cartellini_subiti']];
  const SAMPLES = [['auto', 'Automatico'], ['stagione', 'Stagione in corso'], ['last5', 'Ultime 5'], ['last10', 'Ultime 10'], ['due', 'Stagione in corso + precedente']];
  let sampleMode = 'auto';
  let cornerSel = { side: 'tot', k: 9 };
  let evSort = { mode: 'prob', col: null, dir: -1 };
  const ui = { pev: 1, mpMetric: 'tiri_porta', rpMetric: 'tiri' };
  const open = new Set();

  async function load(id) {
    const parts = id.split('-'); const lg = parts[0]; const season = C.sfrom(parts[1]);
    const d = await C.season(lg, season);
    if (!d || !d.byId[id]) return null;
    const m = d.byId[id];
    const [pr, prev, ev, pl] = await Promise.all([C.preds(lg, season), C.season(lg, C.prevSeason(season)), C.evalData(), C.players(lg, season)]);
    const P = pr[id] || null;
    await Promise.all((C.leagueInfo(lg) || { seasons: [] }).seasons.map(s => C.season(lg, s)));
    return { lg, season, d, prev, m, P, p: P && P.p, ev, pl, H: C.teamName(d, m.h), A: C.teamName(d, m.a), cache: {} };
  }

  // ---------- campioni prima della gara
  function sample(x, tid, venue, mode) {
    mode = mode || sampleMode;
    const o = { venue, before: x.m.t };
    const cur = C.teamMatches(x.d, tid, o);
    const both = () => (x.prev ? C.teamMatches(x.prev, tid, o) : []).concat(cur);
    if (mode === 'stagione') return { list: cur, label: 'stagione in corso' };
    if (mode === 'last5') return { list: both().slice(-5), label: 'ultime 5' };
    if (mode === 'last10') return { list: both().slice(-10), label: 'ultime 10' };
    if (mode === 'due') return { list: both(), label: 'stagione in corso e precedente' };
    const withStats = cur.filter(r => r.m.s.corner).length;
    return withStats >= 5 ? { list: cur, label: 'stagione in corso' } : { list: both(), label: 'stagione in corso e precedente (pochi dati nella stagione in corso)' };
  }
  function leagueRef(x, venue, mode) {
    mode = mode || sampleMode;
    let l = C.leagueList(x.d, { venue, before: x.m.t });
    const curStats = l.filter(r => r.m.s.corner).length;
    if (mode !== 'stagione' && (mode !== 'auto' || curStats < 40) && x.prev) l = C.leagueList(x.prev, { venue }).concat(l);
    return l;
  }
  function freqOf(list, fam, key, k) {
    let n = 0, y = 0; const hits = [];
    list.forEach(r => { const o = CM.outcome(fam, key, k, C.res(r.m)); if (o == null) return; n++; if (o) { y++; } hits.push([r, o]); });
    return { n, y, f: n ? y / n : null, hits };
  }
  function leagueWindow(x) {
    if (x.cache.lw) return x.cache.lw;
    const from = x.m.t - 365 * 864e5; const out = [];
    [x.prev, x.d].forEach(d => d && d.matches.forEach(m => { if (m.g && m.t < x.m.t && m.t >= from) out.push({ m, side: 'H' }); }));
    return (x.cache.lw = out);
  }

  // ---------- etichette eventi
  function evLabel(x, fam, key, k) {
    const H = esc(x.H), A = esc(x.A);
    const parts = fam.split('_');
    switch (fam) {
      case '1x2': return { '1': `Vittoria ${H} nei 90 minuti`, 'X': 'Pareggio nei 90 minuti', '2': `Vittoria ${A} nei 90 minuti` }[key];
      case 'dc': return { '1X': `${H} vince o pareggia (90 minuti)`, 'X2': `${A} vince o pareggia (90 minuti)`, '12': 'Una delle due vince (no pareggio)' }[key];
      case 'gol_tot_ge': return `Almeno ${k} gol totali nei 90 minuti`;
      case 'gol_tot_le': return `Al massimo ${k} gol totali nei 90 minuti`;
      case 'gol_h_ge': return `Squadra di casa (${H}), almeno ${k} gol nei 90 minuti`;
      case 'gol_a_ge': return `Squadra ospite (${A}), almeno ${k} gol nei 90 minuti`;
      case 'btts': return key === 'si' ? 'Entrambe le squadre segnano nei 90 minuti' : 'Almeno una squadra non segna nei 90 minuti';
      case 'cs_h': return `${H} non subisce gol nei 90 minuti`;
      case 'cs_a': return `${A} non subisce gol nei 90 minuti`;
      case 'gol_1t_ge': return `Almeno ${k} gol nel primo tempo`;
      case 'score': return `Risultato esatto ${key} al 90'`;
      case 'corner_piu': return { casa: `Più corner per ${H} nei 90 minuti`, pari: 'Stesso numero di corner nei 90 minuti', ospite: `Più corner per ${A} nei 90 minuti` }[key];
    }
    const op = parts.pop(), side = parts.pop(), metric = parts.join('_'); const L = lab(metric, k);
    const who = side === 'tot' ? '' : side === 'h' ? `Squadra di casa (${H}), ` : `Squadra ospite (${A}), `;
    if (side === 'tot') return `${op === 'ge' ? 'Almeno' : 'Al massimo'} ${k} ${L} ${k === 1 ? 'totale' : 'totali'} nei 90 minuti`;
    return `${who}${op === 'ge' ? 'almeno' : 'al massimo'} ${k} ${L} nei 90 minuti`;
  }
  const FAMN = {
    '1x2': 'Esito finale', dc: 'Doppia chance', gol_tot_ge: 'Gol totali, almeno', gol_tot_le: 'Gol totali, al massimo', gol_h_ge: 'Gol della squadra di casa',
    gol_a_ge: 'Gol della squadra ospite', btts: 'Entrambe a segno', cs_h: 'Porta inviolata casa', cs_a: 'Porta inviolata ospite', gol_1t_ge: 'Gol nel primo tempo',
    score: 'Risultato esatto', corner_tot_ge: 'Corner totali, almeno', corner_tot_le: 'Corner totali, al massimo', corner_h_ge: 'Corner squadra di casa',
    corner_a_ge: 'Corner squadra ospite', corner_piu: 'Squadra con più corner', tiri_tot_ge: 'Tiri totali', tiri_h_ge: 'Tiri squadra di casa',
    tiri_a_ge: 'Tiri squadra ospite', tiri_porta_tot_ge: 'Tiri in porta totali', tiri_porta_h_ge: 'Tiri in porta casa', tiri_porta_a_ge: 'Tiri in porta ospite',
    falli_tot_ge: 'Falli totali', falli_h_ge: 'Falli squadra di casa', falli_a_ge: 'Falli squadra ospite', cartellini_tot_ge: 'Cartellini totali',
    cartellini_h_ge: 'Cartellini squadra di casa', cartellini_a_ge: 'Cartellini squadra ospite',
  };
  const famMetric = fam => fam.startsWith('corner') ? 'corner' : fam.startsWith('tiri_porta') ? 'tiri_porta' : fam.startsWith('tiri') ? 'tiri' :
    fam.startsWith('falli') ? 'falli' : fam.startsWith('cartellini') ? 'cartellini' : 'gol';
  const famSide = fam => /_h_|cs_h/.test(fam) ? 'h' : /_a_|cs_a/.test(fam) ? 'a' : 'tot';

  // ---------- tabella eventi
  function eventRows(x) {
    if (x.cache.ev) return x.cache.ev;
    const out = [];
    if (!x.p) return (x.cache.ev = out);
    const lw = leagueWindow(x);
    const hs = sample(x, x.m.h, 'home', 'auto').list, as = sample(x, x.m.a, 'away', 'auto').list;
    const rel = (x.ev.reliability[x.lg] || {});
    CM.events(x.p, false).forEach(([fam, key, k, p]) => {
      const lf = freqOf(lw, fam, key, k);
      const side = famSide(fam);
      const hf = side !== 'a' ? freqOf(hs, fam, key, k) : null;
      const af = side !== 'h' ? freqOf(as, fam, key, k) : null;
      out.push({ fam, key, k, p, lf, hf, af, rel: rel[fam] || 'non valutabile', diff: lf.f == null ? null : p - lf.f, label: evLabel(x, fam, key, k) });
    });
    // famiglie senza stima
    ['corner', 'tiri', 'tiri_porta', 'falli', 'cartellini', 'gol'].forEach(mt => {
      const mp = x.p.m[mt]; if (mp && !mp.l) out.push({ fam: mt + '_na', na: mp.na, label: `${MLAB[mt][0].toUpperCase() + MLAB[mt].slice(1)}: stima non disponibile`, n: mp.n });
    });
    return (x.cache.ev = out);
  }
  function representative(rows, mode) {
    const byFam = {};
    rows.forEach(r => { if (!r.na) (byFam[r.fam] = byFam[r.fam] || []).push(r); });
    return Object.values(byFam).map(list => {
      if (mode === 'diff') return list.filter(r => r.diff != null).sort((a, b) => b.diff - a.diff)[0] || list[0];
      const ok = list.filter(r => r.p <= 0.9).sort((a, b) => b.p - a.p);
      return ok[0] || list.slice().sort((a, b) => a.p - b.p)[0];
    });
  }
  const relChip = r => `<span class="rel rel-${r.replace(' ', '-')}">${r}</span>`;
  const fq = f => f && f.n ? `${f.y}/${f.n}` : '<span class="nd" title="nessuna partita utile">n.d.</span>';
  function explain(x, r) {
    const mt = famMetric(r.fam); const mp = x.p.m[mt];
    if (!mp || !mp.l) return '';
    const side = famSide(r.fam);
    const lam = side === 'h' ? nf(mp.l[0]) : side === 'a' ? nf(mp.l[1]) : nf(mp.l[0] + mp.l[1]);
    const base = side === 'h' ? nf(mp.mu[0]) : side === 'a' ? nf(mp.mu[1]) : nf(mp.mu[0] + mp.mu[1]);
    return `Attesi ${lam} ${MLAB[mt]} (media campionato ${base})` + (mp.ref && mp.ref[1] ? `; arbitro ×${nf(mp.ref[0], 2)}` : '');
  }
  function eventsTable(x, limitFam) {
    const rows = eventRows(x);
    if (!x.p) return '<p class="empty">Pronostico non ancora disponibile per questa partita: viene calcolato nei 14 giorni che precedono la gara.</p>';
    const na = rows.filter(r => r.na);
    let shown = representative(rows, evSort.mode === 'diff' ? 'diff' : 'prob');
    const key = evSort.col || (evSort.mode === 'diff' ? 'diff' : 'p');
    shown.sort((a, b) => {
      const va = key === 'n' ? (a.lf.n) : key === 'rel' ? ['alta', 'media', 'bassa', 'non valutabile'].indexOf(a.rel) : a[key] == null ? -9 : a[key];
      const vb = key === 'n' ? (b.lf.n) : key === 'rel' ? ['alta', 'media', 'bassa', 'non valutabile'].indexOf(b.rel) : b[key] == null ? -9 : b[key];
      return (vb - va) * (evSort.col ? evSort.dir : 1) * (key === 'rel' ? -1 : 1);
    });
    if (limitFam) shown = shown.slice(0, limitFam);
    const th = (c, t) => `<th data-sort="${c}" class="num sortable">${t}${evSort.col === c ? (evSort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    const body = shown.map(r => {
      const isOpen = open.has('ev:' + r.fam);
      const fams = isOpen ? rows.filter(z => z.fam === r.fam && !z.na) : [];
      return `<tr class="evrow ${isOpen ? 'open' : ''}" data-fam="${r.fam}"><td><button class="link exp" aria-expanded="${isOpen}">${isOpen ? '−' : '+'}</button> ${r.label}<div class="sub">${FAMN[r.fam] || ''}</div></td>
      <td class="num big">${pc(r.p)}</td><td class="num">${r.lf.f == null ? '<span class="nd" title="dato non disponibile">n.d.</span>' : pc(r.lf.f)}<div class="sub">${r.diff == null ? '' : (r.diff >= 0 ? '+' : '−') + nf(Math.abs(r.diff) * 100, 0) + ' pp'}</div></td>
      <td class="num">${r.hf ? 'Casa ' + fq(r.hf) : ''}${r.hf && r.af ? '<br>' : ''}${r.af ? 'Ospite ' + fq(r.af) : ''}</td>
      <td class="num">${r.lf.n}</td><td>${relChip(r.rel)}</td><td class="why">${explain(x, r)}</td></tr>` +
        (isOpen ? `<tr class="evsub"><td colspan="7"><table class="inner"><thead><tr><th>Soglia</th><th class="num">Modello</th><th class="num">Campionato</th><th class="num">Diff.</th><th class="num">Storico squadre</th></tr></thead><tbody>${
          fams.map(z => `<tr><td>${z.label}</td><td class="num">${pc(z.p)}</td><td class="num">${z.lf.f == null ? '<span class="nd" title="dato non disponibile">n.d.</span>' : pc(z.lf.f)}</td><td class="num">${z.diff == null ? '<span class="nd" title="dato non disponibile">n.d.</span>' : (z.diff >= 0 ? '+' : '−') + nf(Math.abs(z.diff) * 100, 0) + ' pp'}</td><td class="num">${z.hf ? 'C ' + fq(z.hf) : ''} ${z.af ? 'O ' + fq(z.af) : ''}</td></tr>`).join('')
        }</tbody></table></td></tr>` : '');
    }).join('');
    return `<div class="seg" role="tablist"><button data-evmode="prob" class="${evSort.mode === 'prob' ? 'on' : ''}">Più probabili</button><button data-evmode="diff" class="${evSort.mode === 'diff' ? 'on' : ''}">Più caratteristici della partita</button></div>
    <p class="note">${evSort.mode === 'prob' ? 'Ordinati per probabilità stimata. Per ogni famiglia compare una sola soglia, la più probabile sotto il 90% (le soglie quasi certe non informano); tocca + per vedere tutte le soglie.' :
      'Ordinati per scarto rispetto alla frequenza abituale dello stesso evento nel campionato (ultimi 365 giorni prima della gara), in punti percentuali.'}</p>
    <div class="scroll"><table class="evt"><thead><tr><th>Evento</th>${th('p', 'Probabilità')}${th('diff', 'Frequenza campionato')}<th class="num">Storico squadre</th>${th('n', 'Campione')}${th('rel', 'Affidabilità')}<th>Perché</th></tr></thead><tbody>${body}</tbody></table></div>
    ${na.length ? `<p class="note">Stima non disponibile: ${na.map(r => r.label.split(':')[0] + ' (' + esc(r.na) + ')').join('; ')}.</p>` : ''}
    <p class="note">Probabilità e affidabilità sono separate: l'affidabilità misura quanto il modello ha funzionato in passato per quel tipo di evento in questo campionato (verifica su partite successive ai dati usati). Storico squadre: partite casalinghe della squadra di casa e trasferte dell'ospite (${esc(sample(x, x.m.h, 'home', 'auto').label)}).</p>`;
  }

  // ---------- 1X2 e gol
  function round100(ps) {
    const raw = ps.map(p => p * 100); const fl = raw.map(Math.floor); let rest = 100 - fl.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { fl[i]++; rest--; } });
    return fl;
  }
  function bars1x2(x) {
    const G = CM.goalBlock(x.p, false); if (!G) return '<p class="empty">Stima non disponibile (campione insufficiente).</p>';
    const r = round100([G.p1, G.px, G.p2]);
    return `<div class="x12"><div class="seg1" style="flex:${r[0]}"><b>${r[0]}%</b><span>${esc(x.H)}</span></div><div class="seg2" style="flex:${r[1]}"><b>${r[1]}%</b><span>Pareggio</span></div><div class="seg3" style="flex:${r[2]}"><b>${r[2]}%</b><span>${esc(x.A)}</span></div></div>`;
  }

  // ---------- lettura della partita
  function reading(x) {
    if (!x.p) return '<p class="empty">La lettura della partita compare quando è disponibile il pronostico.</p>';
    const G = CM.goalBlock(x.p, false); const g = x.p.m.gol; const out = [];
    const link = (tab, t) => `<a href="${C.matchUrl(x.m, tab)}">${t}</a>`;
    const vs = (v, base) => v > base * 1.08 ? 'sopra' : v < base * 0.92 ? 'sotto' : 'in linea con';
    // 1. quadro generale
    if (G) {
      const mx = Math.max(G.p1, G.px, G.p2);
      const fav = G.p1 === mx ? x.H : G.p2 === mx ? x.A : null;
      const tot = G.lh + G.la, base = g.mu[0] + g.mu[1];
      const tone = tot > base * 1.1 ? 'una gara aperta, con più gol della media' : tot < base * 0.9 ? 'una gara chiusa, con pochi gol' : 'un numero di gol vicino alla media';
      const who = fav && mx >= 0.5 ? `<b>${esc(fav)}</b> favorita (${pc(mx)})` : fav && mx >= 0.42 ? `leggero vantaggio per <b>${esc(fav)}</b> (${pc(mx)})` : 'partita equilibrata';
      const sc = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) sc.push([G.M[i][j], i, j]); sc.sort((p, q) => q[0] - p[0]);
      out.push(`<h3>Quadro generale</h3><p>${who}, con ${tone}: ${nf(tot, 2)} gol attesi (${esc(x.H)} ${nf(G.lh, 2)}, ${esc(x.A)} ${nf(G.la, 2)}) contro ${nf(base, 2)} di media in campionato. Pareggio ${pc(G.px)}, entrambe a segno ${pc(G.btts)}. Risultato più probabile ${sc[0][1]}–${sc[0][2]} (${pc(sc[0][0], 1)}), poi ${sc[1][1]}–${sc[1][2]} e ${sc[2][1]}–${sc[2][2]} (${link('pronostico', 'Pronostico')}).</p>`);
    }
    // 2. attacco contro difesa
    const facts = [];
    PAIRS.forEach(([mt, pro, con]) => {
      const mp = x.p.m[mt]; if (!mp || !mp.l || mt === 'falli' || mt === 'cartellini') return;
      [[0, x.m.h, x.m.a, 'home', 'away', x.H, x.A], [1, x.m.a, x.m.h, 'away', 'home', x.A, x.H]].forEach(([i, att, def, va, vd, nA, nD]) => {
        const eff = mp.l[i] / mp.mu[i]; if (isFinite(eff)) facts.push({ mt, i, eff, w: Math.abs(Math.log(eff)) * (mt === 'gol' ? 1.4 : 1), pro, con, att, def, va, vd, nA, nD });
      });
    });
    facts.sort((p, q) => q.w - p.w);
    const used = new Set(); const sup = [];
    for (const f of facts) {
      if (sup.length >= 4) break; const key = f.mt + f.i; if (used.has(key)) continue; used.add(key);
      const ma = C.metricByCode(f.pro), md = C.metricByCode(f.con);
      const a = C.agg(ma, sample(x, f.att, f.va).list), b = C.agg(md, sample(x, f.def, f.vd).list);
      if (a.state !== 'ok' || b.state !== 'ok') continue;
      const lr = C.agg(ma, leagueRef(x, f.va));
      sup.push(`<li><b>${esc(f.nA)}</b> ${f.va === 'home' ? 'in casa' : 'in trasferta'} produce ${nf(a.v)} ${MLAB[f.mt]} a partita (${a.n} gare); ${esc(f.nD)} ${f.vd === 'home' ? 'in casa' : 'fuori'} ne concede ${nf(b.v)} (${b.n} gare); media del campionato ${nf(lr.v)}. Stima: <b>${nf(x.p.m[f.mt].l[f.i])}</b>, ${vs(x.p.m[f.mt].l[f.i], x.p.m[f.mt].mu[f.i])} la media.</li>`);
    }
    if (sup.length) out.push(`<h3>I numeri che lo sostengono</h3><ul class="facts">${sup.join('')}</ul><p class="note">Dettaglio in ${link('confronto', 'Confronto squadre')}.</p>`);
    // 3. stile e ritmo (dove ci sono i dati)
    const style = [];
    const M = c => C.metricByCode(c);
    [['possesso', '% di possesso'], ['passaggi_chiave', 'passaggi chiave'], ['dribbling_riusciti', 'dribbling riusciti'], ['recuperi', 'recuperi']].forEach(([c, lab]) => {
      const h = C.agg(M(c), sample(x, x.m.h, 'home').list), a = C.agg(M(c), sample(x, x.m.a, 'away').list);
      if (h.state === 'ok' && a.state === 'ok' && h.n >= 3 && a.n >= 3) style.push(`${lab}: ${esc(x.H)} ${nf(h.v)} in casa, ${esc(x.A)} ${nf(a.v)} fuori`);
    });
    const ts = x.p.m.tiri;
    if (ts && ts.l) style.unshift(`tiri attesi ${nf(ts.l[0] + ts.l[1])} in totale, ${vs(ts.l[0] + ts.l[1], ts.mu[0] + ts.mu[1])} la media (${nf(ts.mu[0] + ts.mu[1])})`);
    if (style.length) out.push(`<h3>Stile e ritmo</h3><ul class="facts">${style.map(t => `<li>${t[0].toUpperCase() + t.slice(1)}.</li>`).join('')}</ul>`);
    // 4. corner
    const co = x.p.m.corner;
    if (co && co.l) { const P = CM.metricPmfs(co, false); const iv = CM.interval(P.pt);
      out.push(`<h3>Calci d'angolo</h3><p>Attesi ${nf(co.l[0] + co.l[1])} corner (${esc(x.H)} ${nf(co.l[0])}, ${esc(x.A)} ${nf(co.l[1])}), ${vs(co.l[0] + co.l[1], co.mu[0] + co.mu[1])} la media del campionato (${nf(co.mu[0] + co.mu[1])}); 8 volte su 10 tra ${iv[0]} e ${iv[1]}. Almeno 9 corner: ${pc(CM.ge(P.pt, 9))} (${link('corner', 'Corner')}).</p>`); }
    // 5. disciplina e arbitro
    const fa = x.p.m.falli, ca = x.p.m.cartellini; const disc = [];
    if (fa && fa.l) disc.push(`falli attesi ${nf(fa.l[0] + fa.l[1])} (media ${nf(fa.mu[0] + fa.mu[1])})`);
    if (ca && ca.l) disc.push(`cartellini attesi ${nf(ca.l[0] + ca.l[1])} (media ${nf(ca.mu[0] + ca.mu[1])}), almeno 4 cartellini ${pc(CM.ge(CM.metricPmfs(ca, false).pt, 4))}`);
    if (x.m.r) { const st = MatchView.refStats(x.lg, [x.prev, x.d], x.m.r, x.m.t); const cr = st.rows.find(r => r.n === 'Cartellini totali');
      disc.push(`arbitro ${esc(x.d.referees[x.m.r] || x.m.r)}: ${cr && cr.r[1] ? `${nf(cr.r[0], 2)} cartellini a partita in ${cr.r[1]} gare contro ${nf(cr.l[0], 2)} di media` : 'nessuna gara precedente nei dati'}${ca && ca.ref && ca.ref[1] ? `, peso nel modello ×${nf(ca.ref[0], 2)}` : ''}`); }
    else disc.push('arbitro non ancora designato');
    if (disc.length) out.push(`<h3>Disciplina</h3><p>${disc.map((t, i) => i ? t : t[0].toUpperCase() + t.slice(1)).join('; ')} (${link('arbitro', 'Arbitro')}).</p>`);
    // 6. incertezze
    const unc = [];
    if (missed(x) > 0) unc.push([5, `al momento del pronostico il modello non conosceva ${missed(x)} partite recenti delle due squadre (dati fino al ${C.dshort(x.p.lu)})`]);
    if (x.p.pro && (x.p.pro[0] || x.p.pro[1])) unc.push([4, `${x.p.pro[0] ? esc(x.H) : esc(x.A)} è neopromossa: la stima parte dal rendimento storico medio delle neopromosse`]);
    const nas = Object.entries(x.p.m).filter(([, v]) => !v.l).map(([k]) => MLAB[k]);
    if (nas.length) unc.push([3, `stima non disponibile per ${nas.join(', ')} (campione insufficiente)`]);
    if (G && G.px >= 0.27) unc.push([2, `pareggio molto possibile (${pc(G.px)})`]);
    if (G && Math.abs(G.p1 - G.p2) < 0.08) unc.push([2.5, `le due squadre sono quasi alla pari (${pc(G.p1)} contro ${pc(G.p2)})`]);
    if (!x.m.r && !x.m.g) unc.push([1, 'arbitro non designato: falli e cartellini usano solo i dati delle squadre']);
    const rel = x.ev.reliability[x.lg] || {};
    ['gol_tot_ge', 'corner_tot_ge', 'cartellini_tot_ge'].forEach(f => { if (rel[f] === 'bassa') unc.push([1.5, `per "${{ gol_tot_ge: 'gol totali', corner_tot_ge: 'corner totali', cartellini_tot_ge: 'cartellini totali' }[f]}" il modello in questo campionato ha affidabilità bassa`]); });
    unc.sort((p, q) => q[0] - p[0]);
    if (unc.length) out.push(`<h3>Fattori di incertezza</h3><ul class="facts">${unc.slice(0, 3).map(u => `<li>${u[1][0].toUpperCase() + u[1].slice(1)}.</li>`).join('')}</ul>`);
    return `<div class="reading">${out.join('')}</div>`;
  }

  // ---------- intestazione
  function header(x, tab) {
    const m = x.m; const md = m.md; const mo = m.mo;
    const when = m.tk ? `${C.dlong(m.ko)}, ore ${C.hm(m.ko)}` : `${C.dlong(m.ko)}, orario da definire`;
    const ref = m.r ? `<a href="#arbitro-${m.r}">${esc(x.d.referees[m.r] || m.r)}</a>` : 'arbitro non designato';
    const score = `<div class="scw">` + (m.g ? `<div class="sc"><b>${m.g[0]}</b><i>–</i><b>${m.g[1]}</b></div>${m.ht ? `<div class="ht">1° tempo ${m.ht[0]}–${m.ht[1]}</div>` : ''}` :
      `<div class="sc vs">${m.tk ? C.hm(m.ko) : 'vs'}</div>`) + `</div>`;
    const tabs = TABS.filter(([k]) => k !== 'risultato' || m.g).map(([k, t]) => `<a href="${C.matchUrl(m, k)}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${t}</a>`).join('');
    return `<header class="board">
      <div class="crumbs"><a href="#giornata-${x.lg}-${C.scode(x.season)}-${mo || md}">${esc(C.LGN(x.lg))} ${esc(x.season)} · Giornata ${mo || md || '–'}</a>${m.tag ? ` <span class="tag">${m.tag}${mo && md && mo !== md ? ' (gioc. ' + md + ')' : ''}</span>` : ''}</div>
      <div class="teams"><a class="tm" href="${C.teamUrl(m.h)}">${esc(x.H)}</a>${score}<a class="tm r" href="${C.teamUrl(m.a)}">${esc(x.A)}</a></div>
      <div class="when">${when} · ${ref}</div>
    </header><nav class="tabs scroll" aria-label="Schede partita">${tabs}</nav>`;
  }
  // partite del campionato giocate dopo i dati usati e prima della gara: misura il vero ritardo
  function missed(x) {
    if (!x.p || !x.p.lu) return 0; const lu = Date.parse(x.p.lu), day = Date.parse(x.m.ko.slice(0, 10) + 'T00:00:00Z');
    let n = 0; [x.prev, x.d].forEach(d => d && d.matches.forEach(m => { if (m.g && m.t > lu + 36e5 && m.t < day && [m.h, m.a].some(t => t === x.m.h || t === x.m.a)) n++; })); return n;
  }
  function predMeta(x) {
    if (!x.P) return '';
    const kind = x.P.k === 'prepartita' ? 'registrato prima della gara' : 'ricostruito con i soli dati precedenti alla gara';
    const lu = x.p.lu ? Date.parse(x.p.lu) : null; const gap = lu ? (x.m.t - lu) / 864e5 : null;
    return `<p class="meta">Pronostico ${kind} · creato ${C.dtime(x.P.t)} · modello ${esc(x.P.v)} · dati fino al ${x.p.lu ? C.dshort(x.p.lu) : 'n.d.'}${x.P.ns > 1 ? ` · ${x.P.ns} versioni salvate` : ''}</p>` +
      (missed(x) > 0 ? `<p class="warn">Dati in ritardo: al momento del pronostico mancavano ${missed(x)} partite delle due squadre giocate dopo il ${C.dshort(x.p.lu)}. Le stime riflettono la forma di allora.</p>` : '');
  }

  // ---------- schede
  function tabPanoramica(x) {
    const m = x.m; const st = C.standings(x.d, m.t); const pos = id => st.findIndex(r => r.id === id) + 1; const row = id => st.find(r => r.id === id);
    const card = (id, venue, name) => {
      const r = row(id) || { p: 0, pts: 0, form: [], gf: 0, ga: 0 };
      const s = C.teamMatches(x.d, id, { venue, before: m.t });
      let w = 0, dr = 0, l = 0, gf = 0, ga = 0;
      s.forEach(({ m: mm, side }) => { const a = side === 'H' ? mm.g[0] : mm.g[1], b = side === 'H' ? mm.g[1] : mm.g[0]; gf += a; ga += b; if (a > b) w++; else if (a === b) dr++; else l++; });
      return `<div class="tcard"><h3><a href="${C.teamUrl(id)}">${esc(name)}</a></h3>
        <p class="big">${r.p ? pos(id) + 'ª' : 'n.d.'} <span>in classifica · ${r.pts} punti in ${r.p} gare</span></p>
        <p>Forma (ultime 5): ${C.formChips(r.form) || '<span class="miss">nessuna gara</span>'}</p>
        <p>${venue === 'home' ? 'In casa' : 'In trasferta'}: ${s.length ? `${w}V ${dr}N ${l}P · gol ${gf}–${ga} · ${s.length} gare` : 'nessuna gara giocata nella stagione'}</p></div>`;
    };
    const top = x.p ? representative(eventRows(x), 'diff').filter(r => r.diff != null && !r.na).sort((a, b) => b.diff - a.diff).slice(0, 4) : [];
    const mets = x.p ? ['gol', 'corner', 'tiri_porta', 'cartellini'].map(mt => { const mp = x.p.m[mt]; return mp && mp.l ? `<div class="kpi"><b>${nf(mp.l[0] + mp.l[1])}</b><span>${MLAB[mt]} attesi</span><i>media ${nf(mp.mu[0] + mp.mu[1])}</i></div>` : `<div class="kpi na"><b>n.d.</b><span>${MLAB[mt]}: stima non disponibile</span></div>`; }).join('') : '';
    const last5 = (id, name) => { const l = C.teamMatches(x.d, id, { before: m.t }).concat().slice(-5).reverse();
      return `<div><h3>${esc(name)}: ultime 5</h3><table class="mini">${l.map(({ m: mm, side }) => { const a = side === 'H' ? mm.g[0] : mm.g[1], b = side === 'H' ? mm.g[1] : mm.g[0]; const r = a > b ? 'V' : a === b ? 'N' : 'S';
        return `<tr><td>${C.dnum(mm.ko)}</td><td>${side === 'H' ? 'casa' : 'fuori'}</td><td><a href="${C.matchUrl(mm)}">${esc(C.teamName(x.d, side === 'H' ? mm.a : mm.h))}</a></td><td class="num">${a}–${b}</td><td>${C.formChips([r])}</td></tr>`; }).join('') || '<tr><td class="empty">Nessuna gara.</td></tr>'}</table></div>`; };
    return `<section class="grid2">${card(m.h, 'home', x.H)}${card(m.a, 'away', x.A)}</section>
      <section class="grid2">${last5(m.h, x.H)}${last5(m.a, x.A)}</section>${profile(x)}${h2h(x)}
      <section><h2>Che gara suggeriscono i dati</h2>${predMeta(x)}${x.p ? bars1x2(x) + `<div class="kpis">${mets}</div>` : ''}${reading(x)}</section>
      ${top.length ? `<section><h2>Più caratteristici della partita</h2><ul class="toplist">${top.map(r => `<li><b>${pc(r.p)}</b> ${r.label} <span class="sub">campionato ${pc(r.lf.f)} · ${relChip(r.rel)}</span></li>`).join('')}</ul><p><a href="${C.matchUrl(m, 'eventi')}">Indice completo degli eventi →</a></p></section>` : ''}`;
  }

  const PROF = ['gol_fatti', 'gol_subiti', 'tiri', 'tiri_porta', 'tiri_concessi', 'xg', 'possesso', 'passaggi_chiave', 'dribbling_riusciti', 'contrasti_vinti', 'recuperi', 'corner', 'corner_contro', 'falli', 'falli_subiti', 'cartellini'];
  const LOWGOOD = new Set(['gol_subiti', 'tiri_concessi', 'corner_contro', 'cartellini', 'falli']);
  function ranks(x, venue) {
    const key = 'rk' + venue; if (x.cache[key]) return x.cache[key];
    const out = {}; const teams = Object.keys(x.d.teams);
    PROF.forEach(code => { const M = C.metricByCode(code); if (!M) return;
      const vals = teams.map(t => { let l = C.teamMatches(x.d, t, { venue, before: x.m.t }); if (l.filter(r => r.m.s.corner).length < 3 && x.prev) l = C.teamMatches(x.prev, t, { venue }).concat(l);
        return [t, C.agg(M, l)]; }).filter(([, a]) => a.state === 'ok');
      vals.sort((a, b) => b[1].v - a[1].v); out[code] = { n: vals.length, by: Object.fromEntries(vals.map(([t, a], i) => [t, { v: a.v, r: i + 1, n: a.n }])) }; });
    return (x.cache[key] = out);
  }
  function profile(x) {
    const rh = ranks(x, 'home'), ra = ranks(x, 'away');
    const rows = PROF.filter(c => rh[c] && rh[c].by[x.m.h] && ra[c] && ra[c].by[x.m.a]).map(c => {
      const M = C.metricByCode(c); const h = rh[c].by[x.m.h], a = ra[c].by[x.m.a], n = rh[c].n;
      const bar = (o, nn) => `<span class="rk ${o.r <= 4 ? 'top' : o.r > nn - 4 ? 'low' : ''}">${o.r}ª</span>`;
      return { c, M, h, a, n, html: `<tr><td>${esc(M.name)}</td><td class="num">${nf(h.v, M.agg === 'rate' ? 0 : 1)} ${bar(h, n)}</td><td class="num">${nf(a.v, M.agg === 'rate' ? 0 : 1)} ${bar(a, ra[c].n)}</td></tr>` };
    });
    if (!rows.length) return '';
    const sw = (side, name) => { const good = [], bad = [];
      rows.forEach(r => { const o = side === 'h' ? r.h : r.a; const n = side === 'h' ? r.n : (ra[r.c] || {}).n || r.n; const hi = o.r <= 3, lo = o.r > n - 3; if (!hi && !lo) return;
        const pos = LOWGOOD.has(r.c) ? lo : hi; (pos ? good : bad).push(`${r.M.name.toLowerCase()} (${o.r}ª)`); });
      return `<div class="tcard"><h3>${esc(name)} ${side === 'h' ? 'in casa' : 'in trasferta'}</h3><p><b>Punti di forza:</b> ${good.join(', ') || '<span class="sub">nessun valore tra i primi 3</span>'}</p><p><b>Punti deboli:</b> ${bad.join(', ') || '<span class="sub">nessun valore tra gli ultimi 3</span>'}</p></div>`; };
    return `<section><h2>Profilo delle squadre</h2><p class="note">Valore medio a partita e posizione nel campionato: ${esc(x.H)} tra le squadre di casa, ${esc(x.A)} tra le squadre in trasferta (1ª = valore più alto). Solo partite precedenti a questa.</p>
      <div class="grid2">${sw('h', x.H)}${sw('a', x.A)}</div>
      <div class="scroll"><table class="prof"><thead><tr><th>Statistica</th><th class="num">${esc(x.H)} (casa)</th><th class="num">${esc(x.A)} (fuori)</th></tr></thead><tbody>${rows.map(r => r.html).join('')}</tbody></table></div></section>`;
  }
  function h2h(x) {
    const all = [];
    Object.values(C.S.seasons).forEach(d => d && d.league === x.lg && d.matches.forEach(m => { if (m.g && m.t < x.m.t && ((m.h === x.m.h && m.a === x.m.a) || (m.h === x.m.a && m.a === x.m.h))) all.push([m, d]); }));
    all.sort((a, b) => b[0].t - a[0].t);
    if (!all.length) return `<section><h2>Precedenti</h2><p class="empty">Nessun precedente in campionato nelle stagioni caricate.</p></section>`;
    let w = 0, dr = 0, l = 0, gf = 0, ga = 0, c = 0, cn = 0;
    all.forEach(([m]) => { const hh = m.h === x.m.h; const a = hh ? m.g[0] : m.g[1], b = hh ? m.g[1] : m.g[0]; gf += a; ga += b; if (a > b) w++; else if (a === b) dr++; else l++; if (m.s.corner && m.s.corner[0] != null) { c += m.s.corner[0] + m.s.corner[1]; cn++; } });
    return `<section><h2>Precedenti in campionato</h2><p>${all.length} gare: <b>${esc(x.H)} ${w}V</b> · ${dr}N · <b>${esc(x.A)} ${l}V</b> · gol ${gf}–${ga} (${nf((gf + ga) / all.length, 1)} a partita)${cn ? ` · corner ${nf(c / cn, 1)} a partita` : ''}</p>
      <table class="mini">${all.slice(0, 8).map(([m, d]) => `<tr><td>${C.dnum(m.ko)}</td><td><a href="${C.matchUrl(m)}">${esc(C.teamName(d, m.h))} – ${esc(C.teamName(d, m.a))}</a></td><td class="num">${m.g.join('–')}</td><td class="num sub">${m.s.corner ? 'corner ' + m.s.corner.join('–') : ''}</td></tr>`).join('')}</table>
      <p class="note">Stagioni caricate nell'app (dal 2022-23). I precedenti sono informativi: il modello usa soprattutto la forma recente.</p></section>`;
  }
  function sampleSel(x) {
    return `<label class="sel">Campione <select id="sample">${SAMPLES.map(([k, t]) => `<option value="${k}" ${k === sampleMode ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  }
  function listRows(rows, metric) {
    if (!rows || !rows.length) return '<p class="empty">Nessuna partita nel campione.</p>';
    return `<table class="mini"><thead><tr><th>Data</th><th>Partita</th><th class="num">Ris.</th><th class="num">Valore</th></tr></thead><tbody>${rows.slice().reverse().map(({ m, side, v }) =>
      `<tr><td>${C.dnum(m.ko)}</td><td><a href="${C.matchUrl(m)}">${esc(teamNameAny(m, 'h'))} – ${esc(teamNameAny(m, 'a'))}</a></td><td class="num">${m.g ? m.g.join('–') : ''}</td><td class="num">${C.cellVal(v, metric && metric.agg === 'rate' ? 0 : undefined)}</td></tr>`).join('')}</tbody></table>`;
  }
  function teamNameAny(m, w) { const d = C.S.seasons[m.lg + '-' + C.scode(m.season)]; return C.teamName(d, w === 'h' ? m.h : m.a); }

  function tabConfronto(x) {
    const blocks = [[x.m.h, x.m.a, 'home', 'away', x.H, x.A, 0], [x.m.a, x.m.h, 'away', 'home', x.A, x.H, 1]];
    const html = blocks.map(([att, def, va, vd, nA, nD, i]) => {
      const sa = sample(x, att, va), sd = sample(x, def, vd);
      const rows = PAIRS.map(([mt, pro, con]) => {
        const ma = C.metricByCode(pro), md = C.metricByCode(con);
        const a = C.agg(ma, sa.list), b = C.agg(md, sd.list), l = C.agg(ma, leagueRef(x, va));
        const mp = x.p && x.p.m[mt]; const est = mp && mp.l ? nf(mp.l[i]) : '<span class="nd" title="stima non disponibile">n.d.</span>';
        const ka = `cf:${i}:${mt}:a`, kb = `cf:${i}:${mt}:b`;
        return `<div class="cmp"><h4>${MLAB[mt][0].toUpperCase() + MLAB[mt].slice(1)}</h4>
          <button class="cell" data-open="${ka}"><span>${esc(nA)} produce</span><b>${C.show(a)}</b><i>${a.n} gare</i></button>
          <button class="cell" data-open="${kb}"><span>${esc(nD)} concede</span><b>${C.show(b)}</b><i>${b.n} gare</i></button>
          <div class="cell"><span>Media campionato</span><b>${C.show(l)}</b><i>${l.n} gare</i></div>
          <div class="cell est"><span>Stima modello</span><b>${est}</b><i>per ${esc(nA)}</i></div>
          ${open.has(ka) ? `<div class="drill"><h5>${esc(nA)} ${va === 'home' ? 'in casa' : 'in trasferta'}: ${esc(ma.name.toLowerCase())}</h5>${listRows(a.rows, ma)}</div>` : ''}
          ${open.has(kb) ? `<div class="drill"><h5>${esc(nD)} ${vd === 'home' ? 'in casa' : 'in trasferta'}: ${esc(md.name.toLowerCase())}</h5>${listRows(b.rows, md)}</div>` : ''}
        </div>`;
      }).join('');
      return `<section><h2>Quando attacca ${esc(nA)}</h2><p class="note">${esc(nA)} ${va === 'home' ? 'nelle gare interne' : 'in trasferta'} contro ${esc(nD)} ${vd === 'home' ? 'nelle gare interne' : 'in trasferta'} · campione: ${esc(sa.label)}. Tocca un valore per vedere le partite da cui deriva.</p><div class="cmps">${rows}</div></section>`;
    }).join('');
    return `<div class="toolbar">${sampleSel(x)}</div>${html}`;
  }

  function pmfBars(p, iv, sel, labelFn) {
    const max = Math.max(...p); let last = p.length - 1; while (last > 0 && p[last] < 0.002) last--;
    return `<div class="pmf" role="img" aria-label="Distribuzione di probabilità">${p.slice(0, last + 1).map((v, k) =>
      `<div class="bar ${k >= iv[0] && k <= iv[1] ? 'in' : ''} ${sel != null && k >= sel ? 'sel' : ''}" title="${k}: ${pc(v, 1)}"><i style="height:${(v / max * 100).toFixed(1)}%"></i><span>${k}</span></div>`).join('')}</div>
      <p class="note">Barre: probabilità di ciascun valore. Colore pieno: intervallo di previsione all'80% (${iv[0]}–${iv[1]}).${sel != null ? ' Bordo: valori che soddisfano la soglia scelta.' : ''}</p>`;
  }

  function tabCorner(x) {
    const mp = x.p && x.p.m.corner; const ok = mp && mp.l;
    const hs = sample(x, x.m.h, 'home'), as = sample(x, x.m.a, 'away');
    const M = c => C.metricByCode(c);
    const hb = C.agg(M('corner'), hs.list), hc = C.agg(M('corner_contro'), hs.list), ab = C.agg(M('corner'), as.list), ac = C.agg(M('corner_contro'), as.list);
    const lh = C.agg(M('corner'), leagueRef(x, 'home')), la = C.agg(M('corner'), leagueRef(x, 'away'));
    const lt = C.agg(M('corner_totali'), leagueRef(x, 'home'));
    let est = '<p class="warn">Stima corner non disponibile per questa partita: ' + esc(mp ? mp.na || '' : 'pronostico assente') + '.</p>', dist = '', ans = '', thr = '';
    if (ok) {
      const P = CM.metricPmfs(mp, false); const ivt = CM.interval(P.pt), ivh = CM.interval(P.ph), iva = CM.interval(P.pa);
      est = `<div class="kpis"><div class="kpi"><b>${nf(mp.l[0])}</b><span>${esc(x.H)}</span><i>80%: ${ivh[0]}–${ivh[1]}</i></div><div class="kpi"><b>${nf(mp.l[1])}</b><span>${esc(x.A)}</span><i>80%: ${iva[0]}–${iva[1]}</i></div><div class="kpi hi"><b>${nf(mp.l[0] + mp.l[1])}</b><span>Corner totali</span><i>80%: ${ivt[0]}–${ivt[1]}</i></div></div>`;
      const side = cornerSel.side; const pm = side === 'tot' ? P.pt : side === 'h' ? P.ph : P.pa; const iv = side === 'tot' ? ivt : side === 'h' ? ivh : iva;
      const ks = []; const [m0] = CM.moments(pm); for (let k = Math.max(1, Math.floor(m0 - 5)); k <= Math.ceil(m0 + 5); k++) ks.push(k);
      if (!ks.includes(cornerSel.k)) cornerSel.k = side === 'tot' ? Math.min(Math.max(9, ks[0]), ks[ks.length - 1]) : Math.round(m0);
      const k = cornerSel.k; const fam = 'corner_' + side + '_ge';
      const pr = CM.ge(pm, k);
      dist = `<div class="seg">${[['tot', 'Totali'], ['h', esc(x.H)], ['a', esc(x.A)]].map(([s, t]) => `<button data-cside="${s}" class="${s === side ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="chips">${ks.map(v => `<button data-ck="${v}" class="${v === k ? 'on' : ''}">almeno ${v}</button>`).join('')}</div>${pmfBars(pm, iv, k)}`;
      const fh = side !== 'a' ? freqOf(hs.list, fam, 'ge' + k, k) : null;
      const fa = side !== 'h' ? freqOf(as.list, fam, 'ge' + k, k) : null;
      const fl = freqOf(leagueWindow(x), fam, 'ge' + k, k);
      const who = side === 'tot' ? 'corner totali' : 'corner di ' + (side === 'h' ? esc(x.H) : esc(x.A));
      const fline = (f, name, where, key) => f ? `<li><button class="link" data-open="${key}">${esc(name)} ${where}: <b>${f.y} su ${f.n}</b> ${f.n ? '(' + pc(f.f) + ')' : ''}</button> hanno raggiunto almeno ${k} ${who}.${open.has(key) ? '<div class="drill">' + hitList(f) + '</div>' : ''}</li>` : '';
      ans = `<section class="answer"><h3>Almeno ${k} ${who} nei 90 minuti</h3><ul>
        ${fline(fh, x.H, 'nelle partite casalinghe', 'ch')}${fline(fa, x.A, 'nelle trasferte', 'ca')}
        <li>Campionato, ultimi 365 giorni: ${fl.y} su ${fl.n} (${pc(fl.f)}).</li>
        <li class="model">Modello per questa partita: <b>${pc(pr)}</b>. ${basis(x, mp, side)}</li></ul>
        <p class="note">Campione squadre: ${esc(hs.label)}. Affidabilità del modello per questo tipo di evento: ${relChip((x.ev.reliability[x.lg] || {})[fam] || 'non valutabile')}.</p></section>`;
      const lines = []; for (let t = Math.max(1, ivt[0]); t <= ivt[1] + 1; t++) lines.push(t);
      thr = `<section><h3>Soglie principali (corner totali)</h3><div class="scroll"><table><thead><tr><th>Evento</th><th class="num">Modello</th><th class="num">Campionato</th></tr></thead><tbody>${lines.map(t => {
        const f = freqOf(leagueWindow(x), 'corner_tot_ge', 'ge' + t, t); return `<tr><td>Almeno ${t} corner totali</td><td class="num">${pc(CM.ge(P.pt, t))}</td><td class="num">${pc(f.f)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    }
    return `<section><h2>Quanti angoli può produrre questa partita e perché</h2>${predMeta(x)}${est}
      <div class="toolbar">${sampleSel(x)}</div>
      <div class="grid2"><div class="tcard"><h3>${esc(x.H)} in casa</h3><p>Battuti <b>${C.show(hb)}</b> · concessi <b>${C.show(hc)}</b> <span class="sub">(${hb.n} gare)</span></p><p class="sub">Media campionato squadre di casa: ${C.show(lh)}</p></div>
      <div class="tcard"><h3>${esc(x.A)} in trasferta</h3><p>Battuti <b>${C.show(ab)}</b> · concessi <b>${C.show(ac)}</b> <span class="sub">(${ab.n} gare)</span></p><p class="sub">Media campionato squadre ospiti: ${C.show(la)} · totale per gara ${C.show(lt)}</p></div></div>
      ${halfCorners(x, hs, as)}</section>${ok ? `<section><h2>Scegli la soglia</h2>${dist}</section>${ans}${thr}` : ''}
      <p class="note">Corner per tempo e minuto del primo corner richiedono i dati evento della partita: non disponibili con le fonti attive.</p>`;
  }
  function halfCorners(x, hs, as) {
    const M = c => C.metricByCode(c);
    const a = C.agg(M('corner_1t'), hs.list); if (a.state !== 'ok') return '';
    const row = (lab, list) => `<tr><td>${lab}</td>${['corner_1t', 'corner_2t', 'corner_contro_1t', 'corner_totali_1t', 'corner_totali_2t'].map(c => `<td class="num">${C.show(C.agg(M(c), list))}</td>`).join('')}<td class="num">${C.agg(M('corner_1t'), list).n}</td></tr>`;
    return `<h3>Corner per tempo</h3><div class="scroll"><table class="stack"><thead><tr><th></th><th class="num">A favore 1° t.</th><th class="num">A favore 2° t.</th><th class="num">Contro 1° t.</th><th class="num">Totali 1° t.</th><th class="num">Totali 2° t.</th><th class="num">Gare</th></tr></thead><tbody>
      ${row(esc(x.H) + ' in casa', hs.list)}${row(esc(x.A) + ' in trasferta', as.list)}${row('Campionato (squadre di casa)', leagueRef(x, 'home'))}</tbody></table></div>
      <p class="note">Fonte: open-matchday (FotMob), solo partite con la divisione per tempo.</p>`;
  }
  function basis(x, mp, side) {
    const f = (a, b) => `${nf(a, 2)}×${nf(b, 2)}`;
    const h = `${esc(x.H)}: media casa ${nf(mp.mu[0])} × produzione ${f(mp.fh[0], mp.fh[1])} × concessione ospite ${f(mp.fh[2], mp.fh[3])} = ${nf(mp.l[0])}`;
    const a = `${esc(x.A)}: media trasferta ${nf(mp.mu[1])} × produzione ${f(mp.fa[0], mp.fa[1])} × concessione casa ${f(mp.fa[2], mp.fa[3])} = ${nf(mp.l[1])}`;
    return `<span class="sub">Su cosa si basa: ${side !== 'a' ? h : ''}${side === 'tot' ? '; ' : ''}${side !== 'h' ? a : ''}. Dati: ${mp.N} partite del campionato fino al ${C.dshort(x.p.lu)}, ${mp.n[0][0]} gare di ${esc(x.H)} e ${mp.n[1][0]} di ${esc(x.A)}; dispersione ${mp.r ? 'binomiale negativa (size ' + nf(mp.r, 1) + ')' : 'Poisson'}.</span>`;
  }
  function hitList(f) {
    return `<table class="mini"><tbody>${f.hits.slice().reverse().map(([r, o]) => `<tr><td>${C.dnum(r.m.ko)}</td><td><a href="${C.matchUrl(r.m)}">${esc(teamNameAny(r.m, 'h'))} – ${esc(teamNameAny(r.m, 'a'))}</a></td><td class="num">${r.m.s.corner ? r.m.s.corner.join('–') : '<span class="miss" title="non rilevato dalla fonte">n.r.</span>'}</td><td>${o ? '✓ sì' : '✗ no'}</td></tr>`).join('')}</tbody></table>`;
  }

  function tabPronostico(x) {
    if (!x.p) return '<p class="empty">Pronostico non disponibile. Viene calcolato e salvato nei 14 giorni che precedono la gara, usando solo dati disponibili prima del calcio d\'inizio.</p>';
    const G = CM.goalBlock(x.p, false);
    let goals = '<p class="warn">Gol: stima non disponibile (campione insufficiente).</p>';
    if (G) {
      const flat = []; for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) flat.push([G.M[i][j], i, j]); flat.sort((a, b) => b[0] - a[0]);
      const B = CM.goalBlock(x.p, true);
      goals = `${bars1x2(x)}<div class="kpis"><div class="kpi"><b>${nf(G.lh, 2)}</b><span>gol attesi ${esc(x.H)}</span></div><div class="kpi"><b>${nf(G.la, 2)}</b><span>gol attesi ${esc(x.A)}</span></div><div class="kpi"><b>${pc(G.btts)}</b><span>entrambe a segno</span><i>media campionato ${pc(B.btts)}</i></div></div>
        <div class="grid2"><div><h3>Soglie gol (90 minuti)</h3><table><thead><tr><th>Evento</th><th class="num">Modello</th><th class="num">Media campionato</th></tr></thead><tbody>${
          [1, 2, 3, 4, 5].map(k => `<tr><td>Almeno ${k} gol</td><td class="num">${pc(CM.ge(G.tot, k))}</td><td class="num">${pc(CM.ge(B.tot, k))}</td></tr>`).join('')}${
          [1, 2, 3].map(k => `<tr><td>Al massimo ${k} gol</td><td class="num">${pc(CM.le(G.tot, k))}</td><td class="num">${pc(CM.le(B.tot, k))}</td></tr>`).join('')}</tbody></table></div>
        <div><h3>Risultati esatti più probabili</h3><ol class="scores">${flat.slice(0, 3).map(([p, i, j]) => `<li><b>${i}–${j}</b> ${pc(p, 1)}</li>`).join('')}</ol>
        <p class="note">"Gol attesi" qui è la stima del modello per questa gara, non l'xG di un fornitore.</p></div></div>`;
    }
    const rows = ['corner', 'tiri', 'tiri_porta', 'falli', 'cartellini'].map(mt => {
      const mp = x.p.m[mt]; const name = MLAB[mt][0].toUpperCase() + MLAB[mt].slice(1);
      if (!mp || !mp.l) return `<tr><td>${name}</td><td colspan="4" class="nd">stima non disponibile${mp && mp.na ? ' (' + esc(mp.na) + ')' : ''}</td></tr>`;
      const P = CM.metricPmfs(mp, false); const ih = CM.interval(P.ph), ia = CM.interval(P.pa), it = CM.interval(P.pt);
      return `<tr><td>${name}${mp.ref && mp.ref[1] ? '<div class="sub">con effetto arbitro</div>' : ''}</td><td class="num">${nf(mp.l[0])} <span class="sub">${ih[0]}–${ih[1]}</span></td><td class="num">${nf(mp.l[1])} <span class="sub">${ia[0]}–${ia[1]}</span></td><td class="num"><b>${nf(mp.l[0] + mp.l[1])}</b> <span class="sub">${it[0]}–${it[1]}</span></td><td class="num">${nf(mp.mu[0] + mp.mu[1])}</td></tr>`;
    }).join('');
    const g = x.p.m.gol;
    const factors = g && g.l ? `<details><summary>Come è costruita la stima dei gol</summary><table><thead><tr><th></th><th class="num">Media campionato</th><th class="num">Produzione</th><th class="num">Fattore campo</th><th class="num">Concessione avversario</th><th class="num">Fattore campo avv.</th><th class="num">Stima</th></tr></thead><tbody>
      <tr><td>${esc(x.H)}</td><td class="num">${nf(g.mu[0], 2)}</td><td class="num">${nf(g.fh[0], 2)}</td><td class="num">${nf(g.fh[1], 2)}</td><td class="num">${nf(g.fh[2], 2)}</td><td class="num">${nf(g.fh[3], 2)}</td><td class="num"><b>${nf(g.l[0], 2)}</b></td></tr>
      <tr><td>${esc(x.A)}</td><td class="num">${nf(g.mu[1], 2)}</td><td class="num">${nf(g.fa[0], 2)}</td><td class="num">${nf(g.fa[1], 2)}</td><td class="num">${nf(g.fa[2], 2)}</td><td class="num">${nf(g.fa[3], 2)}</td><td class="num"><b>${nf(g.l[1], 2)}</b></td></tr></tbody></table>
      <p class="note">Valori sopra 1 aumentano la stima, sotto 1 la riducono. Partite usate: ${g.N} del campionato; ${esc(x.H)} ${g.n[0][0]} (${g.n[0][1]} in casa), ${esc(x.A)} ${g.n[1][0]} (${g.n[1][1]} in trasferta). <a href="#metodo">Metodo</a></p></details>` : '';
    return `${predMeta(x)}<section><h2>Esito e gol</h2>${goals}</section>${goalDetail(x)}${metricDetail(x)}
      <section><h2>Altre statistiche</h2><div class="scroll"><table class="stack"><thead><tr><th>Statistica</th><th class="num">${esc(x.H)}</th><th class="num">${esc(x.A)}</th><th class="num">Totale</th><th class="num">Media campionato</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Numero grande: valore atteso. Numeri piccoli: intervallo di previsione all'80% (8 partite su 10 dovrebbero cadere dentro).</p></section>
      <section><h2>Eventi giocatore</h2>${playerEvents(x)}</section>
      <section><h2>Lettura della partita</h2>${reading(x)}</section>${factors}`;
  }

  function goalDetail(x) {
    const G = CM.goalBlock(x.p, false); if (!G) return '';
    const N = 6; let mx = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) mx = Math.max(mx, G.M[i][j]);
    const heat = `<div class="scroll"><table class="heat"><thead><tr><th>${esc(x.H)} ↓ / ${esc(x.A)} →</th>${[...Array(N).keys()].map(j => `<th class="num">${j}${j === N - 1 ? '+' : ''}</th>`).join('')}</tr></thead><tbody>${[...Array(N).keys()].map(i =>
      `<tr><th>${i}${i === N - 1 ? '+' : ''}</th>${[...Array(N).keys()].map(j => { let v = 0; for (let a = i; a < (i === N - 1 ? 11 : i + 1); a++) for (let b = j; b < (j === N - 1 ? 11 : j + 1); b++) v += G.M[a][b];
        return `<td class="num" style="background:color-mix(in srgb,var(--pitch2) ${Math.round(v / mx * 70)}%,transparent);${v / mx > 0.55 ? 'color:#fff' : ''}">${pc(v, 1)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    const share = x.p.ht == null ? 0.44 : x.p.ht; const H1 = CM.scoreMatrix(G.lh * share, G.la * share);
    let h1 = 0, d1 = 0, a1 = 0; H1.forEach((r, i) => r.forEach((v, j) => { if (i > j) h1 += v; else if (i === j) d1 += v; else a1 += v; }));
    const mg = { h2: 0, h1: 0, d: 0, a1: 0, a2: 0 }; G.M.forEach((r, i) => r.forEach((v, j) => { const k = i - j; if (k >= 2) mg.h2 += v; else if (k === 1) mg.h1 += v; else if (k === 0) mg.d += v; else if (k === -1) mg.a1 += v; else mg.a2 += v; }));
    const p00 = G.M[0][0]; const first = { h: (1 - p00) * G.lh / (G.lh + G.la), a: (1 - p00) * G.la / (G.lh + G.la), n: p00 };
    const dist = (p, name) => `<tr><td>${esc(name)}</td>${[0, 1, 2].map(k => `<td class="num">${pc(p[k])}</td>`).join('')}<td class="num">${pc(CM.ge(p, 3))}</td></tr>`;
    return `<section><h2>Risultati esatti</h2><p class="note">Probabilità di ogni punteggio a fine partita (colore più intenso = più probabile).</p>${heat}</section>
      <section class="grid2"><div><h3>Primo tempo</h3><table><tbody><tr><td>${esc(x.H)} avanti all'intervallo</td><td class="num">${pc(h1)}</td></tr><tr><td>Pareggio all'intervallo</td><td class="num">${pc(d1)}</td></tr><tr><td>${esc(x.A)} avanti all'intervallo</td><td class="num">${pc(a1)}</td></tr><tr><td>Almeno un gol nel 1° tempo</td><td class="num">${pc(1 - H1[0][0])}</td></tr></tbody></table>
        <p class="note">Quota di gol nel primo tempo stimata dal campionato: ${pc(share)} del totale.</p></div>
      <div><h3>Margine di vittoria</h3><table><tbody><tr><td>${esc(x.H)} con 2+ gol di scarto</td><td class="num">${pc(mg.h2)}</td></tr><tr><td>${esc(x.H)} con 1 gol di scarto</td><td class="num">${pc(mg.h1)}</td></tr><tr><td>Pareggio</td><td class="num">${pc(mg.d)}</td></tr><tr><td>${esc(x.A)} con 1 gol di scarto</td><td class="num">${pc(mg.a1)}</td></tr><tr><td>${esc(x.A)} con 2+ gol di scarto</td><td class="num">${pc(mg.a2)}</td></tr></tbody></table></div>
      <div><h3>Gol per squadra</h3><table><thead><tr><th></th><th class="num">0</th><th class="num">1</th><th class="num">2</th><th class="num">3+</th></tr></thead><tbody>${dist(G.ph, x.H)}${dist(G.pa, x.A)}</tbody></table></div>
      <div><h3>Primo gol</h3><table><tbody><tr><td>Segna per prima ${esc(x.H)}</td><td class="num">${pc(first.h)}</td></tr><tr><td>Segna per prima ${esc(x.A)}</td><td class="num">${pc(first.a)}</td></tr><tr><td>Nessun gol</td><td class="num">${pc(first.n)}</td></tr></tbody></table>
        <p class="note">Approssimazione: la squadra con più gol attesi ha più probabilità di segnare per prima, in proporzione.</p></div></section>`;
  }
  function metricDetail(x) {
    const ms = ['tiri', 'tiri_porta', 'falli', 'cartellini', 'corner'].filter(mt => x.p.m[mt] && x.p.m[mt].l); if (!ms.length) return '';
    const lw = leagueWindow(x);
    const blocks = ms.map(mt => {
      const mp = x.p.m[mt]; const P = CM.metricPmfs(mp, false);
      const rows = [['h', x.H, P.ph, mp.l[0], mp.mu[0]], ['a', x.A, P.pa, mp.l[1], mp.mu[1]], ['tot', 'Totale partita', P.pt, mp.l[0] + mp.l[1], mp.mu[0] + mp.mu[1]]].map(([side, name, pm, l, mu]) => {
        const iv = CM.interval(pm); const k0 = Math.max(1, Math.round(l) - 1); const ks = [k0, k0 + 1, k0 + 2];
        return `<tr><td>${esc(name)}</td><td class="num"><b>${nf(l)}</b> <span class="sub">media ${nf(mu)}</span></td><td class="num">${iv[0]}–${iv[1]}</td>${ks.map(k => { const lf = freqOf(lw, `${mt}_${side}_ge`, 'ge' + k, k);
          return `<td class="num">≥${k}: <b>${pc(CM.ge(pm, k))}</b><div class="sub">camp. ${lf.f == null ? 'n.d.' : pc(lf.f)}</div></td>`; }).join('')}</tr>`; }).join('');
      return `<h3>${MLAB[mt][0].toUpperCase() + MLAB[mt].slice(1)}${mp.ref && mp.ref[1] ? ' <span class="sub">(con effetto arbitro ×' + nf(mp.ref[0], 2) + ')</span>' : ''}</h3>
        <div class="scroll"><table class="stack"><thead><tr><th>Squadra</th><th class="num">Attesi</th><th class="num">Intervallo 80%</th><th class="num">Soglia</th><th class="num">Soglia</th><th class="num">Soglia</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    return `<section><h2>Tiri, falli, cartellini e corner: soglie</h2><p class="note">Per ogni statistica: valore atteso, intervallo in cui cade 8 volte su 10 e probabilità delle soglie intorno alla media, confrontate con la frequenza nel campionato (ultimi 365 giorni).</p>${blocks}</section>`;
  }

  // ---------- giocatori
  function playerAgg(x, tid) {
    if (!x.pl) return [];
    return C.pAgg(x.pl, { tid, before: x.m.t, d: x.d }).filter(o => o.min > 0).sort((a, b) => b.min - a.min);
  }
  const PEV = [['tiri', 'Almeno 1 tiro'], ['tiri_porta', 'Almeno 1 tiro in porta'], ['falli_commessi', 'Almeno 1 fallo commesso'], ['falli_subiti', 'Almeno 1 fallo subito']];
  function playerEvents(x) {
    if (!x.pl) return '<p class="empty">Stima non disponibile: per questo campionato le fonti attive non forniscono ruolo e minuti dei giocatori (vedi <a href="#fonti">Fonti</a>).</p>';
    const rows = [];
    [[x.m.h, x.H], [x.m.a, x.A]].forEach(([tid, name]) => playerAgg(x, tid).forEach(o => {
      if (o.min < 450 || o.starts < 3) return;
      const starts = o.ms.filter(r => r.v.titolare && r.v.minuti && x.d.byId[r.mid]).sort((a, b) => x.d.byId[a.mid].t - x.d.byId[b.mid].t).map(r => r.v.minuti).slice(-5);
      if (!starts.length) return; const exp = starts.reduce((a, b) => a + b, 0) / starts.length;
      const ps = PEV.map(([k]) => { const mk = o.minK[k]; if (!mk || o.tot[k] == null) return null; const rate = o.tot[k] / mk * 90; return 1 - Math.exp(-rate * exp / 90); });
      rows.push({ name: o.name, pid: o.pid, team: name, role: o.role, ps, exp, min: o.min, starts: o.starts });
    }));
    const av = C.pAvail(x.pl); const okEv = PEV.map(([c]) => av.has(c));
    const k = okEv[ui.pev] ? ui.pev : okEv.findIndex(Boolean); const nrEv = rows.filter(r => r.ps[k] == null).map(r => r.name);
    rows.splice(0, rows.length, ...rows.filter(r => r.ps[k] != null)); rows.sort((a, b) => b.ps[k] - a.ps[k]); const anyNr = rows.slice(0, 16).some(r => r.ps.some((p, i) => okEv[i] && p == null));
    if (!rows.length) return '<p class="empty">Stima non disponibile: nessun giocatore con almeno 450 minuti e 3 gare da titolare prima di questa partita.</p>';
    return `<div class="seg">${PEV.map(([, t], i) => okEv[i] ? `<button data-pev="${i}" class="${i === k ? 'on' : ''}">${t}</button>` : '').join('')}</div>
      <div class="scroll"><table><thead><tr><th>Giocatore</th>${PEV.map(([, t], i) => okEv[i] ? `<th class="num ${i === k ? 'hl' : ''}">${t.replace('Almeno 1 ', '≥1 ')}</th>` : '').join('')}<th class="num">Minuti attesi</th><th class="num">Campione</th></tr></thead><tbody>${rows.slice(0, 16).map(r =>
      `<tr><td><a href="#giocatore-${r.pid}">${esc(r.name)}</a><div class="sub">${esc(r.team)} · ${esc(r.role)}</div></td>${r.ps.map((p, i) => okEv[i] ? `<td class="num ${i === k ? 'hl' : ''}">${p == null ? '<span class="miss" title="non rilevato dalla fonte per questo giocatore">n.r.</span>' : pc(p)}</td>` : '').join('')}<td class="num">${Math.round(r.exp)}'</td><td class="num">${r.min}' · ${r.starts} tit.</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Le probabilità presuppongono la titolarità: minuti attesi = media delle ultime 5 gare da titolare. Modello di Poisson sul ritmo per 90 minuti della stagione, solo partite precedenti. Affidabilità: non valutabile (nessuno storico di verifica per gli eventi giocatore).${anyNr ? ' «n.r.» = dato non rilevato dalla fonte per quel giocatore (per esempio i tiri dei portieri nei report della Lega).' : ''}${nrEv.length ? ' Esclusi per questa voce (dato non rilevato): ' + nrEv.map(esc).join(', ') + '.' : ''}</p>`;
  }
  function tabGiocatori(x) {
    if (!x.pl) return `<section><h2>Formazioni e giocatori</h2><p class="empty">Per ${esc(C.LGN(x.lg))} le fonti attive non forniscono dati individuali.</p>
      <p>Con una chiave API-Football (segreto <code>API_FOOTBALL_KEY</code>, istruzioni in <a href="#fonti">Fonti</a>) compaiono formazioni ufficiali, indisponibili e statistiche per giocatore: tiri, tiri in porta, dribbling tentati e riusciti, contrasti, falli commessi e subiti e altre.</p></section>`;
    const lu = (x.pl.lineups || {})[x.m.i] || [];
    const pn = id => esc((x.pl.players[id] || [id])[0]);
    const block = (tid, name) => {
      const mine = lu.filter(r => r[1] === tid);
      const grp = (kind, st) => mine.filter(r => r[3] === kind && (!st || r[2] === st));
      const off = grp('ufficiale', 'titolare'), bench = grp('ufficiale', 'panchina'), inj = grp('indisponibili');
      const upd = mine.length ? mine.map(r => r[5]).sort().pop() : null;
      const played = (x.pl.byMatch[x.m.i] || []).filter(r => r.tid === tid && r.v.titolare);
      return `<div class="tcard"><h3>${esc(name)}</h3>
        <p><b>Formazione ufficiale:</b> ${off.length ? off.map(r => pn(r[0])).join(', ') : played.length ? played.map(r => pn(r.pid)).join(', ') + ' <span class="sub">(titolari a referto)</span>' : '<span class="miss">non ancora pubblicata</span>'}</p>
        ${bench.length ? `<p class="sub">Panchina: ${bench.map(r => pn(r[0])).join(', ')}</p>` : ''}
        <p><b>Probabile formazione:</b> <span class="nd">non fornita dalle fonti attive</span></p>
        <p><b>Indisponibili:</b> ${inj.length ? inj.map(r => pn(r[0]) + (r[4] ? ` <span class="sub">(${esc(r[4])})</span>` : '')).join(', ') : '<span class="nd">non forniti dalle fonti attive</span>'}</p>
        <p class="sub">Fonte: ${esc(x.pl.fonte)}${upd ? ' · aggiornato ' + C.dtime(upd) : ''}</p></div>`;
    };
    const M = C.pMetricMeta(x.pl); const metric = C.pPick(x.pl, ui.mpMetric, 'tiri_porta'); const mm = M.find(z => z.code === metric);
    const cats = [...new Set(M.map(z => z.cat))];
    const sel = `<select id="mp-metric">${cats.map(c => `<optgroup label="${esc(c)}">${M.filter(z => z.cat === c).map(z => `<option value="${z.code}" ${z.code === metric ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
    const stats = [[x.m.h, x.H], [x.m.a, x.A]].map(([tid, name]) => {
      const list = playerAgg(x, tid).map(o => ({ o, v: C.pVal(o, metric, 'p90'), t: C.pVal(o, metric, 'tot') })).sort((a, b) => ((b.v && !b.v.nonapp) ? b.v.v : -1) - ((a.v && !a.v.nonapp) ? a.v.v : -1)).slice(0, 16);
      return `<h3>${esc(name)}</h3><div class="scroll"><table><thead><tr><th>Giocatore</th><th>Ruolo</th><th class="num">Pres.</th><th class="num">Min</th><th class="num">Gol</th><th class="num">${esc(mm.name)}</th><th class="num">${mm.kind === 'sum' && mm.per90 ? 'per 90\'' : ''}</th></tr></thead><tbody>${list.map(({ o, v, t }) =>
        `<tr><td><a href="#giocatore-${o.pid}">${esc(o.name)}</a></td><td>${esc(o.role)}</td><td class="num">${o.app}</td><td class="num">${o.min}</td><td class="num">${o.tot.gol || 0}</td><td class="num">${C.pShow(t)}</td><td class="num">${mm.kind === 'sum' && mm.per90 ? `<b>${C.pShow(v)}</b>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nessun dato prima di questa partita.</td></tr>'}</tbody></table></div>`;
    }).join('');
    return `<section class="grid2">${block(x.m.h, x.H)}${block(x.m.a, x.A)}</section>
      <section><h2>Giocatori: stagione prima della gara</h2><div class="toolbar"><label class="sel">Statistica ${sel}</label></div>${stats}<p class="note">Fonte: ${esc(x.pl.fonte)}. Solo partite precedenti a questa.</p></section>
      <section><h2>Eventi giocatore</h2>${playerEvents(x)}</section>`;
  }
  function matchPlayers(x) {
    const rows = x.pl && x.pl.byMatch[x.m.i]; if (!rows || !rows.length) return '';
    const M = C.pMetricMeta(x.pl).filter(z => z.kind === 'sum'); const metric = C.pPick(x.pl, ui.rpMetric, 'tiri'); const mm = M.find(z => z.code === metric) || M[0];
    const cats = [...new Set(M.map(z => z.cat))];
    const sel = `<select id="rp-metric">${cats.map(c => `<optgroup label="${esc(c)}">${M.filter(z => z.cat === c).map(z => `<option value="${z.code}" ${z.code === metric ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
    const list = rows.filter(r => r.v.minuti).sort((a, b) => (b.v[metric] == null ? -1 : b.v[metric]) - (a.v[metric] == null ? -1 : a.v[metric]));
    return `<section><h2>Giocatori in questa partita</h2><div class="toolbar"><label class="sel">Statistica ${sel}</label></div>
      <div class="scroll"><table><thead><tr><th>Giocatore</th><th>Squadra</th><th class="num">Min</th><th class="num">${esc(mm.name)}</th><th class="num">Gol</th><th class="num">Tiri</th><th class="num">In porta</th><th class="num">Falli subiti</th></tr></thead><tbody>${list.map(r =>
        `<tr><td><a href="#giocatore-${r.pid}">${esc((x.pl.players[r.pid] || [r.pid])[0])}</a></td><td>${r.tid === x.m.h ? esc(x.H) : esc(x.A)}</td><td class="num">${r.v.minuti}</td><td class="num"><b>${C.cellVal(r.v[metric] == null ? null : r.v[metric])}</b></td><td class="num">${r.v.gol || 0}</td><td class="num">${C.cellVal(r.v.tiri == null ? null : r.v.tiri)}</td><td class="num">${C.cellVal(r.v.tiri_porta == null ? null : r.v.tiri_porta)}</td><td class="num">${C.cellVal(r.v.falli_subiti == null ? null : r.v.falli_subiti)}</td></tr>`).join('')}</tbody></table></div><p class="note">Fonte: ${esc(x.pl.fonte)}.${list.some(r => [metric, 'tiri', 'tiri_porta', 'falli_subiti'].some(k => r.v[k] == null)) ? ' «n.r.» = dato non rilevato dalla fonte per quel giocatore (per esempio i report della Lega Serie A non registrano i tiri dei portieri).' : ''}</p></section>`;
  }

  // ---------- arbitro
  function tabArbitro(x) {
    const rid = x.m.r;
    const hasRefs = x.d.matches.some(m => m.r);
    if (!rid) return `<section><h2>Arbitro</h2><p class="empty">Designazione in attesa.</p><p class="note">${hasRefs ? 'Il nome comparirà qui appena la fonte pubblica la designazione.' : `Per ${esc(C.LGN(x.lg))} le fonti attive non forniscono gli arbitri. Attivando football-data.org (chiave gratuita) le designazioni vengono importate ogni giorno: vedi <a href="#fonti">Fonti</a>.`}</p>
      <p class="note">Senza arbitro, falli e cartellini sono stimati solo sui dati delle due squadre.</p></section>`;
    const name = x.d.referees[rid] || rid; const mp = x.p && x.p.m.cartellini;
    const st = refStats(x.lg, [x.prev, x.d], rid, x.m.t);
    return `<section><h2><a href="#arbitro-${rid}">${esc(name)}</a></h2><p class="note">Statistiche prima di questa gara, stagione in corso e precedente.</p>${refTable(st)}
      ${mp && mp.ref ? `<p>Nel modello: fattore arbitro <b>×${nf(mp.ref[0], 2)}</b> sui cartellini, stimato su ${mp.ref[1]} gare con prudenza (equivale ad aggiungere ${C.S.meta.parametri.chosen.cartellini.k_referee} gare di media campionato). ${mp.ref[1] < 10 ? 'Poche gare dirette: il fattore resta vicino a 1.' : ''}</p>` : ''}
      <p><a href="#arbitro-${rid}">Tutte le gare arbitrate →</a></p></section>`;
  }
  function refStats(lg, ds, rid, before) {
    const ms = [], all = [];
    ds.forEach(d => d && d.matches.forEach(m => { if (!m.g || (before && m.t >= before)) return; all.push(m); if (m.r === rid) ms.push(m); }));
    const avg = (list, f) => { const v = list.map(f).filter(z => z != null); return v.length ? [v.reduce((a, b) => a + b, 0) / v.length, v.length] : [null, 0]; };
    const S2 = (m, k, i) => m.s[k] && m.s[k][i] != null ? m.s[k][i] : null;
    const tot = (m, k) => m.s[k] && m.s[k][0] != null && m.s[k][1] != null ? m.s[k][0] + m.s[k][1] : null;
    const card = (m, i) => S2(m, 'gialli', i) != null && S2(m, 'rossi', i) != null ? m.s.gialli[i] + m.s.rossi[i] : null;
    const rows = [['Falli fischiati', m => tot(m, 'falli'), m => S2(m, 'falli', 0), m => S2(m, 'falli', 1)],
      ['Gialli', m => tot(m, 'gialli'), m => S2(m, 'gialli', 0), m => S2(m, 'gialli', 1)],
      ['Rossi', m => tot(m, 'rossi'), m => S2(m, 'rossi', 0), m => S2(m, 'rossi', 1)],
      ['Cartellini totali', m => card(m, 0) != null && card(m, 1) != null ? card(m, 0) + card(m, 1) : null, m => card(m, 0), m => card(m, 1)]];
    return { ms, rows: rows.map(([n, f, fh, fa]) => ({ n, r: avg(ms, f), tot: ms.map(f).filter(z => z != null).reduce((a, b) => a + b, 0), l: avg(all, f), h: avg(ms, fh), a: avg(ms, fa) })) };
  }
  function refTable(st) {
    return `<div class="scroll"><table><thead><tr><th>Statistica</th><th class="num">Totale</th><th class="num">Per gara</th><th class="num">Media campionato</th><th class="num">Casa / Ospite</th></tr></thead><tbody>${st.rows.map(r =>
      `<tr><td>${r.n}</td><td class="num">${r.r[1] ? r.tot : '<span class="nd" title="dato non disponibile">n.d.</span>'}</td><td class="num"><b>${nf(r.r[0], 2)}</b> <span class="sub">${r.r[1]} gare</span></td><td class="num">${nf(r.l[0], 2)}</td><td class="num">${nf(r.h[0], 2)} / ${nf(r.a[0], 2)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Gare dirette nel campione: ${st.ms.length}. ${st.ms.length < 10 ? 'Campione ridotto: i valori per gara vanno letti con prudenza.' : ''} Regola cartellini: gialli e rossi come registrati dalla fonte; un'espulsione per doppia ammonizione può comparire come giallo + rosso.</p>`;
  }

  // ---------- risultato
  function tabRisultato(x) {
    const m = x.m; if (!m.g) return '<p class="empty">La partita non è ancora conclusa.</p>';
    const r = C.res(m);
    const rows = ['gol', 'corner', 'tiri', 'tiri_porta', 'falli', 'cartellini'].map(mt => {
      const real = r[mt]; const mp = x.p && x.p.m[mt]; const name = MLAB[mt][0].toUpperCase() + MLAB[mt].slice(1);
      if (!real) return `<tr><td>${name}</td><td colspan="3" class="miss">dato mancante nella fonte</td></tr>`;
      if (!mp || !mp.l) return `<tr><td>${name}</td><td class="num">${real[0]}–${real[1]}</td><td class="num nd">stima non disponibile</td><td></td></tr>`;
      let ivt;
      if (mt === 'gol') { const G = CM.goalBlock(x.p, false); ivt = CM.interval(G.tot); } else ivt = CM.interval(CM.metricPmfs(mp, false).pt);
      const t = real[0] + real[1]; const inside = t >= ivt[0] && t <= ivt[1];
      return `<tr><td>${name}</td><td class="num"><b>${real[0]}–${real[1]}</b> <span class="sub">tot. ${t}</span></td><td class="num">${nf(mp.l[0])}–${nf(mp.l[1])} <span class="sub">tot. ${nf(mp.l[0] + mp.l[1])}, 80%: ${ivt[0]}–${ivt[1]}</span></td><td>${inside ? '✓ dentro l\'intervallo' : '✗ fuori intervallo'}</td></tr>`;
    }).join('');
    let evs = '';
    if (x.p) {
      const rep = representative(eventRows(x), 'prob').filter(z => !z.na).sort((a, b) => b.p - a.p).slice(0, 12);
      evs = `<section><h2>Eventi previsti e cosa è successo</h2><div class="scroll"><table><thead><tr><th>Evento</th><th class="num">Probabilità</th><th>Esito</th></tr></thead><tbody>${rep.map(z => {
        const o = CM.outcome(z.fam, z.key, z.k, r);
        return `<tr><td>${z.label}</td><td class="num">${pc(z.p)}</td><td>${o == null ? '<span class="miss">dato mancante</span>' : o ? '✓ verificato' : '✗ non verificato'}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="note">Una singola partita non dice se il modello è preciso: per questo c'è la pagina <a href="#precisione">Quanto è preciso?</a></p></section>`;
    }
    return `<section><h2>Tabellino effettivo e pronostico salvato</h2>${predMeta(x)}<div class="scroll"><table class="stack"><thead><tr><th>Statistica</th><th class="num">Reale</th><th class="num">Previsto prima della gara</th><th>Verifica</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Fonte risultato: ${esc(m.src[1] || 'non indicata')}. Fonte calendario: ${esc(m.src[0] || 'non indicata')}.</p></section>${evs}${matchPlayers(x)}`;
  }

  async function view(el, id, tab) {
    tab = tab || 'panoramica';
    const x = await load(id);
    if (!x) { el.innerHTML = '<section class="band"><h1>Partita non trovata</h1><p><a href="#oggi">Torna alle partite di oggi</a></p></section>'; return; }
    if (tab === 'risultato' && !x.m.g) tab = 'panoramica';
    const body = { panoramica: tabPanoramica, confronto: tabConfronto, giocatori: tabGiocatori, arbitro: tabArbitro, corner: tabCorner,
      pronostico: tabPronostico, eventi: x2 => `<section><h2>Indice degli eventi più probabili</h2>${predMeta(x2)}${eventsTable(x2)}</section>`, risultato: tabRisultato }[tab] || tabPanoramica;
    const render = () => {
      el.innerHTML = header(x, tab) + `<div class="band body">${body(x)}</div>`;
      document.title = `${x.H} – ${x.A} · Calcio in chiaro`;
    };
    render();
    el.onclick = e => {
      const t = e.target.closest('button,[data-sort]'); if (!t) return;
      if (t.dataset.open) { open.has(t.dataset.open) ? open.delete(t.dataset.open) : open.add(t.dataset.open); render(); }
      else if (t.dataset.evmode) { evSort = { mode: t.dataset.evmode, col: null, dir: -1 }; render(); }
      else if (t.dataset.sort) { const c = t.dataset.sort; evSort.dir = evSort.col === c ? -evSort.dir : -1; evSort.col = c; render(); }
      else if (t.classList.contains('exp')) { const f = t.closest('tr').dataset.fam; const k = 'ev:' + f; open.has(k) ? open.delete(k) : open.add(k); render(); }
      else if (t.dataset.cside) { cornerSel.side = t.dataset.cside; render(); }
      else if (t.dataset.ck) { cornerSel.k = +t.dataset.ck; render(); }
      else if (t.dataset.pev) { ui.pev = +t.dataset.pev; render(); }
    };
    el.onchange = e => {
      if (e.target.id === 'sample') { sampleMode = e.target.value; x.cache = {}; render(); }
      if (e.target.id === 'mp-metric') { ui.mpMetric = e.target.value; render(); }
      if (e.target.id === 'rp-metric') { ui.rpMetric = e.target.value; render(); }
    };
  }
  window.MatchView = { view, refStats, refTable };
})();
