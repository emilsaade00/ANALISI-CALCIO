/* Consigli del modello: gli eventi piu' probabili delle prossime partite (squadre e giocatori) e la schedina piu' probabile.
   Nessuna quota dei bookmaker entra nel calcolo: la "quota equa" e' 1 / probabilita' del modello. */
(function () {
  const { esc, nf, pc } = C;
  const ui = { lg: 'tutti', per: 'giornata', minP: 0.7, rel: 'media', mk: 'tutti', n: 4, conPl: false, pstat: 'tutte', pOff: false };
  const band = h => `<section class="band">${h}</section>`;
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`;
  const MAXP = 0.95; // sopra questa soglia l'evento e' quasi certo e non dice nulla
  const GROUPS = {
    esito: ['1x2', 'dc'], gol: ['gol_tot_ge', 'gol_tot_le', 'gol_h_ge', 'gol_a_ge', 'btts'],
    corner: ['corner_tot_ge', 'corner_tot_le', 'corner_h_ge', 'corner_a_ge'],
    tiri: ['tiri_tot_ge', 'tiri_h_ge', 'tiri_a_ge', 'tiri_porta_tot_ge', 'tiri_porta_h_ge', 'tiri_porta_a_ge'],
    disciplina: ['falli_tot_ge', 'falli_h_ge', 'falli_a_ge', 'cartellini_tot_ge', 'cartellini_h_ge', 'cartellini_a_ge'],
  };
  const GN = { tutti: 'Tutti i mercati', esito: 'Esito e doppia chance', gol: 'Gol, over/under, goal/no goal', corner: 'Corner', tiri: 'Tiri e tiri in porta', disciplina: 'Falli e cartellini' };
  const groupOf = fam => Object.keys(GROUPS).find(g => GROUPS[g].includes(fam));
  const PST = [['tiri', 'tiri', 'tiro', [1, 2, 3]], ['tiri_porta', 'tiri in porta', 'tiro in porta', [1, 2]], ['gol', 'gol', 'gol', [1]],
    ['assist', 'assist', 'assist', [1]], ['ga', 'gol o assist', 'gol o assist', [1]], ['falli_commessi', 'falli commessi', 'fallo commesso', [1, 2]],
    ['falli_subiti', 'falli subiti', 'fallo subito', [1, 2]]];
  const PSTN = { tiri: 'Tiri', tiri_porta: 'Tiri in porta', gol: 'Gol', assist: 'Assist', ga: 'Gol o assist', falli_commessi: 'Falli commessi', falli_subiti: 'Falli subiti' };

  // ---------- mercato in stile scommessa (solo etichetta: nessuna quota esterna)
  function market(fam, key, k) {
    if (fam === '1x2' || fam === 'dc') return key;
    if (fam === 'btts') return key === 'si' ? 'Goal' : 'No goal';
    const parts = fam.split('_'); const op = parts.pop(), side = parts.pop(), mt = parts.join('_');
    const name = { gol: '', corner: 'Corner ', tiri: 'Tiri ', tiri_porta: 'Tiri in porta ', falli: 'Falli ', cartellini: 'Cartellini ' }[mt] || '';
    const who = side === 'h' ? 'casa ' : side === 'a' ? 'ospite ' : '';
    const s = (name + who + (op === 'ge' ? 'over ' + nf(k - 0.5, 1) : 'under ' + nf(k + 0.5, 1))).trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const fair = p => nf(1 / p, 2);
  function hist(ev, lg, fam, p) {
    const b = ((((ev.by || {})[lg] || {})[fam]) || {}).bins; if (!b) return null;
    const bin = b.find(z => p >= z.da && p < z.a) || b[b.length - 1];
    return bin && bin.n ? { f: bin.verificati / bin.n, n: bin.n } : null;
  }
  const histCell = h => !h ? '<span class="nd" title="nessuna verifica disponibile">n.d.</span>' :
    `${pc(h.f)}<div class="sub">${h.n} casi${h.n < 30 ? ' · pochi' : ''}</div>`;
  const relChip = r => `<span class="rel rel-${String(r).replace(' ', '-')}">${esc(r)}</span>`;
  // probabilita' "prudente": la piu' bassa tra modello e frequenza verificata, se lo storico e' ampio
  const prudent = t => t.h && t.h.n >= 30 ? Math.min(t.p, t.h.f) : t.p;

  // ---------- partite del periodo
  function currentMd(d) {
    const now = Date.now();
    const up = d.matches.filter(m => !m.g && m.t > now - 864e5 && m.st !== 'POSTPONED').sort((a, b) => a.t - b.t)[0];
    return up ? up.mo || up.md || 1 : null;
  }
  function pickMatches(x) {
    const now = Date.now();
    let list = x.d.matches.filter(m => !m.g && m.t > now - 10 * 60e3 && !['POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(m.st));
    if (ui.per === 'giornata') { const md = currentMd(x.d); list = list.filter(m => (m.mo || m.md) === md); }
    else if (ui.per === 'oggi') { const k = C.dayKey(now); list = list.filter(m => C.dayKey(m.t) === k); }
    else { const days = ui.per === '3g' ? 3 : 7; list = list.filter(m => m.t <= now + days * 864e5); }
    return list.sort((a, b) => a.t - b.t);
  }

  // ---------- consigli di squadra
  function teamTips(x, m, ev) {
    const pr = x.P[m.i]; if (!pr || !pr.p) return [];
    const ctx = { H: C.teamName(x.d, m.h), A: C.teamName(x.d, m.a) };
    const rel = ev.reliability[x.L.code] || {};
    const byFam = {};
    CM.events(pr.p, false).forEach(([fam, key, k, p]) => {
      const g = groupOf(fam); if (!g || (ui.mk !== 'tutti' && ui.mk !== g)) return;
      if (p < ui.minP || p > MAXP) return;
      const r = rel[fam] || 'non valutabile';
      if (ui.rel === 'alta' ? r !== 'alta' : !['alta', 'media'].includes(r)) return;
      const cur = byFam[fam];
      // per ogni mercato la linea piu' impegnativa che resta sopra la soglia
      const better = !cur || (fam.endsWith('_ge') ? k > cur.k : fam.endsWith('_le') ? k < cur.k : p > cur.p);
      if (better) byFam[fam] = { fam, key, k, p, rel: r };
    });
    return Object.values(byFam).map(t => Object.assign(t, {
      kind: 'squadra', m, x, g: groupOf(t.fam), label: MatchView.evLabel(ctx, t.fam, t.key, t.k), mk: market(t.fam, t.key, t.k),
      h: hist(ev, x.L.code, t.fam, t.p), H: ctx.H, A: ctx.A,
    }));
  }

  // ---------- consigli sui giocatori
  const pois = (lam, k) => { let s = 0, t = Math.exp(-lam); for (let i = 0; i < k; i++) { s += t; t *= lam / (i + 1); } return 1 - s; };
  function rateOf(tot, minK, code) {
    if (code === 'ga') {
      if (tot.gol == null || tot.assist == null) return null;
      const mk = Math.min(minK.gol || 0, minK.assist || 0); return mk >= 450 ? (tot.gol + tot.assist) / mk * 90 : null;
    }
    if (tot[code] == null) return null; const mk = minK[code] || 0; return mk >= 450 ? tot[code] / mk * 90 : null;
  }
  const outcomeOf = (v, code) => code === 'ga' ? (v.gol != null && v.assist != null ? v.gol + v.assist : null) : v[code];
  // verifica sulle partite gia' giocate della stagione: stessa regola, solo dati precedenti a ogni partita, titolari effettivi
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
    const past = x.d.matches.filter(z => z.g && z.t < m.t && (z.h === tid || z.a === tid) && x.pd.byMatch[z.i]).sort((a, b) => b.t - a.t).slice(0, 5);
    if (past.length < 3) return { ids: new Set(), off: false };
    const cnt = {};
    past.forEach(z => x.pd.byMatch[z.i].forEach(r => { if (r.tid === tid && r.v.titolare && r.v.minuti) cnt[r.pid] = (cnt[r.pid] || 0) + 1; }));
    const need = Math.max(3, Math.ceil(past.length * 0.8));
    return { ids: new Set(Object.keys(cnt).filter(p => cnt[p] >= need)), off: false, cnt, n: past.length };
  }
  function playerTips(x, m) {
    if (!x.pd) return [];
    const out = [];
    [m.h, m.a].forEach(tid => {
      const st = starters(x, m, tid); if (!st.ids.size || (ui.pOff && !st.off)) return;
      C.pAgg(x.pd, { tid, before: m.t, d: x.d }).forEach(o => {
        if (!st.ids.has(o.pid) || o.min < 450) return;
        const sm = o.ms.filter(r => r.v.titolare && r.v.minuti).sort((a, b) => a.t - b.t).map(r => r.v.minuti).slice(-5);
        if (sm.length < 3) return;
        const exp = sm.reduce((a, b) => a + b, 0) / sm.length;
        PST.forEach(([code, plur, sing, ks]) => {
          if (ui.pstat !== 'tutte' && ui.pstat !== code) return;
          const rt = rateOf(o.tot, o.minK, code); if (rt == null) return;
          let best = null;
          ks.forEach(k => { const p = pois(rt * exp / 90, k); if (p >= ui.minP && p <= MAXP && (!best || k > best.k)) best = { k, p }; });
          if (!best) return;
          const what = code === 'gol' ? 'Segna' : code === 'assist' ? 'Fa almeno un assist' : code === 'ga' ? 'Segna o fa assist' : `Almeno ${best.k} ${best.k === 1 ? sing : plur}`;
          out.push({ kind: 'giocatore', m, x, pid: o.pid, name: o.name, role: o.role, tid, team: C.teamName(x.d, tid), code, k: best.k, p: best.p,
            off: st.off, exp, rate: rt, mk: what, label: `${esc(o.name)} (${esc(C.teamName(x.d, tid))}): ${what.toLowerCase()}`,
            h: phist(x, code, best.k, best.p), H: C.teamName(x.d, m.h), A: C.teamName(x.d, m.a) });
        });
      });
    });
    return out;
  }

  // ---------- schedina
  function schedina(all) {
    const pool = all.filter(t => ui.conPl || t.kind === 'squadra').sort((a, b) => prudent(b) - prudent(a) || b.p - a.p);
    const used = new Set(), pick = [];
    for (const t of pool) { if (used.has(t.m.i)) continue; pick.push(t); used.add(t.m.i); if (pick.length >= 8) break; }
    return pick;
  }

  // ---------- pagina
  const matchCell = t => `<a href="${C.matchUrl(t.m, 'eventi')}">${esc(t.H)} – ${esc(t.A)}</a><div class="sub">${esc(t.x.L.name)} · ${C.dshort(t.m.ko)} ${C.hm(t.m.ko)}</div>`;
  const probCell = t => `<b class="big">${pc(t.p)}</b>`;
  function teamTable(tips) {
    // per ogni partita: il miglior consiglio di ciascun tipo di mercato, poi i 3 migliori (varieta' invece di tre linee simili)
    const byMatch = {};
    tips.slice().sort((a, b) => prudent(b) - prudent(a) || b.p - a.p).forEach(t => {
      const o = byMatch[t.m.i] = byMatch[t.m.i] || { g: new Set(), list: [] };
      if (o.g.has(t.g) || o.list.length >= 3) return; o.g.add(t.g); o.list.push(t);
    });
    const shown = Object.values(byMatch).flatMap(o => o.list).sort((a, b) => prudent(b) - prudent(a) || b.p - a.p);
    if (!shown.length) return '<p class="empty">Nessun evento sopra la soglia scelta con questi filtri. Prova ad abbassare la probabilità minima o ad allargare il periodo.</p>';
    return `<div class="scroll"><table class="evt tips"><thead><tr><th>Partita</th><th>Consiglio</th><th class="num">Probabilità</th><th class="num">Storico verificato</th><th class="num">Quota equa</th><th>Affidabilità</th></tr></thead><tbody>${shown.map(t =>
      `<tr><td>${matchCell(t)}</td><td><b>${esc(t.mk)}</b><div class="sub">${t.label}</div></td><td class="num">${probCell(t)}</td><td class="num">${histCell(t.h)}</td><td class="num">${fair(t.p)}</td><td>${relChip(t.rel)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Al massimo 3 consigli per partita, di tipo diverso (esito, gol, corner, tiri, falli e cartellini), ordinati per probabilità prudente: la più bassa tra quella del modello e quella verificata in passato, quando lo storico ha almeno 30 casi. Per ogni mercato compare la linea più impegnativa che resta sopra la soglia (per esempio over 2,5 invece di over 1,5 se entrambe la superano). <b>Storico verificato</b>: quante volte si è verificato, in passato, lo stesso tipo di evento quando il modello gli dava una probabilità simile (stagioni successive alla taratura, solo dati disponibili prima di ogni partita). <b>Quota equa</b> = 1 ÷ probabilità: una giocata ha senso solo se la quota offerta è più alta.</p>`;
  }
  function playerTable(tips) {
    const shown = tips.sort((a, b) => prudent(b) - prudent(a) || b.p - a.p).slice(0, 120);
    if (!shown.length) return '<p class="empty">Nessun consiglio sui giocatori con questi filtri. Servono almeno 450 minuti e 3 partite da titolare; per Serie A, Bundesliga e LaLiga alcune statistiche (contrasti, dribbling) non sono rilevate.</p>';
    return `<div class="scroll"><table class="evt tips"><thead><tr><th>Giocatore</th><th>Partita</th><th>Consiglio</th><th class="num">Probabilità</th><th class="num">Storico verificato</th><th class="num">Quota equa</th><th class="num">Ritmo</th></tr></thead><tbody>${shown.map(t =>
      `<tr><td><a href="#giocatore-${esc(t.pid)}">${esc(t.name)}</a><div class="sub">${esc(t.team)} · ${esc(t.role)} · ${t.off ? '<b>titolare ufficiale</b>' : 'titolare probabile'}</div></td><td>${matchCell(t)}</td><td><b>${esc(t.mk)}</b><div class="sub">${esc(PSTN[t.code])}</div></td><td class="num">${probCell(t)}</td><td class="num">${histCell(t.h)}</td><td class="num">${fair(t.p)}</td><td class="num">${nf(t.rate, 2)}/90'<div class="sub">${Math.round(t.exp)}' attesi</div></td></tr>`).join('')}</tbody></table></div>
      <p class="note">Solo giocatori che partono titolari: nella formazione ufficiale se già pubblicata (l'app la controlla ogni 30 minuti, di solito esce un'ora prima), altrimenti titolari in almeno 4 delle ultime 5 partite. Ordinati per probabilità prudente (la più bassa tra modello e storico verificato, se lo storico ha almeno 30 casi). Probabilità: modello di Poisson sul ritmo stagionale ogni 90 minuti × minuti attesi (media delle ultime 5 gare da titolare). <b>Storico verificato</b>: stessa regola applicata alle partite già giocate di questa stagione, sui titolari effettivi. Una formazione non ancora ufficiale aggiunge incertezza: se il giocatore va in panchina il consiglio non vale.</p>`;
  }
  function slipView(all) {
    const pick = schedina(all);
    if (!pick.length) return '<p class="empty">Nessuna selezione disponibile con questi filtri.</p>';
    const sel = pick.slice(0, ui.n);
    const P = sel.reduce((a, t) => a * t.p, 1), Pp = sel.reduce((a, t) => a * prudent(t), 1);
    const odds = sel.reduce((a, t) => a / t.p, 1);
    let cum = 1, cumP = 1;
    const curve = pick.map((t, i) => { cum *= t.p; cumP *= prudent(t); return [i + 1, cum, cumP]; });
    return `<div class="kpis"><div class="kpi hi"><b>${pc(P, 1)}</b><span>probabilità che vadano tutte bene, secondo il modello</span><i>circa 1 volta ogni ${nf(1 / P, 1)}</i></div>
      <div class="kpi"><b>${pc(Pp, 1)}</b><span>stima prudente con lo storico verificato</span><i>la più bassa tra modello e frequenza osservata</i></div>
      <div class="kpi"><b>${nf(odds, 2)}</b><span>quota equa della schedina</span><i>conviene solo se quella offerta è più alta</i></div></div>
      <div class="scroll"><table class="evt tips"><thead><tr><th>#</th><th>Partita</th><th>Selezione</th><th class="num">Probabilità</th><th class="num">Storico</th><th class="num">Quota equa</th></tr></thead><tbody>${sel.map((t, i) =>
        `<tr><td>${i + 1}</td><td>${matchCell(t)}</td><td><b>${esc(t.mk)}</b><div class="sub">${t.kind === 'giocatore' ? esc(t.name) + ' · ' + (t.off ? 'titolare ufficiale' : 'titolare probabile') : t.label}</div></td><td class="num">${probCell(t)}</td><td class="num">${histCell(t.h)}</td><td class="num">${fair(t.p)}</td></tr>`).join('')}</tbody></table></div>
      <h3>Quante selezioni mettere</h3><div class="scroll"><table><thead><tr><th>Selezioni</th>${curve.map(c => `<th class="num${c[0] === ui.n ? ' hl' : ''}">${c[0]}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Tutte vincenti (modello)</td>${curve.map(c => `<td class="num${c[0] === ui.n ? ' hl' : ''}">${pc(c[1], 0)}</td>`).join('')}</tr>
      <tr><td>Stima prudente</td>${curve.map(c => `<td class="num${c[0] === ui.n ? ' hl' : ''}">${pc(c[2], 0)}</td>`).join('')}</tr></tbody></table></div>
      <p class="note"><b>Perché non esiste una schedina perfetta.</b> Ogni selezione in più moltiplica le probabilità: anche con eventi all'80%, cinque insieme riescono circa una volta su tre (0,8 × 0,8 × 0,8 × 0,8 × 0,8 = 33%). La schedina qui sopra prende, per ogni partita, al massimo un evento tra i più probabili e affidabili, così le selezioni non dipendono l'una dall'altra; la probabilità finale è il prodotto delle singole. È la combinazione più probabile secondo il modello, non una vincita sicura.</p>`;
  }

  async function view(app, tab) {
    const meta = C.S.meta; const ev = await C.evalData();
    const Ls = meta.campionati.filter(L => ui.lg === 'tutti' || L.code === ui.lg);
    const xs = await Promise.all(Ls.map(async L => {
      const s = L.current; const [d, P, pd] = await Promise.all([C.season(L.code, s), C.preds(L.code, s), C.players(L.code, s)]);
      return { L, s, d, P: P || {}, pd };
    }));
    const team = [], pl = []; let nMatch = 0, noPred = 0; const mds = [];
    xs.forEach(x => {
      if (!x.d) return;
      const ms = pickMatches(x); nMatch += ms.length;
      if (ui.per === 'giornata' && ms.length) mds.push(`${x.L.name} ${ms[0].mo || ms[0].md}ª`);
      ms.forEach(m => {
        if (!(x.P[m.i] && x.P[m.i].p)) noPred++;
        if (tab !== 'giocatori') team.push(...teamTips(x, m, ev));
        if (tab === 'giocatori' || (tab === 'schedina' && ui.conPl)) pl.push(...playerTips(x, m));
      });
    });
    const seg = `<div class="seg" role="tablist">${[['squadre', 'Partite e squadre'], ['giocatori', 'Giocatori'], ['schedina', 'Schedina più probabile']].map(([k, t]) =>
      `<a role="tab" class="segbtn ${tab === k ? 'on' : ''}" href="#consigli${k === 'squadre' ? '' : '-' + k}">${t}</a>`).join('')}</div>`;
    const tools = `<div class="toolbar">
      <label class="sel">Campionato <select id="c-lg">${opt('tutti', 'Tutti', ui.lg)}${meta.campionati.map(L => opt(L.code, L.name, ui.lg)).join('')}</select></label>
      <label class="sel">Periodo <select id="c-per">${[['giornata', 'Prossima giornata'], ['oggi', 'Oggi'], ['3g', 'Prossimi 3 giorni'], ['7g', 'Prossimi 7 giorni']].map(([v, t]) => opt(v, t, ui.per)).join('')}</select></label>
      <label class="sel">Probabilità minima <select id="c-min">${[0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9].map(v => opt(v, pc(v), ui.minP)).join('')}</select></label>
      ${tab !== 'giocatori' ? `<label class="sel">Affidabilità <select id="c-rel">${opt('media', 'Alta e media', ui.rel)}${opt('alta', 'Solo alta', ui.rel)}</select></label>` : ''}
      ${tab !== 'giocatori' ? `<label class="sel">Mercato <select id="c-mk">${Object.entries(GN).map(([v, t]) => opt(v, t, ui.mk)).join('')}</select></label>` : ''}
      ${tab === 'giocatori' ? `<label class="sel">Statistica <select id="c-ps">${opt('tutte', 'Tutte', ui.pstat)}${PST.map(([c]) => opt(c, PSTN[c], ui.pstat)).join('')}</select></label>
        <label class="sel chk"><input type="checkbox" id="c-off" ${ui.pOff ? 'checked' : ''}> Solo formazioni ufficiali</label>` : ''}
      ${tab === 'schedina' ? `<label class="sel">Selezioni <select id="c-n">${[2, 3, 4, 5, 6, 7, 8].map(v => opt(v, v, ui.n)).join('')}</select></label>
        <label class="sel chk"><input type="checkbox" id="c-pl" ${ui.conPl ? 'checked' : ''}> Includi giocatori</label>` : ''}</div>`;
    const scope = `${nMatch} partite${ui.per === 'giornata' && mds.length ? ' · giornata: ' + mds.join(', ') : ''}${noPred ? ` · ${noPred} senza pronostico (calcolato nei 14 giorni prima della gara)` : ''}`;
    const body = tab === 'giocatori' ? playerTable(pl) : tab === 'schedina' ? slipView(team.concat(pl)) : teamTable(team);
    app.innerHTML = band(`<h1>Consigli del modello</h1>
      <p class="lead">Gli eventi che il modello ritiene più probabili nelle prossime partite, con la verifica di quanto ci ha preso in passato. Nessuna quota dei bookmaker entra nel calcolo.</p>
      ${seg}${tools}<p class="note">${esc(scope)}</p>`) + band(body) +
      band(`<p class="note"><b>Gioco responsabile.</b> Il gioco è vietato ai minori di 18 anni e può causare dipendenza. Queste sono stime statistiche, non certezze: punta solo ciò che puoi permetterti di perdere. Se il gioco ti crea problemi, il Telefono Verde Nazionale dell'Istituto Superiore di Sanità risponde gratis e in anonimo all'<b>800 558822</b> (lunedì–venerdì, 10–16).</p>`);
    const re = () => view(app, tab);
    const on = (id, f) => { const el = document.getElementById(id); if (el) el.onchange = e => { f(e.target); re(); }; };
    on('c-lg', t => ui.lg = t.value); on('c-per', t => ui.per = t.value); on('c-min', t => ui.minP = +t.value); on('c-rel', t => ui.rel = t.value);
    on('c-mk', t => ui.mk = t.value); on('c-ps', t => ui.pstat = t.value); on('c-off', t => ui.pOff = t.checked); on('c-n', t => ui.n = +t.value); on('c-pl', t => ui.conPl = t.checked);
  }
  window.Consigli = { view };
})();
