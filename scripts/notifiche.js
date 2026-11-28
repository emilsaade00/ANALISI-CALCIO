#!/usr/bin/env node
/* Calibrazione della fiducia e notifiche, eseguite su GitHub Actions dopo ogni aggiornamento.
   Riusa la stessa logica dell'app (web/*.js), cosi' i numeri delle notifiche coincidono con quelli dell'app.

   node scripts/notifiche.js completo   -> calibra la fiducia (ultimi 120 giorni), scommesse del giorno (una volta al giorno), formazioni
   node scripts/notifiche.js rapido     -> formazioni ufficiali appena uscite con i consigli sui titolari

   Notifiche via ntfy (app gratuita): segreto NTFY_TOPIC. Senza segreto il messaggio viene solo scritto nel registro.
   DRY_RUN=1 scrive i messaggi senza inviarli. Nessuna quota dei bookmaker viene letta. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), WEB = process.env.WEB_DIR || path.join(ROOT, 'web'), DB = process.env.DB_DIR || path.join(ROOT, 'db');
const mode = process.argv[2] || 'completo';
const TOPIC = (process.env.NTFY_TOPIC || '').trim();
const DRY = !!process.env.DRY_RUN;
const repo = process.env.GITHUB_REPOSITORY || '';
const SITE = process.env.SITE_URL || (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : '');
const realFetch = global.fetch;

// ambiente minimo da browser: i file dell'app leggono i dati da web/data
global.window = global; global.document = { title: '' };
global.fetch = async p => {
  const f = path.join(WEB, String(p).split('?')[0]);
  if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null };
  const t = fs.readFileSync(f, 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(t) };
};
const mem = {}; global.localStorage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = String(v); } };
global.sessionStorage = global.localStorage; global.CSS = { escape: s => s };
for (const f of ['model.js', 'core.js', 'match.js', 'consigli.js']) vm.runInThisContext(fs.readFileSync(path.join(WEB, f), 'utf8'), { filename: f });

const STATE_F = path.join(DB, 'notifiche.json'), CAL_DB = path.join(DB, 'calib.json'), CAL_WEB = path.join(WEB, 'data', 'calib.json');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const nf = (v, d) => C.nf(v, d), pc = p => C.pc(p);
const unesc = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function send(n) {
  const txt = `${n.title}\n${n.message}`;
  if (!TOPIC) { console.log('NTFY_TOPIC non impostato, notifica non inviata:\n' + txt); return; }
  if (DRY) { console.log('[prova] ' + txt); return; }
  try {
    const r = await realFetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: TOPIC, title: n.title, message: n.message, click: n.click, tags: n.tags || ['soccer'], priority: n.priority || 3 }) });
    console.log(`notifica inviata (${r.status}): ${n.title}`);
  } catch (e) { console.log('notifica non inviata: ' + e.message); }
}
const line = t => `• ${unesc(t.H)} – ${unesc(t.A)} ${C.hm(t.m.ko)} · ${t.kind === 'giocatore' ? unesc(t.name) + ': ' + t.mk.toLowerCase() : t.mk} · fiducia ${pc(t.fid)} · quota giusta ${nf(1 / t.fid, 2)} (errore se sopra ${nf(1.1 / t.fid, 2)})`;

async function calibrate() {
  Consigli.setUi({ lg: 'tutti', past: 120, minF: 0.5, band: '', mk: 'tutti', rel: 'media', pstat: 'tutte', pOff: false, raw: true, only: null });
  const r = await Consigli.compute('rendimento');
  const out = { generato: new Date().toISOString(), giorni: 120 };
  for (const [kind, list] of [['squadra', r.team], ['giocatore', r.pl]]) {
    const done = list.filter(t => t.res === 'vinta' || t.res === 'persa'); const bins = [];
    for (let i = 0; i < 10; i++) {
      const a = 0.5 + i * 0.05, b = a + 0.05; const L = done.filter(t => t.fid >= a && (t.fid < b || (i === 9 && t.fid <= 1)));
      if (L.length) bins.push({ a: +a.toFixed(2), b: +b.toFixed(2), n: L.length, y: L.filter(t => t.res === 'vinta').length, f: +(L.reduce((s, t) => s + t.fid, 0) / L.length).toFixed(4) });
    }
    out[kind] = bins;
    const y = done.filter(t => t.res === 'vinta').length, f = done.reduce((s, t) => s + t.fid, 0);
    console.log(`calibrazione ${kind}: ${done.length} scommesse, vinte ${pc(y / Math.max(1, done.length))}, fiducia media ${pc(f / Math.max(1, done.length))}`);
  }
  fs.mkdirSync(DB, { recursive: true }); fs.writeFileSync(CAL_DB, JSON.stringify(out));
  Consigli.setUi({ raw: false });
}

async function morning(state) {
  const today = C.dayKey(Date.now());
  if (state.mattina === today) return;
  Consigli.setUi({ lg: 'tutti', per: 'oggi', minF: 0.75, band: '', mk: 'tutti', rel: 'media', pstat: 'tutte', pOff: false, raw: false, only: null, conPl: false, n: 4, target: '' });
  const r = await Consigli.compute('quote');
  state.mattina = today;
  if (!r.nMatch) { console.log('nessuna partita oggi: nessuna notifica del mattino'); return; }
  // nelle notifiche niente eventi quasi certi (quota giusta sotto 1,15): poco utili da giocare
  const useful = t => 1 / t.fid >= 1.15;
  const seen = new Set(), team = [];
  r.team.filter(useful).sort((a, b) => b.fid - a.fid).forEach(t => { if (!seen.has(t.m.i) && team.length < 6) { seen.add(t.m.i); team.push(t); } });
  const pl = r.pl.filter(useful).sort((a, b) => b.fid - a.fid).slice(0, 4);
  Consigli.setUi({ target: '2' }); const slip = Consigli.schedina(r.team); Consigli.setUi({ target: '' });
  const F = slip.reduce((a, t) => a * t.fid, 1);
  const msg = [`${r.nMatch} partite oggi. Le scommesse più solide:`, ...team.map(line)];
  if (pl.length) msg.push('', 'Giocatori (titolari probabili):', ...pl.map(line));
  if (slip.length) msg.push('', `Schedina a quota 2 (${slip.length} selezioni, riesce il ${pc(F)} delle volte):`, ...slip.map(line));
  msg.push('', 'Se su bet365 o Sisal trovi una quota sopra la soglia "errore", scrivila nell\'app (Errori di quota).');
  await send({ title: `Scommesse di oggi (${C.dshort(new Date().toISOString())})`, message: msg.join('\n'), click: SITE + '#consigli', tags: ['soccer', 'chart_with_upwards_trend'] });
}

async function lineups(state) {
  state.formazioni = state.formazioni || {};
  const now = Date.now(); const meta = C.S.meta;
  for (const L of meta.campionati) {
    const d = await C.season(L.code, L.current), pd = await C.players(L.code, L.current); if (!d || !pd) continue;
    for (const m of d.matches) {
      if (m.g || m.t < now - 15 * 60e3 || m.t > now + 3 * 3600e3 || state.formazioni[m.i]) continue;
      const off = ((pd.lineups || {})[m.i] || []).filter(r => r[3] === 'ufficiale' && r[2] === 'titolare');
      if (off.length < 18) continue;
      Consigli.setUi({ lg: 'tutti', only: new Set([m.i]), minF: 0.7, band: '', mk: 'tutti', rel: 'media', pstat: 'tutte', pOff: true, raw: false, conPl: false });
      const r = await Consigli.compute('quote');
      Consigli.setUi({ only: null, pOff: false });
      const H = C.teamName(d, m.h), A = C.teamName(d, m.a);
      const useful = t => 1 / t.fid >= 1.15;
      const team = r.team.filter(useful).sort((a, b) => b.fid - a.fid).slice(0, 3), pl = r.pl.filter(useful).sort((a, b) => b.fid - a.fid).slice(0, 4);
      const msg = ['Formazioni ufficiali pubblicate.'];
      if (team.length) msg.push('Partita:', ...team.map(line));
      if (pl.length) msg.push('Titolari:', ...pl.map(line));
      if (!team.length && !pl.length) msg.push('Nessuna scommessa sopra il 70% di fiducia per questa partita.');
      await send({ title: `${H} – ${A} · ore ${C.hm(m.ko)}`, message: msg.join('\n'), click: SITE + '#partita-' + m.i + '--giocatori', tags: ['soccer', 'clipboard'] });
      state.formazioni[m.i] = now;
    }
  }
  for (const k of Object.keys(state.formazioni)) if (now - state.formazioni[k] > 4 * 864e5) delete state.formazioni[k];
}

(async () => {
  await C.meta();
  const state = readJ(STATE_F, {});
  try {
    if (mode === 'completo') await calibrate();
  } catch (e) { console.log('calibrazione non riuscita: ' + e.message); }
  if (fs.existsSync(CAL_DB)) { fs.copyFileSync(CAL_DB, CAL_WEB); Consigli.reloadCal(); } // la calibrazione viaggia con i dati pubblicati
  try {
    if (mode === 'completo') await morning(state);
    await lineups(state);
  } catch (e) { console.log('notifiche non riuscite: ' + e.message); }
  fs.mkdirSync(DB, { recursive: true }); fs.writeFileSync(STATE_F, JSON.stringify(state));
})();
