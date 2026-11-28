/* Scommesse consigliate: gli eventi che TUTTI i dati dell'app ritengono molto probabili (squadre e giocatori),
   la schedina piu' probabile e il confronto con le quote che l'utente vede dal suo bookmaker (errori di quota).
   Nessuna quota dei bookmaker viene scaricata ne' usata nei calcoli: quella inserita a mano resta sul dispositivo. */
(function () {
  const { esc, nf, pc } = C;
  const ui = { lg: 'tutti', per: 'giornata', minF: 0.7, rel: 'media', mk: 'tutti', n: 4, conPl: false, pstat: 'tutte', pOff: false, margin: 0.1 };
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
  // codice, plurale, singolare, soglie, statistica di squadra che ne influenza il ritmo, di chi (propria o avversaria)
  const PST = [['tiri', 'tiri', 'tiro', [1, 2, 3], 'tiri', 'own'], ['tiri_porta', 'tiri in porta', 'tiro in porta', [1, 2], 'tiri_porta', 'own'],
    ['gol', 'gol', 'gol', [1], 'gol', 'own'], ['assist', 'assist', 'assist', [1], 'gol', 'own'], ['ga', 'gol o assist', 'gol o assist', [1], 'gol', 'own'],
    ['falli_commessi', 'falli commessi', 'fallo commesso', [1, 2], 'falli', 'own'], ['falli_subiti', 'falli subiti', 'fallo subito', [1, 2], 'falli', 'opp']];
  const PSTN = { tiri: 'Tiri', tiri_porta: 'Tiri in porta', gol: 'Gol', assist: 'Assist', ga: 'Gol o assist', falli_commessi: 'Falli commessi', falli_subiti: 'Falli subiti' };
  // pesi dell'indice di fiducia
  const WT = { modello: 0.45, storico: 0.2, squadre: 0.25, campionato: 0.1 };
  const WP = { modello: 0.45, storico: 0.2, ultime5: 0.2, stagione: 0.15 };
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

  // ---------- partite e squadre: modello + storico verificato + storico delle due squadre + frequenza del campionato
  async function teamTips(x, m, ev) {
    const pr = x.P[m.i]; if (!pr || !pr.p) return [];
    const mx = await MatchView.load(m.i); if (!mx || !mx.p) return [];
    const rel = ev.reliability[x.L.code] || {};
    const byFam = {};
    MatchView.eventRows(mx).forEach(r => {
      if (r.na) return;
      const g = groupOf(r.fam); if (!g || (ui.mk !== 'tutti' && ui.mk !== g)) return;
      if (r.p < 0.5 || r.p > MAXP) return;
      const rl = rel[r.fam] || 'non valutabile';
      if (ui.rel === 'alta' ? rl !== 'alta' : !['alta', 'media'].includes(rl)) return;
      const h = hist(ev, x.L.code, r.fam, r.p);
      const tm = [r.hf, r.af].filter(Boolean); const ty = tm.reduce((a, z) => a + z.y, 0), tn = tm.reduce((a, z) => a + z.n, 0);
      const sig = { modello: { f: r.p }, storico: h && h.n >= 30 ? { f: h.f, n: h.n } : null,
        squadre: tn >= 6 ? { f: ty / tn, y: ty, n: tn } : null, campionato: r.lf && r.lf.n >= 50 ? { f: r.lf.f } : null };
      const fid = blend(sig, WT);
      if (fid == null || fid < ui.minF) return;
      const cur = byFam[r.fam];
      // per ogni mercato la linea piu' impegnativa che resta sopra la soglia di fiducia
      const better = !cur || (r.fam.endsWith('_ge') ? r.k > cur.k : r.fam.endsWith('_le') ? r.k < cur.k : fid > cur.fid);
      if (better) byFam[r.fam] = { fam: r.fam, key: r.key, k: r.k, p: r.p, fid, sig, rel: rl, h, label: r.label };
    });
    return Object.values(byFam).map(t => Object.assign(t, { kind: 'squadra', id: `${m.i}|${t.fam}|${t.key}`, m, x, g: groupOf(t.fam), mk: market(t.fam, t.key, t.k), H: mx.H, A: mx.A }));
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
    const out = [];
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
            const p = pois(rt * fac * exp / 90, k); if (p < 0.5 || p > MAXP) return;
            const l5 = ys.slice(-5), hy = l5.filter(v => v >= k).length, sy = ys.filter(v => v >= k).length;
            const h = phist(x, code, k, p);
            const sig = { modello: { f: p }, storico: h && h.n >= 30 ? { f: h.f, n: h.n } : null,
              ultime5: l5.length >= 3 ? { f: hy / l5.length, y: hy, n: l5.length } : null, stagione: ys.length >= 5 ? { f: sy / ys.length, y: sy, n: ys.length } : null };
            const fid = blend(sig, WP);
            if (fid != null && fid >= ui.minF && (!best || k > best.k)) best = { k, p, fid, sig, h };
          });
          if (!best) return;
          const what = code === 'gol' ? 'Segna' : code === 'assist' ? 'Fa almeno un assist' : code === 'ga' ? 'Segna o fa assist' : `Almeno ${best.k} ${best.k === 1 ? sing : plur}`;
          out.push(Object.assign(best, { kind: 'giocatore', id: `${m.i}|${o.pid}|${code}|${best.k}`, m, x, pid: o.pid, name: o.name, role: o.role, tid,
            team: C.teamName(x.d, tid), code, off: st.off, exp, rate: rt, fac, mk: what, label: `${esc(o.name)}: ${what.toLowerCase()}`,
            H: C.teamName(x.d, m.h), A: C.teamName(x.d, m.a) }));
        });
      });
    });
    return out;
  }

  // ---------- schedina: una selezione per partita, le piu' solide secondo tutti i dati
  function schedina(all) {
    const pool = all.filter(t => ui.conPl || t.kind === 'squadra').sort((a, b) => b.fid - a.fid);
    const used = new Set(), pick = [];
    for (const t of pool) { if (used.has(t.m.i)) continue; pick.push(t); used.add(t.m.i); if (pick.length >= 8) break; }
    return pick;
  }

  // ---------- errori di quota: quote inserite dall'utente, salvate solo su questo dispositivo
  const QK = 'calcio-quote';
  const loadQ = () => { try { return JSON.parse(localStorage.getItem(QK) || '{}'); } catch (e) { return {}; } };
  const saveQ = q => { try { localStorage.setItem(QK, JSON.stringify(q)); } catch (e) { /* non disponibile */ } };
  function verdict(q, f) {
    if (!q || !(q > 1)) return '';
    const v = q * f - 1;
    const cls = v >= ui.margin ? 'ok' : v >= 0 ? 'mid' : 'ko';
    const txt = v >= ui.margin ? 'Possibile errore di quota' : v >= 0 ? 'Poco sopra il giusto' : 'Quota nella norma o bassa';
    return `<span class="vq ${cls}"><b>${v >= 0 ? '+' : '−'}${nf(Math.abs(v) * 100, 0)}%</b> ${txt}<span class="sub"> · su 10 € il valore atteso è ${v >= 0 ? '+' : '−'}${nf(Math.abs(v) * 10, 2)} €</span></span>`;
  }

  // ---------- tabelle
  const matchCell = t => `<a href="${C.matchUrl(t.m, t.kind === 'giocatore' ? 'giocatori' : 'eventi')}">${esc(t.H)} – ${esc(t.A)}</a><div class="sub">${esc(t.x.L.name)} · ${C.dshort(t.m.ko)} ${C.hm(t.m.ko)}</div>`;
  const fidCell = t => { const a = agree(t.sig); return `<b class="big">${pc(t.fid)}</b><div class="sub">${a.si}/${a.n} dati d'accordo</div>`; };
  function teamTable(tips) {
    const byMatch = {};
    tips.slice().sort((a, b) => b.fid - a.fid).forEach(t => {
      const o = byMatch[t.m.i] = byMatch[t.m.i] || { g: new Set(), list: [] };
      if (o.g.has(t.g) || o.list.length >= 3) return; o.g.add(t.g); o.list.push(t);
    });
    const shown = Object.values(byMatch).flatMap(o => o.list).sort((a, b) => b.fid - a.fid);
    if (!shown.length) return '<p class="empty">Nessuna scommessa sopra la soglia di fiducia con questi filtri. Prova ad abbassare la fiducia minima o ad allargare il periodo.</p>';
    return `<div class="scroll"><table class="evt tips"><thead><tr><th>Partita</th><th>Scommessa</th><th class="num">Fiducia</th><th>Cosa dicono i dati</th><th class="num">Quota giusta</th><th>Affidabilità</th></tr></thead><tbody>${shown.map(t =>
      `<tr><td>${matchCell(t)}</td><td><b>${esc(t.mk)}</b><div class="sub">${t.label}</div></td><td class="num">${fidCell(t)}</td><td class="sigs">${sigLine(t.sig)}</td><td class="num">${fair(t.fid)}</td><td>${relChip(t.rel)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note"><b>Fiducia</b>: media pesata di tutti i dati dell'app: probabilità del <b>modello</b> (forza delle squadre, campo, avversario, arbitro), <b>storico</b> verificato del modello per quel tipo di evento, <b>squadre</b> (quante volte l'evento si è verificato nelle partite in casa della squadra di casa e in trasferta dell'ospite) e frequenza nel <b>campionato</b>. In verde i dati sopra il 60%. Al massimo 3 scommesse per partita, di tipo diverso; per ogni mercato la linea più impegnativa che resta sopra la soglia. <b>Quota giusta</b> = 1 ÷ fiducia: è quanto dovrebbe pagare la scommessa se i dati hanno ragione.</p>`;
  }
  function playerTable(tips) {
    const shown = tips.sort((a, b) => b.fid - a.fid).slice(0, 120);
    if (!shown.length) return '<p class="empty">Nessuna scommessa sui giocatori con questi filtri. Servono almeno 450 minuti e 3 partite da titolare.</p>';
    return `<div class="scroll"><table class="evt tips"><thead><tr><th>Giocatore</th><th>Partita</th><th>Scommessa</th><th class="num">Fiducia</th><th>Cosa dicono i dati</th><th class="num">Quota giusta</th></tr></thead><tbody>${shown.map(t =>
      `<tr><td><a href="#giocatore-${esc(t.pid)}">${esc(t.name)}</a><div class="sub">${esc(t.team)} · ${esc(t.role)} · ${t.off ? '<b>titolare ufficiale</b>' : 'titolare probabile'}</div></td><td>${matchCell(t)}</td><td><b>${esc(t.mk)}</b><div class="sub">${esc(PSTN[t.code])} · ${nf(t.rate, 2)}/90'${Math.abs(t.fac - 1) >= 0.05 ? ` · partita ×${nf(t.fac, 2)}` : ''} · ${Math.round(t.exp)}' attesi</div></td><td class="num">${fidCell(t)}</td><td class="sigs">${sigLine(t.sig)}</td><td class="num">${fair(t.fid)}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Solo titolari: dalla formazione ufficiale se già uscita (controllo ogni 30 minuti), altrimenti chi è partito titolare in almeno 4 delle ultime 5. <b>Modello</b>: ritmo stagionale ogni 90 minuti × minuti attesi, corretto per la partita (per esempio più tiri se la squadra è attesa sopra la sua media, più falli subiti se l'avversario fa molti falli). <b>Storico</b>: stessa regola verificata sulle partite già giocate. <b>Ultime 5</b> e <b>stagione</b>: in quante partite da titolare il giocatore ci è riuscito. Se il giocatore va in panchina la scommessa non vale.</p>`;
  }
  function slipView(all) {
    const pick = schedina(all);
    if (!pick.length) return '<p class="empty">Nessuna selezione disponibile con questi filtri.</p>';
    const sel = pick.slice(0, ui.n);
    const F = sel.reduce((a, t) => a * t.fid, 1);
    let cum = 1; const curve = pick.map((t, i) => { cum *= t.fid; return [i + 1, cum]; });
    return `<div class="kpis"><div class="kpi hi"><b>${pc(F, 1)}</b><span>probabilità che vadano tutte bene, secondo tutti i dati</span><i>circa 1 volta ogni ${nf(1 / F, 1)}</i></div>
      <div class="kpi"><b>${nf(1 / F, 2)}</b><span>quota giusta della schedina</span><i>se la trovi più alta, è sopra il valore</i></div></div>
      <div class="scroll"><table class="evt tips"><thead><tr><th>#</th><th>Partita</th><th>Selezione</th><th class="num">Fiducia</th><th>Cosa dicono i dati</th><th class="num">Quota giusta</th></tr></thead><tbody>${sel.map((t, i) =>
        `<tr><td>${i + 1}</td><td>${matchCell(t)}</td><td><b>${esc(t.mk)}</b><div class="sub">${t.kind === 'giocatore' ? esc(t.name) + ' · ' + (t.off ? 'titolare ufficiale' : 'titolare probabile') : t.label}</div></td><td class="num">${fidCell(t)}</td><td class="sigs">${sigLine(t.sig)}</td><td class="num">${fair(t.fid)}</td></tr>`).join('')}</tbody></table></div>
      <h3>Quante selezioni mettere</h3><div class="scroll"><table><thead><tr><th>Selezioni</th>${curve.map(c => `<th class="num${c[0] === ui.n ? ' hl' : ''}">${c[0]}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Tutte vincenti</td>${curve.map(c => `<td class="num${c[0] === ui.n ? ' hl' : ''}">${pc(c[1], 0)}</td>`).join('')}</tr>
      <tr><td>Quota giusta</td>${curve.map(c => `<td class="num${c[0] === ui.n ? ' hl' : ''}">${nf(1 / c[1], 2)}</td>`).join('')}</tr></tbody></table></div>
      <p class="note"><b>Perché non esiste una schedina perfetta.</b> Ogni selezione in più moltiplica le probabilità: anche con eventi all'80%, cinque insieme riescono circa una volta su tre (0,8 × 0,8 × 0,8 × 0,8 × 0,8 = 33%). Qui c'è la combinazione più solida secondo tutti i dati dell'app: per ogni partita al massimo un evento, così le selezioni non dipendono l'una dall'altra.</p>`;
  }
  function oddsView(all) {
    const q = loadQ();
    const shown = all.slice().sort((a, b) => b.fid - a.fid).slice(0, 150);
    if (!shown.length) return '<p class="empty">Nessuna scommessa sopra la soglia di fiducia con questi filtri.</p>';
    return `<p class="info">L'app non scarica le quote dei bookmaker: nessuna fonte gratuita le fornisce e leggere bet365 o Sisal non è permesso dalle loro condizioni. <b>Scrivi tu la quota</b> che vedi su bet365, Sisal o un altro sito: l'app la confronta con la quota giusta calcolata dai dati e ti dice se è un errore di quota. Le quote che scrivi restano solo su questo dispositivo.</p>
      <div class="toolbar"><label class="sel">Errore di quota se sopra il giusto di <select id="c-mg">${[0.05, 0.1, 0.15, 0.2].map(v => opt(v, '+' + Math.round(v * 100) + '%', ui.margin)).join('')}</select></label>
      <button class="btn" id="c-clear">Cancella le quote inserite</button></div>
      <div class="scroll"><table class="evt tips quote"><thead><tr><th>Partita</th><th>Scommessa</th><th class="num">Fiducia</th><th class="num">Quota giusta</th><th class="num">Errore se sopra</th><th>Quota del bookmaker</th></tr></thead><tbody>${shown.map(t =>
        `<tr><td>${matchCell(t)}</td><td><b>${esc(t.mk)}</b><div class="sub">${t.kind === 'giocatore' ? esc(t.name) + ' · ' + esc(PSTN[t.code]) : t.label}</div></td><td class="num">${fidCell(t)}</td><td class="num">${fair(t.fid)}</td><td class="num"><b>${nf((1 + ui.margin) / t.fid, 2)}</b></td>
        <td><input class="qin" type="text" inputmode="decimal" autocomplete="off" placeholder="es. ${nf(Math.max(1.05, 1 / t.fid * 1.05), 2)}" data-qid="${esc(t.id)}" data-f="${t.fid}" value="${q[t.id] ? nf(q[t.id], 2) : ''}" aria-label="Quota del bookmaker"><div class="qv" data-qv="${esc(t.id)}">${verdict(q[t.id], t.fid)}</div></td></tr>`).join('')}</tbody></table></div>
      <p class="note"><b>Come leggerlo.</b> Quota giusta = 1 ÷ fiducia. Se il bookmaker paga più della soglia "errore se sopra", la quota è più alta di quanto i dati dicono che dovrebbe essere: è un possibile errore di quota. Il valore atteso indica quanto renderebbe in media ogni 10 € giocati se la fiducia è corretta. Attenzione: una quota molto alta può voler dire anche che il bookmaker sa qualcosa che i dati dell'app non vedono (un infortunio, un cambio di formazione), quindi controlla sempre le notizie e la verifica in <a href="#precisione">Quanto è preciso?</a>.</p>`;
  }

  async function view(app, tab) {
    const meta = C.S.meta; const ev = await C.evalData();
    app.innerHTML = band('<h1>Scommesse consigliate</h1><p class="empty">Calcolo in corso…</p>');
    const Ls = meta.campionati.filter(L => ui.lg === 'tutti' || L.code === ui.lg);
    const xs = await Promise.all(Ls.map(async L => {
      const s = L.current; const [d, P, pd] = await Promise.all([C.season(L.code, s), C.preds(L.code, s), C.players(L.code, s)]);
      return { L, s, d, P: P || {}, pd };
    }));
    const team = [], pl = []; let nMatch = 0, noPred = 0; const mds = [];
    const wantTeam = tab !== 'giocatori', wantPl = tab === 'giocatori' || tab === 'quote' || (tab === 'schedina' && ui.conPl);
    for (const x of xs) {
      if (!x.d) continue;
      const ms = pickMatches(x); nMatch += ms.length;
      if (ui.per === 'giornata' && ms.length) mds.push(`${x.L.name} ${ms[0].mo || ms[0].md}ª`);
      for (const m of ms) {
        if (!(x.P[m.i] && x.P[m.i].p)) noPred++;
        if (wantTeam) team.push(...await teamTips(x, m, ev));
        if (wantPl) pl.push(...playerTips(x, m));
      }
    }
    const TABS = [['squadre', 'Partite'], ['giocatori', 'Giocatori'], ['schedina', 'Schedina'], ['quote', 'Errori di quota']];
    const seg = `<div class="seg" role="tablist">${TABS.map(([k, t]) => `<a role="tab" class="segbtn ${tab === k ? 'on' : ''}" href="#consigli${k === 'squadre' ? '' : '-' + k}">${t}</a>`).join('')}</div>`;
    const tools = `<div class="toolbar">
      <label class="sel">Campionato <select id="c-lg">${opt('tutti', 'Tutti', ui.lg)}${meta.campionati.map(L => opt(L.code, L.name, ui.lg)).join('')}</select></label>
      <label class="sel">Periodo <select id="c-per">${[['giornata', 'Prossima giornata'], ['oggi', 'Oggi'], ['3g', 'Prossimi 3 giorni'], ['7g', 'Prossimi 7 giorni']].map(([v, t]) => opt(v, t, ui.per)).join('')}</select></label>
      <label class="sel">Fiducia minima <select id="c-min">${[0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9].map(v => opt(v, pc(v), ui.minF)).join('')}</select></label>
      ${tab !== 'giocatori' ? `<label class="sel">Affidabilità del modello <select id="c-rel">${opt('media', 'Alta e media', ui.rel)}${opt('alta', 'Solo alta', ui.rel)}</select></label>
        <label class="sel">Mercato <select id="c-mk">${Object.entries(GN).map(([v, t]) => opt(v, t, ui.mk)).join('')}</select></label>` : ''}
      ${tab === 'giocatori' || tab === 'quote' ? `<label class="sel">Statistica giocatore <select id="c-ps">${opt('tutte', 'Tutte', ui.pstat)}${PST.map(([c]) => opt(c, PSTN[c], ui.pstat)).join('')}</select></label>
        <label class="sel chk"><input type="checkbox" id="c-off" ${ui.pOff ? 'checked' : ''}> Solo formazioni ufficiali</label>` : ''}
      ${tab === 'schedina' ? `<label class="sel">Selezioni <select id="c-n">${[2, 3, 4, 5, 6, 7, 8].map(v => opt(v, v, ui.n)).join('')}</select></label>
        <label class="sel chk"><input type="checkbox" id="c-pl" ${ui.conPl ? 'checked' : ''}> Includi giocatori</label>` : ''}</div>`;
    const scope = `${nMatch} partite${ui.per === 'giornata' && mds.length ? ' · giornata: ' + mds.join(', ') : ''}${noPred ? ` · ${noPred} senza pronostico (calcolato nei 14 giorni prima della gara)` : ''}`;
    const body = tab === 'giocatori' ? playerTable(pl) : tab === 'schedina' ? slipView(team.concat(pl)) : tab === 'quote' ? oddsView(team.concat(pl)) : teamTable(team);
    app.innerHTML = band(`<h1>Scommesse consigliate</h1>
      <p class="lead">Le giocate che tutti i dati dell'app ritengono molto probabili: modello, storico verificato, andamento delle squadre e dei giocatori, campionato. Nessuna quota dei bookmaker entra nel calcolo.</p>
      ${seg}${tools}<p class="note">${esc(scope)}</p>`) + band(body) +
      band(`<p class="note"><b>Gioco responsabile.</b> Il gioco è vietato ai minori di 18 anni e può causare dipendenza. Queste sono stime statistiche, non certezze: punta solo ciò che puoi permetterti di perdere. Se il gioco ti crea problemi, il Telefono Verde Nazionale dell'Istituto Superiore di Sanità risponde gratis e in anonimo all'<b>800 558822</b> (lunedì–venerdì, 10–16).</p>`);
    const re = () => view(app, tab);
    const on = (id, f) => { const el = document.getElementById(id); if (el) el.onchange = e => { f(e.target); re(); }; };
    on('c-lg', t => ui.lg = t.value); on('c-per', t => ui.per = t.value); on('c-min', t => ui.minF = +t.value); on('c-rel', t => ui.rel = t.value);
    on('c-mk', t => ui.mk = t.value); on('c-ps', t => ui.pstat = t.value); on('c-off', t => ui.pOff = t.checked); on('c-n', t => ui.n = +t.value);
    on('c-pl', t => ui.conPl = t.checked); on('c-mg', t => ui.margin = +t.value);
    const clr = document.getElementById('c-clear'); if (clr) clr.onclick = () => { saveQ({}); re(); };
    app.oninput = e => {
      const el = e.target; if (!el.dataset || !el.dataset.qid) return;
      const qs = loadQ(); const v = parseFloat(String(el.value).replace(',', '.'));
      if (v > 1) qs[el.dataset.qid] = v; else delete qs[el.dataset.qid];
      saveQ(qs);
      const out = app.querySelector(`[data-qv="${CSS.escape(el.dataset.qid)}"]`); if (out) out.innerHTML = verdict(v, +el.dataset.f);
    };
  }
  window.Consigli = { view };
})();
