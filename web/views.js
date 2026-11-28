/* Pagine: oggi, campionati, giornata, squadra, arbitri, giocatori, statistiche, precisione, fonti, metodo. */
(function () {
  const { esc, nf, pc } = C;
  const app = document.getElementById('app');
  const ui = { lg: 'tutti', teamFilter: 'stagione', from: '', to: '', teamSeason: {}, openRows: new Set(), statLg: null, statSeason: null, statCat: '', statQ: '', statTeam: '', statScope: 'squadre', precLg: 'tutti', precGroup: 'Esito', plRole: '', plMin: 450, plCmp: [], plLg: '', plMetric: 'tiri_porta', plMode: 'p90', plTeam: '', pdMetric: 'tiri', tpMetric: 'tiri_porta' };

  const band = h => `<section class="band">${h}</section>`;
  const opt = (v, t, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`;

  function alerts(full) {
    const m = C.S.meta; const out = [];
    if (m.nota_ambiente) out.push(`<p class="warn">${esc(m.nota_ambiente)}</p>`);
    if (full) { m.avvisi.forEach(a => out.push(`<p class="${a.livello === 'info' ? 'info' : 'warn'}">${esc(a.testo)}</p>`)); return out.join(''); }
    const rit = m.avvisi.filter(a => a.livello === 'ritardo');
    if (rit.length) {
      const last = rit.map(a => a.ultimo).filter(Boolean).sort().pop();
      out.push(`<p class="warn"><b>Dati in ritardo</b> per ${rit.map(a => esc(C.LGN(a.lega))).join(', ')}: ${rit.reduce((s, a) => s + a.n, 0)} partite già disputate senza risultato importato${last ? `; ultimo risultato disponibile del ${C.dshort(last)}` : ''}. Le partite e i pronostici restano consultabili. <a href="#fonti">Dettagli</a></p>`);
    }
    const mis = m.avvisi.filter(a => a.livello === 'mancante' && a.lega);
    if (mis.length) out.push(`<p class="warn"><b>Statistiche mancanti</b> nella stagione in corso: ${mis.map(a => `${esc(C.LGN(a.lega))} ${a.n}`).join(', ')} partite con risultato ma senza tiri, corner, falli e cartellini. <a href="#fonti">Dettagli</a></p>`);
    const src = m.avvisi.filter(a => a.livello === 'fonte');
    if (src.length) out.push(`<p class="warn"><b>Fonti non aggiornate:</b> ${src.map(a => esc(a.testo.split(':')[0])).join(', ')}. <a href="#fonti">Dettagli</a></p>`);
    return out.join('');
  }

  // ---------------------------------------------------------------- partite: card
  function matchCard(m, d, P, opts) {
    opts = opts || {};
    const p = P && P[m.i] && P[m.i].p; let pr = '';
    if (p && p.m.gol && p.m.gol.l) {
      const G = CM.goalBlock(p, false); const c = p.m.corner && p.m.corner.l ? nf(p.m.corner.l[0] + p.m.corner.l[1]) : 'n.d.';
      pr = `<div class="mini12"><span title="vittoria casa">1 ${pc(G.p1)}</span><span title="pareggio">X ${pc(G.px)}</span><span title="vittoria ospite">2 ${pc(G.p2)}</span><span class="sub">gol ${nf(G.lh + G.la)} · corner ${c}</span></div>`;
    } else if (!m.g) pr = '<div class="mini12 sub">pronostico nei 14 giorni prima della gara</div>';
    const time = m.st === 'POSTPONED' ? 'Rinv.' : m.tk ? C.hm(m.ko) : 'n.d.';
    return `<a class="mcard" href="${C.matchUrl(m)}"><span class="mt">${opts.date ? C.dshort(m.ko) + '<br>' : ''}${time}</span>
      <span class="mteams"><span>${esc(C.teamName(d, m.h))}</span><span>${esc(C.teamName(d, m.a))}</span></span>
      <span class="mscore">${m.g ? `<b>${m.g[0]}</b><b>${m.g[1]}</b>` : `<i>–</i><i>–</i>`}</span>
      <span class="mside">${m.tag ? `<span class="tag">${m.tag}${m.mo && m.md && m.mo !== m.md ? ' · G' + m.mo : ''}</span>` : ''}${pr}</span></a>`;
  }

  // ---------------------------------------------------------------- oggi
  async function home(dateKey) {
    const meta = C.S.meta;
    const ds = await Promise.all(meta.campionati.map(l => C.season(l.code, l.current)));
    const ps = await Promise.all(meta.campionati.map(l => C.preds(l.code, l.current)));
    const all = [];
    ds.forEach((d, i) => d && d.matches.forEach(m => all.push([m, d, ps[i]])));
    const today = C.dayKey(Date.now());
    const days = [...new Set(all.map(([m]) => C.dayKey(m.t)))].sort();
    let key = dateKey || today; let note = '';
    if (!days.includes(key)) {
      const nx = days.find(x => x > key);
      note = nx ? `${key === today ? 'Oggi' : 'In questa data'} non si gioca: ecco la prossima giornata disponibile.` : 'Nessuna partita in calendario da questa data.';
      if (nx) key = nx;
    }
    const prevD = days.filter(x => x < key).pop(), nextD = days.find(x => x > key);
    const iso = key + 'T12:00:00Z';
    const sel = all.filter(([m]) => C.dayKey(m.t) === key && (ui.lg === 'tutti' || m.lg === ui.lg)).sort((a, b) => a[0].t - b[0].t);
    const groups = meta.campionati.map(l => [l, sel.filter(([m]) => m.lg === l.code)]).filter(([, l]) => l.length);
    const chips = [['tutti', 'Tutti']].concat(meta.campionati.map(l => [l.code, l.name])).map(([k, t]) => `<button data-lg="${k}" class="${ui.lg === k ? 'on' : ''}">${esc(t)}</button>`).join('');
    app.innerHTML = band(`<div class="hero"><div><h1>${key === today ? 'Partite di oggi' : 'Partite del giorno'}</h1><p class="lead">${C.dlong(iso)} · orari ora italiana</p></div>
      <div class="daynav">${prevD ? `<a class="btn" href="#data-${prevD}" aria-label="Giorno precedente con partite">‹ ${C.dshort(prevD + 'T12:00:00Z')}</a>` : ''}
      <label class="sel"><span class="vh">Vai alla data</span><input type="date" id="jump" value="${key}"></label>
      ${nextD ? `<a class="btn" href="#data-${nextD}" aria-label="Giorno successivo con partite">${C.dshort(nextD + 'T12:00:00Z')} ›</a>` : ''}</div></div>
      ${note ? `<p class="info">${note}</p>` : ''}${alerts()}
      <div class="chips" role="group" aria-label="Filtra per campionato">${chips}</div>
      ${groups.length ? groups.map(([l, list]) => `<h2 class="lgh"><a href="#lega-${l.code}">${esc(l.name)}</a> <span class="sub">Giornata ${[...new Set(list.map(([m]) => m.mo || m.md))].join(', ')}</span></h2><div class="mlist">${list.map(([m, d, p]) => matchCard(m, d, p)).join('')}</div>`).join('')
        : '<p class="empty">Nessuna partita per il filtro scelto.</p>'}`);
    app.onclick = e => { const b = e.target.closest('[data-lg]'); if (b) { ui.lg = b.dataset.lg; home(dateKey); } };
    const j = document.getElementById('jump'); if (j) j.onchange = () => { if (j.value) location.hash = 'data-' + j.value; };
  }

  // ---------------------------------------------------------------- campionati e giornata
  async function leagues() {
    const meta = C.S.meta;
    const cards = await Promise.all(meta.campionati.map(async l => {
      const d = await C.season(l.code, l.current); const md = currentMd(d);
      const st = d ? C.standings(d).slice(0, 4) : [];
      return `<div class="tcard"><h2><a href="#giornata-${l.code}-${C.scode(l.current)}-${md}">${esc(l.name)}</a></h2><p class="sub">${esc(l.country)} · stagione ${esc(l.current)} · giornata ${md}</p>
        <ol class="mini-st">${st.map(r => `<li><a href="${C.teamUrl(r.id)}">${esc(C.teamName(d, r.id))}</a> <b>${r.pts}</b></li>`).join('')}</ol>
        <p><a href="#giornata-${l.code}-${C.scode(l.current)}-${md}">Giornata ${md} →</a> · <a href="#arbitri-${l.code}">Arbitri</a></p></div>`;
    }));
    app.innerHTML = band(`<h1>Campionati</h1><p class="lead">Serie A, Premier League, Bundesliga e LaLiga: naviga per stagione, giornata e data.</p><div class="grid2">${cards.join('')}</div>`);
  }
  function currentMd(d) {
    if (!d) return 1; const now = Date.now();
    const up = d.matches.filter(m => !m.g && m.t > now - 864e5 && m.st !== 'POSTPONED').sort((a, b) => a.t - b.t)[0];
    if (up) return up.mo || up.md || 1;
    const last = d.matches.filter(m => m.g).sort((a, b) => b.t - a.t)[0];
    return last ? last.mo || last.md || 1 : 1;
  }
  async function giornata(lg, code, md) {
    const meta = C.S.meta; const L = C.leagueInfo(lg); if (!L) return notFound();
    const season = C.sfrom(code); const d = await C.season(lg, season); const P = await C.preds(lg, season);
    if (!d) return notFound();
    md = md || currentMd(d);
    const list = d.matches.filter(m => (m.mo || m.md) === md).sort((a, b) => a.t - b.t);
    const days = [...new Set(list.map(m => C.dayKey(m.t)))];
    const lastT = Math.max(...list.filter(m => m.g).map(m => m.t), 0);
    const st = C.standings(d, lastT ? lastT + 1 : undefined);
    const mds = d.mds; const i = mds.indexOf(md);
    app.innerHTML = band(`<h1>${esc(L.name)} <span class="sub">${esc(season)}</span></h1>
      <div class="toolbar"><label class="sel">Campionato <select id="g-lg">${meta.campionati.map(c => opt(c.code, c.name, lg)).join('')}</select></label>
      <label class="sel">Stagione <select id="g-s">${L.seasons.slice().reverse().map(s => opt(C.scode(s), s, code)).join('')}</select></label>
      <label class="sel">Giornata <select id="g-md">${mds.map(x => opt(x, 'Giornata ' + x, md)).join('')}</select></label></div>
      <div class="daynav">${i > 0 ? `<a class="btn" href="#giornata-${lg}-${code}-${mds[i - 1]}">‹ Giornata ${mds[i - 1]}</a>` : ''}${i < mds.length - 1 ? `<a class="btn" href="#giornata-${lg}-${code}-${mds[i + 1]}">Giornata ${mds[i + 1]} ›</a>` : ''}</div>
      ${days.map(k => `<h2 class="lgh">${C.dlong(k + 'T12:00:00Z')}</h2><div class="mlist">${list.filter(m => C.dayKey(m.t) === k).map(m => matchCard(m, d, P)).join('')}</div>`).join('') || '<p class="empty">Nessuna partita.</p>'}
      <p class="note">Le partite restano collegate alla giornata originale anche se anticipate, posticipate, rinviate o recuperate in un'altra data.</p>`) +
      band(leagueTables(d, lastT, md, lg, code));
    bindLeagueTables(() => giornata(lg, code, md));
    const go = () => { location.hash = `giornata-${document.getElementById('g-lg').value}-${document.getElementById('g-s').value}-${document.getElementById('g-md').value}`; };
    document.getElementById('g-md').onchange = go;
    document.getElementById('g-s').onchange = () => { location.hash = `giornata-${lg}-${document.getElementById('g-s').value}-1`; };
    document.getElementById('g-lg').onchange = () => { const c = document.getElementById('g-lg').value; location.hash = 'lega-' + c; };
  }
  function leagueTables(d, lastT, md, lg, code) {
    const tab = ui.stTab || 'tot'; const before = lastT ? lastT + 1 : undefined;
    const tabs = [['tot', 'Classifica'], ['home', 'In casa'], ['away', 'In trasferta'], ['form', 'Forma (ultime 5)'], ['stat', 'Statistiche squadre']];
    let body;
    if (tab === 'stat') {
      const metric = C.metricByCode(ui.stMetric) || C.metricByCode('tiri'); const venue = ui.stVenue || 'all';
      const cats = [...new Set(C.S.meta.catalogo.filter(x => x.f.t !== 'na').map(x => x.cat))];
      const rows = Object.keys(d.teams).map(tid => ({ tid, a: C.agg(metric, C.teamMatches(d, tid, { venue: venue === 'all' ? undefined : venue, before })) }))
        .filter(r => r.a.state === 'ok').sort((x, y) => y.a.v - x.a.v);
      const lgAvg = C.agg(metric, C.leagueList(d, { venue: venue === 'all' ? undefined : venue, before }));
      const max = Math.max(...rows.map(r => Math.abs(r.a.v)), 0.0001);
      body = `<div class="toolbar"><label class="sel">Statistica <select id="st-metric">${cats.map(c => `<optgroup label="${esc(c)}">${C.S.meta.catalogo.filter(x => x.cat === c && x.f.t !== 'na').map(x => opt(x.code, x.name, metric.code)).join('')}</optgroup>`).join('')}</select></label>
        <div class="seg">${[['all', 'Tutte'], ['home', 'In casa'], ['away', 'In trasferta']].map(([k, t]) => `<button data-stvenue="${k}" class="${venue === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        ${rows.length ? `<p class="note">${esc(metric.name)} (${esc(metric.unit)}) · media campionato <b>${C.show(lgAvg)}</b> · fonte: ${esc(metric.src)}</p>
        <div class="lbars">${rows.map((r, i) => `<a class="lbar" href="${C.teamUrl(r.tid)}"><span class="lpos">${i + 1}</span><span class="lname">${esc(C.teamName(d, r.tid))}</span><span class="ltrack"><i style="width:${(Math.abs(r.a.v) / max * 100).toFixed(1)}%" class="${lgAvg.v != null && r.a.v >= lgAvg.v ? 'up' : ''}"></i></span><b>${C.show(r.a, metric.agg === 'rate' ? 0 : undefined)}</b><span class="sub">${r.a.n} g.</span></a>`).join('')}</div>`
        : '<p class="empty">Statistica non disponibile per questo campionato e stagione con le fonti attive.</p>'}`;
    } else {
      const st = tab === 'form' ? C.standings(d, before, null, 5) : C.standings(d, before, tab === 'tot' ? null : tab);
      body = standingsTable(d, st.filter(r => r.p));
    }
    return `<h2>Classifiche e statistiche ${lastT ? `<span class="sub">dopo la giornata ${md}</span>` : ''}</h2><div class="seg tabsx">${tabs.map(([k, t]) => `<button data-sttab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>${body}`;
  }
  function bindLeagueTables(rerun) {
    app.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.sttab) { ui.stTab = b.dataset.sttab; rerun(); } if (b.dataset.stvenue) { ui.stVenue = b.dataset.stvenue; rerun(); } };
    const m = document.getElementById('st-metric'); if (m) m.onchange = e => { ui.stMetric = e.target.value; rerun(); };
  }
  function standingsTable(d, st) {
    return `<div class="scroll"><table class="std"><thead><tr><th>#</th><th>Squadra</th><th class="num">Pt</th><th class="num">G</th><th class="num">V</th><th class="num">N</th><th class="num">P</th><th class="num">GF</th><th class="num">GS</th><th class="num">DR</th><th>Forma</th></tr></thead><tbody>${st.map((r, i) =>
      `<tr><td>${i + 1}</td><td><a href="${C.teamUrl(r.id)}">${esc(C.teamName(d, r.id))}</a></td><td class="num"><b>${r.pts}</b></td><td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.dr}</td><td class="num">${r.l}</td><td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${r.gf - r.ga}</td><td class="nowrap">${C.formChips(r.form)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- squadra
  async function team(tid) {
    const lg = tid.split('-')[0]; const L = C.leagueInfo(lg); if (!L) return notFound();
    const season = ui.teamSeason[tid] || L.current;
    const d = await C.season(lg, season);
    if (!d || !d.teams[tid]) {
      const other = []; for (const s of L.seasons) { const dd = await C.season(lg, s); if (dd && dd.teams[tid]) other.push(s); }
      if (other.length && !ui.teamSeason[tid]) { ui.teamSeason[tid] = other[other.length - 1]; return team(tid); }
      return notFound();
    }
    const pl = await C.players(lg, season);
    const name = C.teamName(d, tid);
    const f = ui.teamFilter; const o = {};
    if (f === 'last5') o.last = 5; if (f === 'last10') o.last = 10;
    if (f === 'range') { if (ui.from) o.from = Date.parse(ui.from + 'T00:00:00Z'); if (ui.to) o.to = Date.parse(ui.to + 'T23:59:59Z'); }
    const sets = { tot: C.teamMatches(d, tid, o), home: C.teamMatches(d, tid, Object.assign({ venue: 'home' }, o)), away: C.teamMatches(d, tid, Object.assign({ venue: 'away' }, o)) };
    const lgList = C.leagueList(d);
    const ctx = { players: pl };
    const st = C.standings(d); const pos = st.findIndex(r => r.id === tid) + 1; const row = st.find(r => r.id === tid);
    const cats = [...new Set(C.S.meta.catalogo.map(m => m.cat))];
    const rankOf = m => { if (f !== 'stagione' || m.f.t === 'na') return null;
      const vals = Object.keys(d.teams).map(t => [t, C.agg(m, C.teamMatches(d, t), ctx)]).filter(([, a]) => a.state === 'ok').sort((a, b) => b[1].v - a[1].v);
      const i = vals.findIndex(([t]) => t === tid); return i < 0 ? null : [i + 1, vals.length]; };
    const hidden = [];
    const tables = cats.map(cat => {
      const rows = C.S.meta.catalogo.filter(m => m.cat === cat).map(m => {
        const a = C.agg(m, sets.tot, ctx), h = C.agg(m, sets.home, ctx), w = C.agg(m, sets.away, ctx), l = C.agg(m, lgList, ctx);
        const k = 'tm:' + m.code; const isO = ui.openRows.has(k);
        if (m.f.t === 'na' || (a.n === 0 && h.n === 0 && w.n === 0)) { hidden.push(m.name); return ''; }
        const rk = rankOf(m);
        return `<tr><td><button class="link" data-row="${k}" aria-expanded="${isO}">${isO ? '−' : '+'} ${esc(m.name)}</button><div class="sub">${esc(m.unit)}</div></td><td class="num"><b>${C.show(a, m.agg === 'rate' ? 0 : undefined)}</b>${rk ? ` <span class="rk ${rk[0] <= 3 ? 'top' : rk[0] > rk[1] - 3 ? 'low' : ''}" title="posizione su ${rk[1]} squadre">${rk[0]}ª</span>` : ''}</td><td class="num">${C.show(h, m.agg === 'rate' ? 0 : undefined)}</td><td class="num">${C.show(w, m.agg === 'rate' ? 0 : undefined)}</td><td class="num">${C.show(l, m.agg === 'rate' ? 0 : undefined)}</td><td class="num sub">${a.n}/${h.n}/${w.n}</td></tr>` +
          (isO ? `<tr class="drillrow"><td colspan="6">${drill(a.rows, d, m)}</td></tr>` : '');
      }).join('');
      if (!rows) return '';
      return `<h3>${esc(cat)}</h3><div class="scroll"><table class="tstat"><thead><tr><th>Statistica</th><th class="num">Totale</th><th class="num">Casa</th><th class="num">Trasferta</th><th class="num">Media campionato</th><th class="num">Partite (T/C/F)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    const upcoming = (d.byTeam[tid] || []).filter(m => !m.g).sort((a, b) => a.t - b.t).slice(0, 3);
    const recent = (d.byTeam[tid] || []).filter(m => m.g).sort((a, b) => b.t - a.t).slice(0, 5);
    app.innerHTML = band(`<p class="crumbs"><a href="#giornata-${lg}-${C.scode(season)}-${currentMd(d)}">${esc(L.name)} ${esc(season)}</a></p><h1>${esc(name)}</h1>
      <p class="lead">${pos ? pos + 'ª in classifica · ' + row.pts + ' punti in ' + row.p + ' gare · ' : ''}forma ${C.formChips(row ? row.form : []) || 'nessuna gara giocata'}</p>
      <div class="toolbar"><label class="sel">Stagione <select id="t-s">${L.seasons.slice().reverse().map(s => opt(s, s, season)).join('')}</select></label>
      <div class="seg">${[['stagione', 'Stagione'], ['last5', 'Ultime 5'], ['last10', 'Ultime 10'], ['range', 'Intervallo']].map(([k, t]) => `<button data-tf="${k}" class="${f === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${f === 'range' ? `<label class="sel">Dal <input type="date" id="t-from" value="${ui.from}"></label><label class="sel">Al <input type="date" id="t-to" value="${ui.to}"></label>` : ''}</div>
      <p class="note">Partite nel filtro: ${sets.tot.length} (${sets.home.length} in casa, ${sets.away.length} in trasferta). Ultime 5 e ultime 10 si contano separatamente per casa e trasferta. Media campionato: tutte le squadre, stagione ${esc(season)}. Accanto al totale, la posizione in campionato (1ª = valore più alto; solo con il filtro Stagione). Tocca una statistica per vedere le singole partite. Sono mostrate solo le statistiche registrate dalle fonti per questo campionato; "n.r." (non rilevato) indica una singola partita per cui la fonte non ha il dato.</p>
      <h2>Andamento</h2><div class="fig trend2" id="tchart"></div><p class="note" id="tchart-note"></p>
      <div class="grid2"><div><h3>Ultime partite</h3><div class="mlist">${recent.map(m => matchCard(m, d, null, { date: true })).join('') || '<p class="empty">Nessuna.</p>'}</div></div>
      <div><h3>Prossime partite</h3><div class="mlist">${upcoming.map(m => matchCard(m, d, null, { date: true })).join('') || '<p class="empty">Nessuna in calendario.</p>'}</div></div></div>`) + band(tables + (hidden.length ? `<details><summary>${hidden.length} statistiche non disponibili per ${esc(L.name)} ${esc(season)}</summary><p class="note">Le fonti attive non le registrano per questo campionato: ${hidden.map(esc).join(', ')}.</p></details>` : '')) + band(teamPlayers(pl, d, tid));
    app.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tf) { ui.teamFilter = b.dataset.tf; team(tid); }
      if (b.dataset.row) { ui.openRows.has(b.dataset.row) ? ui.openRows.delete(b.dataset.row) : ui.openRows.add(b.dataset.row); team(tid); }
    };
    document.getElementById('t-s').onchange = e => { ui.teamSeason[tid] = e.target.value; team(tid); };
    const tc = document.getElementById('tchart'); if (tc) teamChart(tc, d, tid, sets.tot);
    const tpm = document.getElementById('tp-metric'); if (tpm) tpm.onchange = e => { ui.tpMetric = e.target.value; team(tid); };
    ['t-from', 't-to'].forEach(id => { const i = document.getElementById(id); if (i) i.onchange = () => { ui[id === 't-from' ? 'from' : 'to'] = i.value; team(tid); }; });
  }
  function teamChart(el, d, tid, list) {
    const ms = list.slice(-20); if (!ms.length) { el.style.display = 'none'; return; }
    const hasXg = ms.some(r => r.m.s.xg && r.m.s.xg[0] != null);
    const draw = () => {
      const W = el.clientWidth, H = el.clientHeight; if (!W) return;
      const pad = { l: 30, r: 10, t: 12, b: 34 }, n = ms.length, bw = (W - pad.l - pad.r) / n;
      const val = r => { const i = r.side === 'H' ? 0 : 1; const xg = r.m.s.xg; return { f: r.m.g[i], a: r.m.g[1 - i], xf: xg ? xg[i] : null, xa: xg ? xg[1 - i] : null }; };
      const vs = ms.map(val); const top = Math.max(3, ...vs.map(v => Math.max(v.f, v.a, v.xf || 0, v.xa || 0)));
      const mid = pad.t + (H - pad.t - pad.b) / 2, sc = (H - pad.t - pad.b) / 2 / top;
      let pts = 0; const line = [];
      const bars = vs.map((v, i) => { const x = pad.l + i * bw; const r = ms[i]; pts += v.f > v.a ? 3 : v.f === v.a ? 1 : 0;
        const opp = C.teamName(d, r.side === 'H' ? r.m.a : r.m.h);
        if (v.xf != null) line.push([x + bw / 2, mid - v.xf * sc, mid + v.xa * sc]);
        return `<g><title>${C.dnum(r.m.ko)} ${r.side === 'H' ? 'vs' : '@'} ${opp}: ${v.f}–${v.a}${v.xf != null ? ` (xG ${nf(v.xf, 2)}–${nf(v.xa, 2)})` : ''}</title>
          <rect x="${x + bw * 0.18}" y="${mid - v.f * sc}" width="${bw * 0.64}" height="${v.f * sc}" class="gf"/><rect x="${x + bw * 0.18}" y="${mid}" width="${bw * 0.64}" height="${v.a * sc}" class="ga"/>
          <circle cx="${x + bw / 2}" cy="${H - 12}" r="${Math.min(6, bw / 3)}" class="${v.f > v.a ? 'rw' : v.f === v.a ? 'rd' : 'rl'}"/></g>`; }).join('');
      el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Gol fatti e subiti partita per partita">
        <line x1="${pad.l}" x2="${W - pad.r}" y1="${mid}" y2="${mid}" class="grid"/>
        ${[1, 2, 3].filter(k => k <= top).map(k => `<text x="${pad.l - 6}" y="${mid - k * sc + 4}" text-anchor="end" class="ax">${k}</text><text x="${pad.l - 6}" y="${mid + k * sc + 4}" text-anchor="end" class="ax">${k}</text>`).join('')}
        ${bars}${line.length > 1 ? `<polyline class="xgl" points="${line.map(p => p[0] + ',' + p[1]).join(' ')}"/><polyline class="xgl a" points="${line.map(p => p[0] + ',' + p[2]).join(' ')}"/>` : ''}</svg>`;
      document.getElementById('tchart-note').textContent = `Ultime ${n} partite del filtro: barre verso l'alto gol fatti, verso il basso gol subiti; pallini: vittoria, pareggio, sconfitta.${hasXg ? ' Linee tratteggiate: xG fatti e concessi (FotMob).' : ''} ${pts} punti in ${n} gare.`;
    };
    draw(); new ResizeObserver(draw).observe(el);
  }
  function drill(rows, d, metric) {
    if (!rows || !rows.length) return '<p class="empty">Nessuna partita.</p>';
    return `<table class="mini"><thead><tr><th>Data</th><th>Avversario</th><th></th><th class="num">Ris.</th><th class="num">${esc(metric.name)}</th></tr></thead><tbody>${rows.slice().reverse().map(({ m, side, v }) =>
      `<tr><td>${C.dnum(m.ko)}</td><td><a href="${C.matchUrl(m)}">${esc(C.teamName(d, side === 'H' ? m.a : m.h))}</a></td><td>${side === 'H' ? 'casa' : 'fuori'}</td><td class="num">${m.g.join('–')}</td><td class="num">${C.cellVal(v)}</td></tr>`).join('')}</tbody></table>`;
  }

  // ---------------------------------------------------------------- arbitri
  async function referees(lg) {
    const meta = C.S.meta; lg = lg || 'pl'; const L = C.leagueInfo(lg);
    const ds = await Promise.all(L.seasons.slice(-2).map(s => C.season(lg, s)));
    const refs = {}; ds.forEach(d => d && Object.assign(refs, d.referees));
    const rows = Object.keys(refs).map(rid => ({ rid, name: refs[rid], st: MatchView.refStats(lg, ds, rid) })).filter(r => r.st.ms.length).sort((a, b) => b.st.ms.length - a.st.ms.length);
    app.innerHTML = band(`<h1>Arbitri</h1><div class="toolbar"><label class="sel">Campionato <select id="r-lg">${meta.campionati.map(c => opt(c.code, c.name, lg)).join('')}</select></label></div>
      <p class="note">Stagioni ${L.seasons.slice(-2).join(' e ')}. Valori per gara diretta.</p>
      ${rows.length ? `<div class="scroll"><table><thead><tr><th>Arbitro</th><th class="num">Gare</th><th class="num">Falli</th><th class="num">Gialli</th><th class="num">Rossi</th><th class="num">Cartellini</th></tr></thead><tbody>${rows.map(r =>
        `<tr><td><a href="#arbitro-${r.rid}">${esc(r.name)}</a></td><td class="num">${r.st.ms.length}</td>${r.st.rows.map(x => `<td class="num">${nf(x.r[0], 2)}</td>`).join('')}</tr>`).join('')}
        <tr class="avg"><td>Media campionato</td><td></td>${rows[0].st.rows.map(x => `<td class="num">${nf(x.l[0], 2)}</td>`).join('')}</tr></tbody></table></div>`
        : `<p class="empty">Le fonti attive non forniscono gli arbitri per ${esc(L.name)}. Attiva football-data.org (chiave gratuita) per importare le designazioni: vedi <a href="#fonti">Fonti</a>.</p>`}`);
    document.getElementById('r-lg').onchange = e => { location.hash = 'arbitri-' + e.target.value; };
  }
  async function referee(rid) {
    const meta = C.S.meta;
    for (const L of meta.campionati) {
      const ds = await Promise.all(L.seasons.slice(-2).map(s => C.season(L.code, s)));
      if (!ds.some(d => d && d.referees[rid])) continue;
      const st = MatchView.refStats(L.code, ds, rid); const name = ds.map(d => d && d.referees[rid]).find(Boolean);
      const up = []; ds.forEach(d => d && d.matches.forEach(m => { if (m.r === rid && !m.g) up.push([m, d]); }));
      const list = st.ms.slice().sort((a, b) => b.t - a.t);
      const dOf = m => ds.find(d => d && d.byId[m.i]);
      app.innerHTML = band(`<p class="crumbs"><a href="#arbitri-${L.code}">Arbitri ${esc(L.name)}</a></p><h1>${esc(name)}</h1>
        ${up.length ? `<h2>Prossime designazioni</h2><div class="mlist">${up.map(([m, d]) => matchCard(m, d, null, { date: true })).join('')}</div>` : ''}
        <h2>Statistiche (${list.length} gare dirette)</h2>${MatchView.refTable(st)}
        <h2>Gare arbitrate</h2><div class="scroll"><table class="mini"><thead><tr><th>Data</th><th>Partita</th><th class="num">Ris.</th><th class="num">Falli</th><th class="num">Gialli</th><th class="num">Rossi</th></tr></thead><tbody>${list.map(m => {
          const d = dOf(m); const s = (k) => m.s[k] ? m.s[k].join('–') : '<span class="miss" title="non rilevato dalla fonte">n.r.</span>';
          return `<tr><td>${C.dnum(m.ko)}</td><td><a href="${C.matchUrl(m)}">${esc(C.teamName(d, m.h))} – ${esc(C.teamName(d, m.a))}</a></td><td class="num">${m.g.join('–')}</td><td class="num">${s('falli')}</td><td class="num">${s('gialli')}</td><td class="num">${s('rossi')}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="note">Valori casa–ospite. Nell'analisi disciplinare il peso dell'arbitro è prudente: con poche gare dirette la stima resta vicina alla media del campionato.</p>`);
      return;
    }
    notFound();
  }

  // ---------------------------------------------------------------- giocatori
  async function playerSets() {
    const meta = C.S.meta; const sets = [];
    for (const L of meta.campionati) for (const s of L.seasons.slice().reverse()) { const pd = await C.players(L.code, s); if (pd) { sets.push({ L, s, pd, d: await C.season(L.code, s) }); break; } }
    return sets;
  }
  function metricSelect(id, cur, M) {
    const cats = [...new Set(M.map(x => x.cat))];
    return `<select id="${id}">${cats.map(c => `<optgroup label="${esc(c)}">${M.filter(x => x.cat === c).map(x => opt(x.code, x.name, cur)).join('')}</optgroup>`).join('')}</select>`;
  }
  function pctRank(list, o, code, mode) {
    const vals = list.map(x => C.pVal(x, code, mode)).filter(x => x && !x.nonapp).map(x => x.v).sort((a, b) => a - b);
    const me = C.pVal(o, code, mode); if (!me || me.nonapp || vals.length < 10) return null;
    let k = 0; while (k < vals.length && vals[k] <= me.v) k++; return Math.round(k / vals.length * 100);
  }
  async function playersPage(pid) {
    const meta = C.S.meta; const sets = await playerSets(); const M = C.pMetricMeta();
    const noData = meta.campionati.filter(L => !sets.find(x => x.L.code === L.code)).map(L => L.name);
    if (!sets.length) {
      app.innerHTML = band(`<h1>Giocatori</h1><p class="warn">Nessuna fonte di dati individuali è attiva.</p><p>Vedi <a href="#fonti">Fonti</a> per attivarla.</p>`);
      return;
    }
    if (pid) return playerDetail(pid, sets, M);
    const cur = sets.find(x => x.L.code === ui.plLg) || sets[0]; ui.plLg = cur.L.code;
    const all = C.pAgg(cur.pd);
    const MA = C.pMetricMeta(cur.pd); const asked = ui.plMetric;
    const metric = C.pPick(cur.pd, asked, 'tiri_porta'); ui.plMetric = metric;
    const swapped = asked && asked !== metric ? (M.find(x => x.code === asked) || {}).name : null;
    const mm = M.find(x => x.code === metric);
    const modes = mm.kind === 'sum' ? (mm.per90 ? [['p90', 'Per 90 minuti'], ['pm', 'Per partita'], ['tot', 'Totale'], ['l5', 'Media ultime 5']] : [['tot', 'Totale'], ['pm', 'Per partita'], ['l5', 'Media ultime 5']]) : [['tot', 'Stagione'], ['l5', 'Ultime 5']];
    const mode = modes.some(z => z[0] === ui.plMode) ? ui.plMode : modes[0][0];
    const missing = C.pMissing(cur.pd);
    const roles = [...new Set(all.map(o => o.role))].sort();
    const perMatch = (o, code) => { const t = o.tot[code]; return t == null || !o.nK[code] ? null : { v: t / o.nK[code] }; };
    const valOf = (o, code, md) => md === 'pm' ? perMatch(o, code) : C.pVal(o, code, md);
    const teams = [...new Set(all.map(o => o.tid))].sort((a, b) => C.teamName(cur.d, a).localeCompare(C.teamName(cur.d, b)));
    const list = all.filter(o => (!ui.plRole || o.role === ui.plRole) && (!ui.plTeam || o.tid === ui.plTeam) && o.min >= ui.plMin)
      .map(o => ({ o, x: valOf(o, metric, mode) })).filter(r => r.x && !r.x.nonapp).sort((a, b) => b.x.v - a.x.v).slice(0, 100);
    const ctxCols = MA.filter(x => x.cat === mm.cat && x.code !== metric && x.kind === 'sum' && x.code !== 'titolare').slice(0, 2);
    const pool = all.filter(o => (!ui.plRole || o.role === ui.plRole) && o.min >= ui.plMin);
    const avgOf = (code, md) => { const v = pool.map(o => valOf(o, code, md)).filter(z => z && !z.nonapp).map(z => z.v); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const avgPM = (() => { if (mm.kind !== 'sum') return null; const v = pool.map(o => perMatch(o, metric)).filter(Boolean).map(z => z.v); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
    const cmp = all.filter(o => ui.plCmp.includes(o.pid));
    const cmpRoles = new Set(cmp.map(o => o.role));
    app.innerHTML = band(`<h1>Giocatori</h1><p class="lead">${esc(cur.L.name)} ${esc(cur.s)} · fonte: ${esc(cur.pd.fonte)} · ${all.length} giocatori</p>
      ${noData.length ? `<p class="info">Dati individuali non disponibili per ${esc(noData.join(', '))} (vedi <a href="#fonti">Fonti</a>).</p>` : ''}
      <div class="toolbar"><label class="sel">Campionato <select id="p-lg">${sets.map(x => opt(x.L.code, x.L.name, cur.L.code)).join('')}</select></label>
      <label class="sel">Statistica ${metricSelect('p-metric', metric, MA)}</label>
      <div class="seg" role="group" aria-label="Ordina per">${modes.map(([k, t]) => `<button data-pmode="${k}" class="${mode === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <label class="sel">Squadra <select id="p-team">${opt('', 'Tutte', ui.plTeam)}${teams.map(t => opt(t, C.teamName(cur.d, t), ui.plTeam)).join('')}</select></label>
      <label class="sel">Ruolo <select id="p-role">${opt('', 'Tutti', ui.plRole)}${roles.map(r => opt(r, r, ui.plRole)).join('')}</select></label>
      <label class="sel">Minuti minimi <input type="number" id="p-min" min="0" step="90" value="${ui.plMin}"></label></div>
      ${cmp.length ? `<h2>Confronto</h2>${cmpRoles.size > 1 ? '<p class="warn">Stai confrontando ruoli diversi: i valori non sono direttamente comparabili.</p>' : ''}<div class="scroll"><table><thead><tr><th>Statistica</th>${cmp.map(o => `<th class="num"><a href="#giocatore-${o.pid}">${esc(o.name)}</a><div class="sub">${esc(o.role)} · ${o.min}'</div></th>`).join('')}</tr></thead><tbody>${
        MA.filter(x => x.kind === 'ratio' || x.per90).map(x => `<tr><td>${esc(x.name)}${x.kind === 'sum' ? ' <span class="sub">/90</span>' : ''}</td>${cmp.map(o => `<td class="num">${C.pShow(C.pVal(o, x.code, 'p90'))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p><button class="btn" data-clearcmp="1">Svuota confronto</button></p>` : ''}
      ${swapped ? `<p class="warn">"${esc(swapped)}" non è disponibile per ${esc(cur.L.name)} ${esc(cur.s)}: la fonte non lo registra. Ti mostro la statistica più vicina, "${esc(mm.name)}".</p>` : ''}
      <h2>${esc(mm.name)}</h2>
      <div class="kpis"><div class="kpi hi"><b>${avgOf(metric, mode) == null ? 'n.d.' : C.pShow({ v: avgOf(metric, mode), pct: mm.kind === 'ratio' }, 2)}</b><span>media del campionato ${{ p90: 'per 90 minuti', pm: 'per partita giocata', l5: 'nelle ultime 5 presenze', tot: mm.kind === 'ratio' ? 'in stagione' : 'in stagione (totale)' }[mode]}</span><i>${pool.length} giocatori${ui.plRole ? ' · ' + esc(ui.plRole) : ''} con almeno ${ui.plMin}'</i></div>
      ${avgPM != null && mode !== 'pm' ? `<div class="kpi"><b>${nf(avgPM, 2)}</b><span>media per partita giocata</span><i>stessi giocatori</i></div>` : ''}
      ${mode !== 'l5' && avgOf(metric, 'l5') != null ? `<div class="kpi"><b>${C.pShow({ v: avgOf(metric, 'l5'), pct: mm.kind === 'ratio' }, 2)}</b><span>media nelle ultime 5 presenze</span><i>stessi giocatori</i></div>` : ''}</div>
      <p class="note">Per ogni giocatore: totale stagionale, media per partita giocata, valore ogni 90 minuti e media delle ultime 5 presenze (tra parentesi quante, se meno di 5). Ordina con i pulsanti qui sopra. Spunta fino a 3 giocatori per confrontarli.</p>
      <div class="scroll"><table class="ptab"><thead><tr><th></th><th>#</th><th>Giocatore</th><th>Squadra</th><th class="num">Pres.</th><th class="num">Min</th>${mm.kind === 'sum' ? `<th class="num">Totale</th><th class="num">Per partita</th>${mm.per90 ? "<th class='num'>Per 90'</th>" : ''}` : `<th class="num">${esc(mm.name)}</th>`}<th class="num">Ultime 5</th>${ctxCols.map(c => `<th class="num">${esc(c.name)}${c.per90 ? '/90' : ''}</th>`).join('')}</tr></thead><tbody>${list.map((r, i) =>
        `<tr><td><input type="checkbox" data-cmp="${r.o.pid}" ${ui.plCmp.includes(r.o.pid) ? 'checked' : ''} aria-label="Confronta ${esc(r.o.name)}"></td><td>${i + 1}</td><td><a href="#giocatore-${r.o.pid}">${esc(r.o.name)}</a><div class="sub">${esc(r.o.role)}</div></td><td>${esc(C.teamName(cur.d, r.o.tid))}</td><td class="num">${r.o.app}</td><td class="num">${r.o.min}</td>${mm.kind === 'sum' ? `<td class="num${mode === 'tot' ? ' hl' : ''}">${C.pShow(C.pVal(r.o, metric, 'tot'))}</td><td class="num${mode === 'pm' ? ' hl' : ''}">${C.pShow(perMatch(r.o, metric), 2)}</td>${mm.per90 ? `<td class="num${mode === 'p90' ? ' hl' : ''}">${C.pShow(C.pVal(r.o, metric, 'p90'), 2)}</td>` : ''}` : `<td class="num${mode === 'tot' ? ' hl' : ''}">${C.pShow(C.pVal(r.o, metric, 'tot'))}</td>`}<td class="num${mode === 'l5' ? ' hl' : ''}">${C.pShowL(C.pLast(r.o, metric))}</td>${ctxCols.map(c => `<td class="num">${c.per90 ? C.pShow(C.pVal(r.o, c.code, 'p90'), 2) : C.pShow(C.pVal(r.o, c.code, 'tot'))}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="10" class="empty">Nessun giocatore con questo filtro.</td></tr>'}</tbody></table></div>
      ${missing.length ? `<p class="note"><b>Non registrate dalla fonte per ${esc(cur.L.name)} ${esc(cur.s)}:</b> ${missing.map(esc).join(', ')}. Fonte attuale: ${esc(cur.pd.fonte)}.</p>` : ''}`);
    const rerun = () => playersPage();
    document.getElementById('p-lg').onchange = e => { ui.plLg = e.target.value; ui.plTeam = ''; rerun(); };
    document.getElementById('p-metric').onchange = e => { ui.plMetric = e.target.value; rerun(); };
    document.getElementById('p-team').onchange = e => { ui.plTeam = e.target.value; rerun(); };
    document.getElementById('p-role').onchange = e => { ui.plRole = e.target.value; rerun(); };
    document.getElementById('p-min').onchange = e => { ui.plMin = +e.target.value || 0; rerun(); };
    app.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.pmode) { ui.plMode = b.dataset.pmode; rerun(); } if (b.dataset.clearcmp) { ui.plCmp = []; rerun(); } };
    app.onchange = e => { const c = e.target.dataset && e.target.dataset.cmp; if (!c) return; ui.plCmp = e.target.checked ? ui.plCmp.concat(c).slice(-3) : ui.plCmp.filter(x => x !== c); rerun(); };
  }
  async function playerDetail(pid, sets, M0) {
    let M = M0;
    let found = null;
    for (const x of sets) { const all = C.pAgg(x.pd); const o = all.find(z => z.pid === pid); if (o) { found = { x, o, all }; break; } }
    if (!found) return notFound();
    const { x, o, all } = found; const peers = all.filter(z => z.role === o.role && z.min >= 450);
    const MA = C.pMetricMeta(x.pd); const metric = C.pPick(x.pd, ui.pdMetric, 'tiri'); M = MA;
    const cats = [...new Set(MA.map(z => z.cat))];
    const ms = o.ms.map(r => ({ r, m: x.d.byId[r.mid] })).filter(z => z.m).sort((a, b) => b.m.t - a.m.t);
    app.innerHTML = band(`<p class="crumbs"><a href="#giocatori">Giocatori</a> · ${esc(x.L.name)} ${esc(x.s)}</p><h1>${esc(o.name)}</h1>
      <p class="lead"><a href="${C.teamUrl(o.tid)}">${esc(C.teamName(x.d, o.tid))}</a> · ${esc(o.role)} · ${o.app} presenze, ${o.starts} da titolare, ${o.min} minuti</p>
      <p class="note">Ultime 5: media per partita nelle ultime 5 presenze (tra parentesi quante, se meno di 5). Media ruolo e percentile: confronto con i ${peers.length} giocatori dello stesso ruolo con almeno 450 minuti in ${esc(x.L.name)} (media ruolo per 90 minuti; percentile 100 = valore più alto). Fonte: ${esc(x.pd.fonte)}.</p>`) +
      band(cats.map(c => { const rows = M.filter(z => z.cat === c).map(z => {
        const tv = C.pVal(o, z.code, 'tot'); if (!tv) return '';
        const md = z.kind === 'sum' && z.per90 ? 'p90' : 'tot';
        const pv = md === 'p90' ? C.pVal(o, z.code, 'p90') : null; const pr = pctRank(peers, o, z.code, md);
        const pm = z.kind === 'sum' && o.nK[z.code] ? o.tot[z.code] / o.nK[z.code] : null;
        const pvals = peers.map(q => C.pVal(q, z.code, md)).filter(q => q && !q.nonapp).map(q => q.v); const ravg = pvals.length ? pvals.reduce((a, b) => a + b, 0) / pvals.length : null;
        return `<tr><td>${esc(z.name)}</td><td class="num">${C.pShow(tv)}</td><td class="num">${pm == null ? '<span class="nd">n/a</span>' : nf(pm, 2)}</td><td class="num">${pv ? `<b>${C.pShow(pv, 2)}</b>` : '<span class="nd">n/a</span>'}</td><td class="num">${C.pShowL(C.pLast(o, z.code))}</td><td class="num">${ravg == null ? '<span class="nd" title="dato non disponibile">n.d.</span>' : z.kind === 'ratio' ? nf(ravg, 0) + '%' : nf(ravg, 2)}</td><td class="num">${pr == null ? '<span class="nd" title="dato non disponibile">n.d.</span>' : `<span class="pbar"><i style="width:${pr}%"></i></span> ${pr}`}</td></tr>`; }).join('');
        return rows ? `<h3>${esc(c)}</h3><div class="scroll"><table><thead><tr><th>Statistica</th><th class="num">Totale</th><th class="num">Per partita</th><th class="num">Per 90'</th><th class="num">Ultime 5</th><th class="num">Media ruolo</th><th class="num">Percentile</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''; }).join('') +
        (C.pMissing(x.pd).length ? `<p class="note"><b>Non registrate dalla fonte per ${esc(x.L.name)}:</b> ${C.pMissing(x.pd).map(esc).join(', ')}.</p>` : '')) +
      band(playerThresholds(o, x.d)) +
      band(`<h2>Partita per partita</h2><div class="toolbar"><label class="sel">Statistica ${metricSelect('pd-metric', metric, M.filter(z => z.kind === 'sum'))}</label></div>
      ${playerBars(ms, metric)}
      <div class="scroll"><table class="mini"><thead><tr><th>Data</th><th>Partita</th><th class="num">Min</th><th class="num">${esc((M.find(z => z.code === metric) || {}).name || metric)}</th></tr></thead><tbody>${ms.map(({ r, m }) =>
        `<tr><td>${C.dnum(m.ko)}</td><td><a href="${C.matchUrl(m)}">${esc(C.teamName(x.d, m.h))} – ${esc(C.teamName(x.d, m.a))}</a> <span class="sub">${m.g ? m.g.join('–') : ''}</span></td><td class="num">${r.v.minuti || 0}</td><td class="num">${r.v.minuti ? C.cellVal(r.v[metric] == null ? null : r.v[metric]) : '<span class="nd">non entrato</span>'}</td></tr>`).join('')}</tbody></table></div>`);
    document.getElementById('pd-metric').onchange = e => { ui.pdMetric = e.target.value; playerDetail(pid, sets, M); };
  }
  const THR = [['tiri', 'Tiri'], ['tiri_porta', 'Tiri in porta'], ['falli_commessi', 'Falli commessi'], ['falli_subiti', 'Falli subiti'], ['contrasti_vinti', 'Contrasti vinti'], ['contrasti', 'Contrasti tentati'], ['dribbling_riusciti', 'Dribbling riusciti'], ['passaggi_chiave', 'Passaggi chiave'], ['recuperi', 'Recuperi'], ['gialli', 'Ammonizioni']];
  function playerThresholds(o, d) {
    const chron = o.ms.filter(r => d.byId[r.mid]).sort((a, b) => d.byId[a.mid].t - d.byId[b.mid].t);
    const rows = THR.map(([k, n]) => {
      if (!chron.some(r => r.v.minuti > 0 && r.v[k] != null)) return '';
      const vals = chron.filter(r => r.v.minuti > 0 && r.v[k] != null).map(r => r.v[k]); if (!vals.length) return '';
      const fr = t => { const y = vals.filter(v => v >= t).length; return `${pc(y / vals.length)} <span class="sub">${y}/${vals.length}</span>`; };
      const last5 = chron.filter(r => r.v.minuti > 0 && r.v[k] != null).slice(-5).map(r => r.v[k]).join(' · ');
      return `<tr><td>${n}</td><td class="num">${fr(1)}</td><td class="num">${fr(2)}</td><td class="num">${fr(3)}</td><td class="num sub">${last5}</td></tr>`;
    }).join('');
    return rows ? `<h2>Con che frequenza</h2><p class="note">Percentuale delle partite giocate in cui il giocatore ha raggiunto la soglia; a destra i valori delle ultime 5 presenze (dalla meno recente).</p>
      <div class="scroll"><table><thead><tr><th>Statistica</th><th class="num">≥1</th><th class="num">≥2</th><th class="num">≥3</th><th class="num">Ultime 5</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  }
  function playerBars(ms, metric) {
    const list = ms.slice().reverse().filter(z => z.r.v.minuti > 0); if (!list.length) return '';
    const vals = list.map(z => z.r.v[metric]); const mx = Math.max(1, ...vals.filter(v => v != null));
    return `<div class="pbars" role="img" aria-label="Valore per partita">${list.map((z, i) => `<div class="pb" title="${C.dnum(z.m.ko)}: ${vals[i] == null ? 'dato mancante' : vals[i]}"><i style="height:${vals[i] == null ? 0 : (vals[i] / mx * 100).toFixed(0)}%" class="${vals[i] == null ? 'na' : ''}"></i><span>${vals[i] == null ? '–' : vals[i]}</span></div>`).join('')}</div><p class="note">Una barra per partita giocata, dalla prima all'ultima.</p>`;
  }
  function teamPlayers(pd, d, tid) {
    if (!pd) return `<h2>Giocatori</h2><p class="empty">Dati individuali non disponibili per questo campionato con le fonti attive (vedi <a href="#fonti">Fonti</a>).</p>`;
    const M = C.pMetricMeta(pd); const metric = C.pPick(pd, ui.tpMetric, 'tiri_porta'); const mm = M.find(x => x.code === metric);
    const all = C.pAgg(pd, { tid }).filter(o => o.min > 0).map(o => ({ o, x: C.pVal(o, metric, 'p90'), t: C.pVal(o, metric, 'tot') }));
    const list = all.filter(r => r.t).sort((a, b) => ((b.x && !b.x.nonapp) ? b.x.v : -1) - ((a.x && !a.x.nonapp) ? a.x.v : -1) || (b.t.v || 0) - (a.t.v || 0));
    const nr = all.filter(r => !r.t).map(r => r.o.name + (r.o.role ? ' (' + r.o.role.toLowerCase() + ')' : ''));
    return `<h2>Giocatori della squadra</h2><div class="toolbar"><label class="sel">Statistica ${metricSelect('tp-metric', metric, M)}</label></div>
      <div class="scroll"><table><thead><tr><th>Giocatore</th><th>Ruolo</th><th class="num">Pres.</th><th class="num">Tit.</th><th class="num">Min</th><th class="num">${esc(mm.name)} totale</th>${mm.kind === 'sum' ? '<th class="num">Per partita</th>' : ''}${mm.kind === 'sum' && mm.per90 ? '<th class="num">Per 90\'</th>' : ''}<th class="num">Ultime 5</th></tr></thead><tbody>${list.map(({ o, x, t }) =>
        `<tr><td><a href="#giocatore-${o.pid}">${esc(o.name)}</a></td><td>${esc(o.role)}</td><td class="num">${o.app}</td><td class="num">${o.starts}</td><td class="num">${o.min}</td><td class="num">${C.pShow(t)}</td>${mm.kind === 'sum' ? `<td class="num">${o.nK[metric] ? nf(o.tot[metric] / o.nK[metric], 2) : '<span class="nd">n/a</span>'}</td>` : ''}${mm.kind === 'sum' && mm.per90 ? `<td class="num"><b>${C.pShow(x, 2)}</b></td>` : ''}<td class="num">${C.pShowL(C.pLast(o, metric))}</td></tr>`).join('')}</tbody></table></div><p class="note">Fonte: ${esc(pd.fonte)}. Giocatori ordinati per valore per 90 minuti.${nr.length ? ' ' + esc(mm.name) + ' non rilevato dalla fonte per: ' + nr.map(esc).join(', ') + '.' : ''}${C.pMissing(pd).length ? ' Non registrate dalla fonte: ' + C.pMissing(pd).map(esc).join(', ') + '.' : ''}</p>`;
  }

  // ---------------------------------------------------------------- indice statistiche
  async function statsIndex() {
    const meta = C.S.meta; const lg = ui.statLg || 'sa'; const L = C.leagueInfo(lg);
    const season = ui.statSeason && L.seasons.includes(ui.statSeason) ? ui.statSeason : L.seasons[L.seasons.length - 2] || L.current;
    const d = await C.season(lg, season); const pl = await C.players(lg, season);
    const cov = ((meta.copertura[lg] || {})[season]) || { metriche: {}, giocate: 0 };
    const q = ui.statQ.trim().toLowerCase(); const scope = ui.statScope;
    let body = '';
    if (scope === 'squadre') {
      const team = ui.statTeam && d.teams[ui.statTeam] ? ui.statTeam : '';
      const list = meta.catalogo.filter(m => (!ui.statCat || m.cat === ui.statCat) && (!q || (m.name + ' ' + m.def + ' ' + m.cat).toLowerCase().includes(q)));
      const lgList = C.leagueList(d); const tl = team ? C.teamMatches(d, team) : null;
      const cats = [...new Set(list.map(m => m.cat))];
      body = cats.map(cat => `<h2>${esc(cat)}</h2><div class="statgrid">${list.filter(m => m.cat === cat).map(m => {
        const a = C.agg(m, tl || lgList, { players: pl }); const avail = a.state !== 'na' && a.n > 0;
        const covTxt = m.f.t === 'na' ? 'nessuna fonte attiva la fornisce' : a.n ? `${a.n} osservazioni` : 'la fonte non la registra per questa stagione';
        return `<a class="stat ${avail ? '' : 'off'}" href="#stat-${m.code}"><b>${esc(m.name)}</b>${avail ? `<span class="v">${C.show(a, m.agg === 'rate' ? 0 : undefined)}<i>${esc(m.unit)}</i></span>` : `<span class="v nd">${m.f.t === 'na' ? 'non disponibile' : 'non rilevata'}</span>`}<span class="sub">${team ? esc(C.teamName(d, team)) : 'media campionato'} · ${covTxt}</span><span class="src">Fonte: ${esc(m.src)}</span></a>`;
      }).join('')}</div>`).join('') || '<p class="empty">Nessuna statistica corrisponde alla ricerca.</p>';
    } else if (scope === 'giocatori') {
      const M = C.pMetricMeta(); const cats = [...new Set(M.map(x => x.cat))];
      const n = k => { if (!pl) return 0; let c = 0; Object.values(pl.byPlayer).forEach(l => l.forEach(r => { if (r.v.minuti && r.v[k] != null) c++; })); return c; };
      body = (pl ? '' : `<p class="info">Per ${esc(L.name)} ${esc(season)} non ci sono dati individuali con le fonti attive. Le voci restano visibili per sapere cosa si può ottenere attivando API-Football.</p>`) +
        cats.map(c => `<h2>${esc(c)}</h2><div class="statgrid">${M.filter(x => x.cat === c && (!q || x.name.toLowerCase().includes(q))).map(x => {
          const k = x.kind === 'ratio' ? x.num : x.code; const obs = n(k);
          return `<a class="stat ${obs ? '' : 'off'}" href="#giocatori" data-plmetric="${x.code}" data-pllg="${lg}"><b>${esc(x.name)}</b><span class="sub">${x.kind === 'ratio' ? 'percentuale sul totale dei tentativi' : x.per90 ? 'totale e per 90 minuti' : 'totale'} · ${obs} osservazioni</span><span class="src">Fonte: ${pl ? esc(pl.fonte) : 'non attiva per questo campionato'}</span></a>`; }).join('')}</div>`).join('') +
        `<div class="statgrid">${C.S.meta.metriche_giocatore_na.map(x => `<div class="stat off"><b>${esc(x.name)}</b><span class="sub">${esc(x.nota)}</span></div>`).join('')}</div>`;
    } else {
      const has = d.matches.some(m => m.r);
      body = `<div class="statgrid">${meta.metriche_arbitro.filter(m => !q || m.name.toLowerCase().includes(q)).map(m => `<a class="stat ${has ? '' : 'off'}" href="#arbitri-${lg}"><b>${esc(m.name)}</b><span class="sub">totale e per gara, confronto con la media del campionato</span><span class="src">${has ? 'Fonte: ' + (lg === 'pl' ? 'football-data.co.uk' : 'football-data.org') : 'Arbitri non forniti dalle fonti attive per questo campionato'}</span></a>`).join('')}</div>`;
    }
    app.innerHTML = band(`<h1>Indice statistiche</h1><p class="lead">Ogni voce apre una scheda con definizione, unità, fonte, copertura, numero di osservazioni, andamento e partite di origine.</p>
      <div class="toolbar"><label class="sel grow">Cerca <input type="search" id="s-q" value="${esc(ui.statQ)}" placeholder="es. corner, tiri, cartellini"></label>
      <label class="sel">Ambito <select id="s-scope">${[['squadre', 'Squadre'], ['giocatori', 'Giocatori'], ['arbitri', 'Arbitri']].map(([k, t]) => opt(k, t, scope)).join('')}</select></label>
      <label class="sel">Campionato <select id="s-lg">${meta.campionati.map(c => opt(c.code, c.name, lg)).join('')}</select></label>
      <label class="sel">Stagione <select id="s-season">${L.seasons.slice().reverse().map(s => opt(s, s, season)).join('')}</select></label>
      ${scope === 'squadre' ? `<label class="sel">Squadra <select id="s-team">${opt('', 'Tutte (media)', ui.statTeam)}${Object.entries(d.teams).sort((a, b) => a[1][1].localeCompare(b[1][1])).map(([id, n]) => opt(id, n[1], ui.statTeam)).join('')}</select></label>
      <label class="sel">Categoria <select id="s-cat">${opt('', 'Tutte', ui.statCat)}${[...new Set(meta.catalogo.map(m => m.cat))].map(c => opt(c, c, ui.statCat)).join('')}</select></label>` : ''}</div>
      <p class="note">${cov.giocate} partite giocate in ${esc(L.name)} ${esc(season)}. Le voci in grigio non sono fornite dalle fonti attive o non hanno dati per questa stagione.</p>${body}`);
    const bind = (id, k, num) => { const e = document.getElementById(id); if (e) e[e.type === 'search' ? 'oninput' : 'onchange'] = () => { ui[k] = e.value; if (k === 'statLg') { ui.statTeam = ''; } statsIndex().then(() => { if (id === 's-q') { const n = document.getElementById('s-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }; };
    app.onclick = e => { const t = e.target.closest('[data-plmetric]'); if (t) { ui.plMetric = t.dataset.plmetric; ui.plLg = t.dataset.pllg; } };
    bind('s-q', 'statQ'); bind('s-scope', 'statScope'); bind('s-lg', 'statLg'); bind('s-season', 'statSeason'); bind('s-team', 'statTeam'); bind('s-cat', 'statCat');
  }

  async function statPage(code) {
    const meta = C.S.meta; const m = C.metricByCode(code); if (!m) return notFound();
    const lg = ui.statLg || 'sa'; const L = C.leagueInfo(lg);
    const season = ui.statSeason && L.seasons.includes(ui.statSeason) ? ui.statSeason : L.seasons[L.seasons.length - 2] || L.current;
    const d = await C.season(lg, season); const pl = await C.players(lg, season); const ctx = { players: pl };
    const covRows = [];
    for (const LL of meta.campionati) for (const s of LL.seasons) {
      const dd = await C.season(LL.code, s); if (!dd) continue;
      const a = C.agg(m, C.leagueList(dd), { players: await C.players(LL.code, s) });
      const pm = dd.matches.filter(C.played).length;
      covRows.push([LL.name, s, pm, a.state === 'na' ? null : a.n / 2, a]);
    }
    const all = C.leagueList(d); const a = C.agg(m, all, ctx);
    const teams = Object.keys(d.teams).map(tid => {
      const t = C.agg(m, C.teamMatches(d, tid), ctx), h = C.agg(m, C.teamMatches(d, tid, { venue: 'home' }), ctx), w = C.agg(m, C.teamMatches(d, tid, { venue: 'away' }), ctx);
      return { tid, t, h, w };
    }).filter(r => r.t.state === 'ok' || r.t.state === 'nonapp').sort((x, y) => (y.t.v || 0) - (x.t.v || 0));
    // distribuzione (metriche di conteggio)
    let distHtml = '';
    const vals = (a.rows || []).map(r => r.v).filter(v => typeof v === 'number');
    if (m.agg === 'mean' && vals.length && vals.every(v => Number.isInteger(v))) {
      const s = vals.slice().sort((x, y) => x - y); const med = s[Math.floor(s.length / 2)];
      const mx = s[s.length - 1]; const cnt = new Array(mx + 1).fill(0); s.forEach(v => cnt[v]++);
      const big = Math.max(...cnt);
      const thr = []; for (let k = Math.max(1, Math.floor(a.v) - 3); k <= Math.ceil(a.v) + 4; k++) thr.push(k);
      distHtml = `<h2>Distribuzione</h2><p>Media <b>${nf(a.v, 2)}</b> · mediana <b>${med}</b> · ${s.length} osservazioni ${m.f.s === 'total' ? '(una per partita, contata due volte: una per squadra)' : '(una per squadra per partita)'}</p>
        <div class="pmf">${cnt.map((c, k) => `<div class="bar in" title="${k}: ${c} volte"><i style="height:${(c / big * 100).toFixed(1)}%"></i><span>${k}</span></div>`).join('')}</div>
        <h3>Frequenza delle soglie</h3><div class="scroll"><table><thead><tr><th>Soglia</th><th class="num">Frequenza</th></tr></thead><tbody>${thr.map(k => { const y = s.filter(v => v >= k).length; return `<tr><td>Almeno ${k}</td><td class="num">${pc(y / s.length)} <span class="sub">${y}/${s.length}</span></td></tr>`; }).join('')}</tbody></table></div>`;
    }
    // andamento per giornata
    const byMd = {};
    (a.rows || []).forEach(r => { if (r.v == null || r.v === C.NA) return; const k = r.m.mo || r.m.md; (byMd[k] = byMd[k] || []).push(r.v); });
    const series = Object.keys(byMd).map(Number).sort((x, y) => x - y).map(k => { const v = byMd[k]; const num = Array.isArray(v[0]) ? v.reduce((s, x) => s + x[0], 0) / Math.max(1, v.reduce((s, x) => s + x[1], 0)) * (m.f.pct ? 100 : 1) : v.reduce((s, x) => s + x, 0) / v.length * (m.agg === 'rate' ? 100 : 1); return [k, num]; });
    app.innerHTML = band(`<p class="crumbs"><a href="#statistiche">Indice statistiche</a> · ${esc(m.cat)}</p><h1>${esc(m.name)}</h1>
      <dl class="def"><dt>Definizione</dt><dd>${esc(m.def)}</dd><dt>Unità</dt><dd>${esc(m.unit)} (${m.agg === 'rate' ? 'percentuale di partite' : m.agg === 'ratio' ? 'rapporto tra i totali' : 'media per partita'})</dd><dt>Fonte</dt><dd>${esc(m.src)}</dd>
      ${m.model ? `<dt>Nel modello</dt><dd>Sì: stima per squadra e per partita (<a href="#metodo">metodo</a>).</dd>` : ''}</dl>
      <div class="toolbar"><label class="sel">Campionato <select id="st-lg">${meta.campionati.map(c => opt(c.code, c.name, lg)).join('')}</select></label><label class="sel">Stagione <select id="st-s">${L.seasons.slice().reverse().map(s => opt(s, s, season)).join('')}</select></label></div>
      ${m.f.t === 'na' ? '<p class="warn">Statistica non disponibile con le fonti attive.</p>' : `<p class="lead">${esc(L.name)} ${esc(season)}: <b>${C.show(a, m.agg === 'rate' ? 0 : 2)}</b> ${esc(m.unit)} su ${a.n} osservazioni.</p>`}`) +
      (m.f.t === 'na' ? '' : band(`${series.length > 1 ? `<h2>Andamento per giornata</h2><div class="fig" id="trend"></div><p class="note" id="trend-note"></p>` : ''}${distHtml}
      <h2>Squadre</h2><div class="scroll"><table><thead><tr><th>Squadra</th><th class="num">Totale</th><th class="num">Casa</th><th class="num">Trasferta</th><th class="num">Partite</th></tr></thead><tbody>${teams.map(r =>
        `<tr><td><a href="${C.teamUrl(r.tid)}" data-open-metric="${code}">${esc(C.teamName(d, r.tid))}</a></td><td class="num"><b>${C.show(r.t, 2)}</b></td><td class="num">${C.show(r.h, 2)}</td><td class="num">${C.show(r.w, 2)}</td><td class="num">${r.t.n}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Tocca una squadra per aprire la sua scheda con l'elenco delle partite da cui deriva il valore.</p>`)) +
      band(`<h2>Copertura</h2><div class="scroll"><table><thead><tr><th>Campionato</th><th>Stagione</th><th class="num">Partite giocate</th><th class="num">Con il dato</th><th class="num">Copertura</th></tr></thead><tbody>${covRows.map(([n, s, pm, c, ag]) =>
        `<tr><td>${esc(n)}</td><td>${s}</td><td class="num">${pm}</td><td class="num">${c == null ? '<span class="nd">n.d.</span>' : Math.round(c)}</td><td class="num">${c == null || !pm ? '<span class="nd" title="dato non disponibile">n.d.</span>' : pc(Math.min(1, c / pm))}</td></tr>`).join('')}</tbody></table></div>
        <p class="note">Zero, dato mancante e non applicabile sono distinti: uno zero è un valore registrato; "n.r." (non rilevato) indica che la fonte non ha il dato per quella partita; "n.d." che non ci sono abbastanza partite per calcolarlo; "n/a" che il calcolo non ha senso (es. percentuale su zero tentativi).</p>`);
    document.getElementById('st-lg').onchange = e => { ui.statLg = e.target.value; ui.statSeason = null; statPage(code); };
    document.getElementById('st-s').onchange = e => { ui.statSeason = e.target.value; statPage(code); };
    app.onclick = e => { const t = e.target.closest('[data-open-metric]'); if (t) ui.openRows.add('tm:' + t.dataset.openMetric); };
    const tr = document.getElementById('trend'); if (tr) lineChart(tr, series, m.unit);
  }

  function lineChart(el, pts, unit) {
    const draw = () => {
      const W = el.clientWidth, H = el.clientHeight; if (!W) return;
      const pad = { l: 44, r: 12, t: 14, b: 28 };
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs); let y0 = Math.min(...ys), y1 = Math.max(...ys); const sp = (y1 - y0) || 1; y0 -= sp * 0.15; y1 += sp * 0.15;
      const X = x => pad.l + (x - x0) / Math.max(1, x1 - x0) * (W - pad.l - pad.r), Y = y => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const ticks = [y0 + (y1 - y0) * 0.2, (y0 + y1) / 2, y0 + (y1 - y0) * 0.8];
      el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Andamento per giornata">
        ${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${pad.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="ax">${nf(t, 1)}</text>`).join('')}
        <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(mean)}" y2="${Y(mean)}" class="avgl"/>
        <polyline class="ln" points="${pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}"/>
        ${pts.map(p => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3" class="dot"><title>Giornata ${p[0]}: ${nf(p[1], 2)}</title></circle>`).join('')}
        ${(W > 520 ? xs.filter((_, i) => i % Math.ceil(xs.length / 10) === 0) : [x0, x1]).map(x => `<text x="${X(x)}" y="${H - 8}" text-anchor="middle" class="ax">G${x}</text>`).join('')}
      </svg>`;
      const n = document.getElementById('trend-note'); if (n) n.textContent = `Media per giornata; linea tratteggiata: media della stagione (${nf(mean, 2)}).`;
    };
    draw(); const ro = new ResizeObserver(draw); ro.observe(el);
  }

  // ---------------------------------------------------------------- precisione
  async function precision() {
    const meta = C.S.meta; const ev = await C.evalData();
    const lg = ui.precLg; const by = (ev.by || {})[lg] || {};
    const groups = Object.keys(by).filter(k => k.startsWith('G:')).map(k => [k.slice(2), by[k]]);
    const order = ['Esito', 'Gol', 'Corner', 'Tiri', 'Tiri in porta', 'Falli', 'Cartellini'];
    groups.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    const g = by['G:' + ui.precGroup];
    const fams = Object.entries(by).filter(([k]) => !k.startsWith('G:') && k !== '*' && (MatchFam(k) === ui.precGroup));
    const relLab = (o) => { if (!o || o.n < 150) return 'non valutabile'; const sk = o.skill || 0; return o.partite >= 300 && sk > 0.03 && o.ece < 0.035 ? 'alta' : sk > 0 && o.ece < 0.06 ? 'media' : 'bassa'; };
    const imp = o => o.skill == null ? 'n.d.' : (o.skill >= 0 ? '+' : '−') + nf(Math.abs(o.skill) * 100, 1) + '%';
    const bins = g ? g.bins.filter(b => b.n) : [];
    app.innerHTML = band(`<h1>Quanto è preciso?</h1>
      <p class="lead">Verifica su ${ev.n_partite || 0} partite delle stagioni ${(ev.stagioni || []).join(', ')}, sempre successive ai dati usati per la stima. Confronto con una previsione semplice basata solo sulle medie del campionato.</p>
      <p class="note">Tipi di pronostico valutati: ${Object.entries(ev.tipi || {}).map(([k, v]) => `${v} ${k === 'prepartita' ? 'registrati prima della gara' : 'ricostruiti con i soli dati precedenti'}`).join(', ') || '—'}. I parametri sono stati tarati sulla stagione ${esc(meta.stagione_taratura)}, esclusa da questa verifica.</p>
      <div class="toolbar"><label class="sel">Campionato <select id="pr-lg">${opt('tutti', 'Tutti', lg)}${meta.campionati.map(c => opt(c.code, c.name, lg)).join('')}</select></label></div>
      <div class="scroll"><table><thead><tr><th>Tipo di evento</th><th class="num">Eventi</th><th class="num">Partite</th><th class="num">Errore (Brier) modello</th><th class="num">Errore media campionato</th><th class="num">Miglioramento</th><th class="num">Scarto di calibrazione</th><th>Affidabilità</th></tr></thead><tbody>${groups.map(([n, o]) =>
        `<tr class="${n === ui.precGroup ? 'cur' : ''}"><td><button class="link" data-grp="${esc(n)}">${esc(n)}</button></td><td class="num">${o.n}</td><td class="num">${o.partite}</td><td class="num">${nf(o.brier, 4)}</td><td class="num">${nf(o.brier_base, 4)}</td><td class="num"><b>${imp(o)}</b></td><td class="num">${pc(o.ece, 1)}</td><td><span class="rel rel-${relLab(o).replace(' ', '-')}">${relLab(o)}</span></td></tr>`).join('')}</tbody></table></div>
      <p class="note">Brier: errore quadratico medio tra probabilità e risultato (più basso è meglio). Miglioramento: quanto il modello riduce l'errore rispetto alla sola media del campionato; un valore negativo significa che per quel tipo di evento il modello non aggiunge informazione.</p>`) +
      (g ? band(`<h2>${esc(ui.precGroup)}: previsto e verificato</h2><div class="fig cal" id="cal"></div><p class="note">Asse orizzontale: probabilità media assegnata; verticale: frequenza reale. Sulla diagonale tratteggiata il modello è ben calibrato. Area dei punti proporzionale al numero di casi.</p>
      <div class="scroll"><table><thead><tr><th>Probabilità assegnata</th><th class="num">Casi</th><th class="num">Media prevista</th><th class="num">Verificati</th><th class="num">Frequenza reale</th></tr></thead><tbody>${bins.map(b =>
        `<tr><td>${pc(b.da)}–${pc(b.a)}</td><td class="num">${b.n}</td><td class="num">${pc(b.p_media, 1)}</td><td class="num">${b.verificati}</td><td class="num"><b>${pc(b.freq, 1)}</b></td></tr>`).join('')}</tbody></table></div>
      ${bins.filter(b => b.da === 0.7)[0] ? `<p>Esempio: quando il modello ha assegnato tra il 70% e l'80% (media ${pc(bins.find(b => b.da === 0.7).p_media, 1)}), l'evento si è verificato ${bins.find(b => b.da === 0.7).verificati} volte su ${bins.find(b => b.da === 0.7).n} (${pc(bins.find(b => b.da === 0.7).freq, 1)}).</p>` : ''}
      <h3>Dettaglio per famiglia</h3><div class="scroll"><table><thead><tr><th>Famiglia</th><th class="num">Eventi</th><th class="num">Miglioramento</th><th class="num">Calibrazione</th><th>Affidabilità</th></tr></thead><tbody>${fams.map(([k, o]) =>
        `<tr><td>${esc(FN[k] || k)}</td><td class="num">${o.n}</td><td class="num">${imp(o)}</td><td class="num">${pc(o.ece, 1)}</td><td><span class="rel rel-${relLab(o).replace(' ', '-')}">${relLab(o)}</span></td></tr>`).join('')}</tbody></table></div>`) : '');
    document.getElementById('pr-lg').onchange = e => { ui.precLg = e.target.value; precision(); };
    app.onclick = e => { const b = e.target.closest('[data-grp]'); if (b) { ui.precGroup = b.dataset.grp; precision(); } };
    const el = document.getElementById('cal'); if (el && bins.length) calChart(el, bins);
  }
  const FN = { '1x2': 'Esito finale 1X2', dc: 'Doppia chance', gol_tot_ge: 'Gol totali, almeno', gol_tot_le: 'Gol totali, al massimo', gol_h_ge: 'Gol casa', gol_a_ge: 'Gol ospite', btts: 'Entrambe a segno', cs_h: 'Porta inviolata casa', cs_a: 'Porta inviolata ospite', gol_1t_ge: 'Gol primo tempo', score: 'Risultato esatto', corner_tot_ge: 'Corner totali, almeno', corner_tot_le: 'Corner totali, al massimo', corner_h_ge: 'Corner casa', corner_a_ge: 'Corner ospite', corner_piu: 'Più corner', tiri_tot_ge: 'Tiri totali', tiri_h_ge: 'Tiri casa', tiri_a_ge: 'Tiri ospite', tiri_porta_tot_ge: 'Tiri in porta totali', tiri_porta_h_ge: 'Tiri in porta casa', tiri_porta_a_ge: 'Tiri in porta ospite', falli_tot_ge: 'Falli totali', falli_h_ge: 'Falli casa', falli_a_ge: 'Falli ospite', cartellini_tot_ge: 'Cartellini totali', cartellini_h_ge: 'Cartellini casa', cartellini_a_ge: 'Cartellini ospite' };
  function MatchFam(f) {
    if (f === '1x2' || f === 'dc') return 'Esito';
    if (f.startsWith('gol') || ['btts', 'cs_h', 'cs_a', 'score'].includes(f)) return 'Gol';
    if (f.startsWith('corner')) return 'Corner'; if (f.startsWith('tiri_porta')) return 'Tiri in porta'; if (f.startsWith('tiri')) return 'Tiri';
    if (f.startsWith('falli')) return 'Falli'; if (f.startsWith('cartellini')) return 'Cartellini'; return 'Altro';
  }
  function calChart(el, bins) {
    const draw = () => {
      const W = el.clientWidth, H = el.clientHeight; if (!W) return; const p = 36; const s = Math.min(W, H + 40) - p * 1.4;
      const X = v => p + v * (W - p * 1.6), Y = v => H - p + -v * (H - p * 1.6);
      const big = Math.max(...bins.map(b => b.n));
      el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Probabilità prevista contro frequenza reale">
        ${[0, .25, .5, .75, 1].map(t => `<line x1="${X(0)}" x2="${X(1)}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${X(0) - 6}" y="${Y(t) + 4}" text-anchor="end" class="ax">${t * 100}%</text><text x="${X(t)}" y="${H - p + 18}" text-anchor="middle" class="ax">${t * 100}%</text>`).join('')}
        <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" class="avgl"/>
        <polyline class="ln" points="${bins.map(b => X(b.p_media) + ',' + Y(b.freq)).join(' ')}"/>
        ${bins.map(b => `<circle cx="${X(b.p_media)}" cy="${Y(b.freq)}" r="${3 + 7 * Math.sqrt(b.n / big)}" class="dot o"><title>Previsto ${pc(b.p_media, 1)}, reale ${pc(b.freq, 1)} su ${b.n}</title></circle>`).join('')}
      </svg>`;
    };
    draw(); new ResizeObserver(draw).observe(el);
  }

  // ---------------------------------------------------------------- fonti
  function sources() {
    const m = C.S.meta;
    const st = s => ({ ok: '✓ funzionante', parziale: '◐ parziale', errore: '✗ non riuscita', saltata: '○ non attiva', 'mai eseguita': '○ mai eseguita' }[s] || s);
    app.innerHTML = band(`<h1>Fonti e aggiornamenti</h1>
      <div class="kpis"><div class="kpi hi"><b>${m.ultimo_aggiornamento_riuscito ? C.dtime(m.ultimo_aggiornamento_riuscito) : '—'}</b><span>ultimo aggiornamento riuscito</span></div>
      <div class="kpi"><b>Automatico</b><span>${esc(m.pianificazione || '')}</span></div>
      <div class="kpi"><b>${m.dati_dimostrativi ? 'sì' : 'no'}</b><span>dati dimostrativi: tutti i numeri vengono dalle fonti elencate</span></div></div>
      ${alerts(true)}`) +
      band(`<h2>Stato delle fonti</h2><div class="scroll"><table class="stack"><thead><tr><th>Fonte</th><th>Stato</th><th>Ultimo successo</th><th>Fornisce</th><th>Chiave</th><th>Messaggio</th></tr></thead><tbody>${m.fonti.map(f =>
        `<tr><td><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a><div class="sub">${esc(f.license)}</div></td><td class="st-${esc(f.stato)}">${st(f.stato)}</td><td>${f.ultimo_successo ? C.dtime(f.ultimo_successo) : 'mai'}</td><td>${esc(f.provides)}</td><td>${f.needs_key ? (f.key_configured ? 'configurata' : `mancante: <code>${esc(f.key_env)}</code>`) : 'non serve'}</td><td class="sub">${esc(f.messaggio)}${f.righe ? `<br>righe lette ${f.righe[0]}, nuove ${f.righe[1]}, corrette ${f.righe[2]}` : ''}</td></tr>`).join('')}</tbody></table></div>`) +
      band(`<h2>Come attivare le fonti con chiave</h2><ol class="steps">
        <li><b>football-data.org</b> (gratuita): registrati su football-data.org, ricevi il token via email. Aggiunge calendario ufficiale con orari, rinvii, giornate e arbitri designati per tutti e quattro i campionati.</li>
        <li><b>API-Football</b>: il piano gratuito (100 richieste al giorno) copre solo le stagioni dal 2022 al 2024, quindi non aggiunge nulla alla stagione in corso. Con un piano a pagamento aggiunge contrasti, dribbling e duelli per ogni giocatore, formazioni ufficiali e indisponibili. Chiave su dashboard.api-football.com.</li>
        <li>Nel repository GitHub dell'app apri <i>Settings → Secrets and variables → Actions → New repository secret</i> e crea <code>FOOTBALL_DATA_ORG_KEY</code> e <code>API_FOOTBALL_KEY</code>. Le chiavi restano sul server: non finiscono mai nella pagina né nei dati pubblicati.</li>
        <li>Avvia una volta il workflow <i>Aggiornamento quotidiano</i> dalla scheda Actions (o attendi l'esecuzione del giorno dopo). Lo stato qui sopra diventerà "funzionante".</li></ol>
        <p class="note">Regola permanente: nessuna fonte di quote, probabilità implicite o pronostici dei bookmaker viene usata. Dalle tabelle di football-data.co.uk si importano solo le colonne sportive; gli endpoint di quote e pronostici di API-Football non vengono mai chiamati.</p>`) +
      band(`<h2>Copertura per campionato e stagione</h2><div class="scroll"><table><thead><tr><th>Campionato</th><th>Stagione</th><th class="num">In calendario</th><th class="num">Giocate</th><th class="num">Con tiri e corner</th><th class="num">Con 1° tempo</th><th class="num">Con arbitro</th></tr></thead><tbody>${m.campionati.flatMap(l => l.seasons.map(s => {
        const c = (m.copertura[l.code] || {})[s]; if (!c) return ''; const mm = c.metriche;
        return `<tr><td>${esc(l.name)}</td><td>${s}</td><td class="num">${c.partite}</td><td class="num">${c.giocate}</td><td class="num">${mm.corner || 0}</td><td class="num">${mm.primo_tempo || 0}</td><td class="num">${mm.arbitro || 0}</td></tr>`; })).join('')}</tbody></table></div>`) +
      band(`<h2>Storico aggiornamenti</h2><div class="scroll"><table><thead><tr><th>Inizio</th><th>Fine</th><th>Esito</th><th>Avvio</th><th>Note</th></tr></thead><tbody>${m.aggiornamenti.map(r =>
        `<tr><td>${C.dtime(r.started_at)}</td><td>${C.dtime(r.finished_at)}</td><td>${esc(r.status)}</td><td>${esc(r.trigger || '')}</td><td class="sub">${esc(r.message || '')}</td></tr>`).join('')}</tbody></table></div>`);
  }

  // ---------------------------------------------------------------- metodo
  function method() {
    const m = C.S.meta; const p = (m.parametri || {}).chosen || {};
    const pri = m.priori_neopromosse[m.stagione_corrente] || {};
    app.innerHTML = band(`<h1>Come funziona il modello</h1><p class="lead">Un modello statistico trasparente che usa solo dati sportivi disponibili prima del calcio d'inizio. Nessuna quota, probabilità implicita o pronostico esterno entra in raccolta dati, stima, selezione degli indicatori o valutazione.</p>
      <h2>1. Stima dei valori attesi</h2><p>Per gol, corner, tiri, tiri in porta, falli e cartellini, il valore atteso di ciascuna squadra è il prodotto di cinque fattori:</p>
      <p class="formula">media del campionato (casa o trasferta) × produzione della squadra × fattore campo della squadra × concessione dell'avversario × fattore campo dell'avversario</p>
      <ul><li><b>Forza degli avversari:</b> produzione e concessione si stimano insieme con una procedura iterativa, così segnare tre gol alla prima in classifica pesa più che segnarli all'ultima.</li>
      <li><b>Forma recente:</b> ogni partita pesa la metà dopo un'emivita fissata (vedi tabella), all'interno degli ultimi due anni.</li>
      <li><b>Prudenza con pochi dati:</b> ogni stima è avvicinata alla media del campionato come se si aggiungessero <i>k</i> partite di rendimento medio. Per le neopromosse il punto di partenza è il rendimento medio storico delle neopromosse, misurato sui dati: per la stagione ${esc(m.stagione_corrente)} gol fatti ×${nf((pri.gol || [1])[0], 2)}, gol subiti ×${nf((pri.gol || [1, 1])[1], 2)} rispetto alla media.</li>
      <li><b>Campione minimo:</b> se una squadra ha meno di 3 partite con la statistica, la stima non viene mostrata ("stima non disponibile").</li>
      <li><b>Arbitro:</b> per falli e cartellini, solo se la designazione è nota prima della gara, con un fattore prudente (equivale ad aggiungere ${(p.cartellini || {}).k_referee || 12} gare di media campionato).</li>
      <li><b>Assenze e minuti attesi:</b> entrano solo negli eventi giocatore e solo con una fonte di dati individuali attiva; non modificano le stime di squadra perché il loro contributo non è ancora verificabile.</li></ul>
      <h2>2. Dalle medie alle probabilità</h2><p>Gol: distribuzione di Poisson per ciascuna squadra; da qui esito 1X2 (somma 100%), entrambe a segno, soglie e risultati esatti. Le altre statistiche hanno più variabilità di una Poisson: si usa una binomiale negativa con dispersione stimata dai dati del campionato. I totali sono la somma delle due squadre. Gli intervalli di previsione all'80% lasciano fuori il 10% più basso e il 10% più alto. Le probabilità delle soglie sono cumulate, quindi sempre coerenti: "almeno 5" non supera mai "almeno 4".</p>
      <h2>3. Taratura e verifica</h2><p>Emivita e prudenza sono scelte per ogni statistica sulla stagione ${esc(m.stagione_taratura)}, massimizzando la verosimiglianza delle partite (squadra e totale). La verifica in <a href="#precisione">Quanto è preciso?</a> usa solo le stagioni successive. Ogni pronostico è salvato con data, ora, versione del modello e data dei dati più recenti usati.</p>
      <div class="scroll"><table><thead><tr><th>Statistica</th><th class="num">Emivita (giorni)</th><th class="num">Prudenza k</th><th class="num">Fattore campo k</th></tr></thead><tbody>${Object.entries(p).map(([k, v]) => `<tr><td>${esc(k.replace('_', ' '))}</td><td class="num">${v.half_life_days}</td><td class="num">${v.k_shrink}</td><td class="num">${v.k_venue}</td></tr>`).join('')}</tbody></table></div>
      <h2>4. Limiti</h2><ul><li>Dati per giocatore: Serie A dai Match Report ufficiali della Lega, con falli commessi, fuorigioco e titolari da ESPN; Premier League da FPL-Core-Insights (FotMob); Bundesliga e LaLiga da ESPN, con i minuti stimati dalle sostituzioni. Contrasti di squadra (effettuati, vinti, persi) per tutti e quattro i campionati da ESPN; contrasti e dribbling del singolo giocatore solo in Premier League, perché nessuna fonte gratuita li pubblica per gli altri campionati. L'xG dei fornitori viene mostrato ma non entra nel modello.</li><li>Sui totali di gol e corner il modello fa poco meglio, o non meglio, della media del campionato: la pagina di verifica lo mostra apertamente.</li><li>Infortuni, turnover e motivazioni non sono misurati.</li></ul>`);
  }

  // ---------------------------------------------------------------- installazione
  function installHelp() {
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    app.innerHTML = band(`<h1>Installa l'app</h1>
      ${standalone ? '<p class="info">Stai già usando l\'app installata.</p>' : ''}
      ${window.__installPrompt ? '<p><button class="btn primary" id="do-install">Installa ora</button></p>' : ''}
      <ol class="steps">
        <li>Apri l'indirizzo dell'app direttamente in <b>Chrome</b>, scrivendolo nella barra degli indirizzi. Se l'hai aperto toccando un link dentro un'altra app (Claude, WhatsApp, Telegram…), si apre un browser interno che non permette l'installazione: tocca ⋮ e scegli <i>Apri in Chrome</i>.</li>
        <li>Non usare una scheda in incognito.</li>
        <li>In Chrome tocca il menu ⋮ in alto a destra e scegli <b>Installa app</b>. Se non c'è, scegli <b>Aggiungi a schermata Home</b> e poi <b>Installa</b>.</li>
        <li>Con Samsung Internet: menu ≡ → <b>Aggiungi pagina a</b> → <b>Schermata Home</b>.</li>
        <li>Sulla schermata Home compare l'icona <b>Calcio</b>: si apre a tutto schermo e si aggiorna da sola ogni mattina.</li>
      </ol>
      <p class="note">Se compare il pulsante <b>Installa app</b> in alto, accanto allo stato dell'aggiornamento, puoi toccare direttamente quello.</p>`);
    const b = document.getElementById('do-install'); if (b) b.onclick = () => window.__doInstall && window.__doInstall();
  }

  function notFound() { app.innerHTML = band('<h1>Pagina non trovata</h1><p><a href="#oggi">Torna alle partite di oggi</a></p>'); }

  // ---------------------------------------------------------------- router
  async function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    app.onclick = null; app.onchange = null;
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', h.startsWith(a.dataset.r) || (a.dataset.r === 'oggi' && (h === '' || h.startsWith('data-')))));
    app.setAttribute('aria-busy', 'true');
    try {
      let mm;
      if (!h || h === 'oggi') await home();
      else if ((mm = h.match(/^data-(\d{4}-\d{2}-\d{2})$/))) await home(mm[1]);
      else if (h === 'campionati') await leagues();
      else if ((mm = h.match(/^lega-([a-z0-9]+)$/))) { const L = C.leagueInfo(mm[1]); if (!L) notFound(); else { const d = await C.season(L.code, L.current); location.replace('#giornata-' + L.code + '-' + C.scode(L.current) + '-' + currentMd(d)); return; } }
      else if ((mm = h.match(/^giornata-([a-z0-9]+)-(\d{4})-(\d+)$/))) await giornata(mm[1], mm[2], +mm[3]);
      else if ((mm = h.match(/^partita-(.+?)(?:--([a-z]+))?$/))) await MatchView.view(app, mm[1], mm[2]);
      else if ((mm = h.match(/^squadra-(.+)$/))) await team(mm[1]);
      else if ((mm = h.match(/^arbitri(?:-([a-z0-9]+))?$/))) await referees(mm[1]);
      else if ((mm = h.match(/^arbitro-(.+)$/))) await referee(mm[1]);
      else if (h === 'giocatori') await playersPage();
      else if ((mm = h.match(/^giocatore-(.+)$/))) await playersPage(mm[1]);
      else if (h === 'statistiche') await statsIndex();
      else if ((mm = h.match(/^stat-(.+)$/))) await statPage(mm[1]);
      else if (h === 'precisione') await precision();
      else if (h === 'fonti') sources();
      else if (h === 'metodo') method();
      else if (h === 'installa') installHelp();
      else notFound();
      if (!/^partita-/.test(h)) document.title = 'Calcio in chiaro';
    } catch (e) {
      console.error(e);
      app.innerHTML = band(`<h1>Qualcosa non ha funzionato</h1><p class="warn">${esc(e.message)}</p><p><a href="#oggi">Torna a oggi</a></p>`);
    }
    app.removeAttribute('aria-busy');
  }

  async function start() {
    try { await C.meta(); } catch (e) { app.innerHTML = band(`<h1>Dati non disponibili</h1><p class="warn">Impossibile leggere i dati dell'app (${esc(e.message)}).</p>`); return; }
    const m = C.S.meta; const late = m.avvisi.some(a => a.livello === 'ritardo'); const src = m.avvisi.some(a => a.livello === 'fonte');
    const s = document.getElementById('status');
    s.innerHTML = `<a href="#fonti" class="${late || src ? 'late' : 'fresh'}"><i></i>Aggiornato ${m.ultimo_aggiornamento_riuscito ? C.dtime(m.ultimo_aggiornamento_riuscito) : '—'}${late ? ' · dati in ritardo' : src ? ' · una fonte non risponde' : ''}</a>`;
    window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
    route();
  }
  start();
})();
