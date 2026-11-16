// Semiologie Recall+ : aplicația originală + surse, capitole, grile completate până la 100+, sinteze și podcast.
// Rulează ca pagină Claude (artifact): AI prin contul celui care folosește pagina (capabilitatea `sample`),
// conținut adăugat comun tuturor colegilor (`db`), voci Claude pentru podcast (`tts`), descărcări (`downloads`).
// Deschisă în afara Claude, funcționează partea originală (carduri, grile, cazuri, recall, explicații).
(async function () {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
// Structura curată a paginii, păstrată pentru „Versiune pentru LiveSend” (înainte de orice randare).
const PRISTINE = ['header.chart', 'main.wrap', '#modal', '#jobs', '#toast'].map((q) => document.querySelector(q)?.outerHTML || '').join('\n');
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }
const md = (s) => (window.DOMPurify && window.marked ? DOMPurify.sanitize(marked.parse(s || '')) : `<pre style="white-space:pre-wrap">${esc(s)}</pre>`);
const fmtN = (n) => n.toLocaleString('ro-RO');
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const normStem = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\s*\d+\s*[.)-]\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const BASE_SRC = new Set(Object.keys(BASE.SOURCES));

/* ---------- materii ---------- */
const SUBJECTS = [
  { id: 'semio-med', label: 'Semiologie medicală', short: 'Semio med', aliases: ['semio med', 'semiologie medicala'] },
  { id: 'semio-chir', label: 'Semiologie chirurgicală', short: 'Semio chir', aliases: ['semio chir', 'semiologie chirurgicala'] },
  { id: 'fiziopat', label: 'Fiziopatologie', short: 'Fiziopat', aliases: ['fiziopatologie', 'fizpat', 'fiziopat'] },
  { id: 'farmaco', label: 'Farmacologie', short: 'Farmaco', aliases: ['farmacologie', 'farmaco'] },
  { id: 'morfopat', label: 'Anatomie patologică', short: 'Anatomie patologică', aliases: ['anatomie patologica', 'morfopatologie', 'morfopat', 'anatopat'] },
];
const SUBJ_BY = Object.fromEntries(SUBJECTS.map((x) => [x.id, x]));
function subjOf(name) { const n = normStem(name || ''); if (!n) return null; const x = SUBJECTS.find((x) => x.id === name || normStem(x.label) === n || x.aliases.includes(n)); return x ? x.id : null; }
let CUR = (() => { try { const v = localStorage.getItem('semio-subject'); return SUBJ_BY[v] ? v : 'semio-med'; } catch (e) { return 'semio-med'; } })();

/* =====================================================================
   Setări locale (per persoană)
   ===================================================================== */
const SET_KEY = 'semio-plus-settings';
const DEFAULTS = { target: 100, batch: 15, cardTarget: 60, podcastMinutes: 5, autoFill: true };
function getSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; } }
function saveSettings(s) { try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

/* =====================================================================
   Date: conținutul original + ce s-a adăugat (comun, în db)
   ===================================================================== */
const U = { sources: [], chapters: [], grilePacks: [], cardPacks: [], outputs: [] };
let SECTIONS, SECTION_CH, CARDS, CASES, RECALL, CONTRASTS, EXPLAIN, CHAPTERS, SOURCES, GQ, GQ_BY, byId, CH_ORDER;
const chMeta = (id) => U.chapters.find((c) => c.id === id);
// Capitolele originale și cele fără materie (cursul de semiologie încărcat înainte) țin de Semiologie medicală.
const chSubj = (ch) => (BASE.CHAPTERS[ch] ? 'semio-med' : (chMeta(ch)?.subject || 'semio-med'));
// Materia unei surse: cea aleasă la încărcare; o bancă din Drive după numele materiei (null = materie care nu e în listă).
const srcSubj = (s) => (!s ? null : s.subjectId || (s.subject ? subjOf(s.subject) : 'semio-med'));
const viewChapters = () => CH_ORDER.filter((ch) => chSubj(ch) === CUR);

function rebuild() {
  CHAPTERS = {};
  const userCh = U.chapters.filter((c) => !BASE.CHAPTERS[c.id]).sort((a, b) => (a.order || 0) - (b.order || 0));
  CH_ORDER = [...Object.keys(BASE.CHAPTERS).filter((k) => k !== 'X'), ...userCh.map((c) => c.id), ...(BASE.CHAPTERS.X ? ['X'] : [])];
  for (const id of CH_ORDER) CHAPTERS[id] = chMeta(id)?.title || BASE.CHAPTERS[id];

  SECTIONS = { ...BASE.SECTIONS };
  SECTION_CH = Object.fromEntries(Object.keys(BASE.SECTIONS).map((k) => [k, 'I']));
  for (const c of U.chapters) if (CHAPTERS[c.id]) for (const [k, t] of Object.entries(c.sections || {})) { SECTIONS[k] = [t, CHAPTERS[c.id]]; SECTION_CH[k] = c.id; }

  const userCards = U.cardPacks.flatMap((p) => (p.items || []).map((c) => [c.id, c.sec, c.front, c.back]));
  CARDS = [...BASE.CARDS, ...userCards.filter((c) => SECTIONS[c[1]])];
  byId = Object.fromEntries(CARDS.map((c) => [c[0], c]));

  const outs = (type) => U.outputs.filter((o) => o.type === type && CHAPTERS[o.ch]);
  CASES = [...BASE.CASES.map((c) => ({ ...c, ch: 'I' })), ...outs('cases').flatMap((o) => o.content.map((c) => ({ ...c, ch: o.ch })))];
  RECALL = [...BASE.RECALL.map((r) => ({ ...r, ch: 'I' })), ...outs('recall').flatMap((o) => (o.content.recall || []).map((r) => ({ ...r, ch: o.ch })))];
  CONTRASTS = [...BASE.CONTRASTS.map((t) => ({ ...t, ch: 'I' })), ...outs('recall').flatMap((o) => (o.content.contrasts || []).map((t) => ({ ...t, ch: o.ch })))];
  EXPLAIN = Object.fromEntries(Object.entries(BASE.EXPLAIN).map(([k, v]) => [k, v.slice()]));
  for (const o of outs('explain')) for (const it of o.content) if (SECTIONS[it.sec]) (EXPLAIN[it.sec] ||= []).push([esc(it.title), md(it.text)]);

  SOURCES = { ...BASE.SOURCES, new: 'Noi · din cursul 2022', mg: 'Teste studenți MG', s1: 'Grile semestrul I', y21: 'Grile 2021', md: 'Bancă Chișinău 2010–2011', g3: 'Grile 3-1 … 3-30', ai: 'Scrise de AI din cursul tău' };
  for (const s of U.sources) if (s.kind === 'grile') SOURCES[s.id] = s.name;
  const base = BASE.GRILE.map((r) => ({ id: r[0], ch: r[1], sj: 'semio-med', src: r[2], q: r[3], o: r[4], k: r[5], n: r[6], m: !!r[7] }));
  const added = U.grilePacks.flatMap((p) => {
    const ch = CHAPTERS[p.ch] ? p.ch : '';
    const sj = ch ? chSubj(ch) : (subjOf(p.subj) || srcSubj(U.sources.find((x) => x.id === p.src)) || (p.subj ? null : 'semio-med'));
    return (p.items || []).map((x) => ({ ...x, ch, sj, src: p.src, pack: p.id }));
  });
  GQ = [...base, ...added];
  GQ_BY = Object.fromEntries(GQ.map((x) => [x.id, x]));
}
rebuild();

// Versiunea de partajare (LiveSend): conținutul adăugat vine inclus în fișier, doar pentru citire.
const SNAP = window.SNAPSHOT && window.SNAPSHOT.user ? window.SNAPSHOT : null;
if (SNAP) { for (const k of Object.keys(U)) U[k] = SNAP.user[k] || []; rebuild(); }

/* ---------- progres: ca în aplicația originală (browser + cont) ---------- */
const LS_KEY = 'semio-srs-v1';
let store = { s: {}, g: {}, meta: { newLimit: 25, newDay: '', newCount: 0 }, updated: 0 };
function lsRead() { try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function lsWrite() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }
const local = lsRead(); if (local && local.s) store = local; if (!store.g) store.g = {};
let remoteDoc = null, saving = false, pending = false, saveTimer = null;
const syncEl = document.getElementById('sync');
function scheduleSave() {
  store.updated = Date.now(); lsWrite();
  if (!remoteDoc) return;
  clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200);
}
async function flush() {
  if (!remoteDoc) return;
  if (saving) { pending = true; return; }
  saving = true;
  try { await remoteDoc.set(JSON.parse(JSON.stringify(store))); syncEl.textContent = 'Progres: sincronizat cu contul tău · ' + new Date().toLocaleTimeString(); }
  catch (e) { syncEl.textContent = 'Progres: salvat în acest browser (sincronizarea cu contul a eșuat)'; }
  saving = false;
  if (pending) { pending = false; flush(); }
}

/* ---------- SRS ---------- */
const DAY = 864e5;
const today = () => new Date().toISOString().slice(0, 10);
function dueAt(days) { const d = new Date(); d.setHours(4, 0, 0, 0); return d.getTime() + days * DAY; }
function status(id) { const c = store.s[id]; if (!c) return 'new'; return c.i >= 21 ? 'mat' : 'learn'; }
function previewIntervals(c) {
  const r = c ? c.r : 0, i = c ? c.i : 0, e = c ? c.e : 2.5;
  const good = r === 0 ? 1 : r === 1 ? 3 : Math.round(i * e);
  const hard = r === 0 ? 1 : Math.max(1, Math.round(i * 1.2));
  const easy = r === 0 ? 3 : Math.round(Math.max(i, 1) * e * 1.3);
  return { hard, good, easy };
}
function grade(id, g) {
  const now = Date.now();
  const c = store.s[id] || { i: 0, e: 2.5, r: 0, d: now, l: 0 };
  if (!store.s[id]) { rollDay(); store.meta.newCount++; }
  const p = previewIntervals(store.s[id] ? c : null);
  if (g === 0) { c.r = 0; c.i = 0; c.e = Math.max(1.3, c.e - 0.2); c.l = (c.l || 0) + 1; c.d = now + 10 * 60e3; }
  else if (g === 1) { c.i = p.hard; c.e = Math.max(1.3, c.e - 0.15); c.r++; c.d = dueAt(c.i); }
  else if (g === 2) { c.i = p.good; c.r++; c.d = dueAt(c.i); }
  else { c.i = p.easy; c.e += 0.15; c.r++; c.d = dueAt(c.i); }
  store.s[id] = c; scheduleSave();
  return c;
}
function rollDay() { if (store.meta.newDay !== today()) { store.meta.newDay = today(); store.meta.newCount = 0; } }
const inFilter = (c, f) => (!f ? chSubj(SECTION_CH[c[1]]) === CUR : f.startsWith('ch:') ? SECTION_CH[c[1]] === f.slice(3) : c[1] === f);
function counts(filter) {
  rollDay();
  const now = Date.now(); let due = 0, nw = 0, learn = 0, mat = 0;
  const ids = CARDS.filter((c) => inFilter(c, filter));
  ids.forEach((c) => { const s = store.s[c[0]]; if (!s) nw++; else { if (s.d <= now) due++; s.i >= 21 ? mat++ : learn++; } });
  const newLeft = Math.max(0, Math.min(nw, store.meta.newLimit - store.meta.newCount));
  return { due, newLeft, learn, mat, ids };
}
function buildQueue(filter) {
  const { newLeft, ids } = counts(filter); const now = Date.now();
  const due = ids.filter((c) => store.s[c[0]] && store.s[c[0]].d <= now).sort((a, b) => store.s[a[0]].d - store.s[b[0]].d).map((c) => c[0]);
  const fresh = ids.filter((c) => !store.s[c[0]]).slice(0, newLeft).map((c) => c[0]);
  const q = []; let i = 0, j = 0;
  while (i < due.length || j < fresh.length) { if (i < due.length) q.push(due[i++]); if (i < due.length) q.push(due[i++]); if (j < fresh.length) q.push(fresh[j++]); }
  return q;
}

/* ---------- review UI ---------- */
const secSel = $('#sec-filter');
const limitIn = $('#new-limit');
const sectionsOf = (ch) => Object.keys(SECTIONS).filter((k) => SECTION_CH[k] === ch);
function fillSecSel() {
  const cur = secSel.value;
  secSel.innerHTML = '<option value="">Toate capitolele</option>' + viewChapters().map((ch) => {
    const secs = sectionsOf(ch).filter((k) => CARDS.some((c) => c[1] === k));
    if (!secs.length) return '';
    return `<optgroup label="${esc(CHAPTERS[ch])}"><option value="ch:${ch}">Tot capitolul ${esc(CHAPTERS[ch])}</option>${secs.map((k) => `<option value="${k}">${esc(SECTIONS[k][0])} (${esc(SECTIONS[k][1])})</option>`).join('')}</optgroup>`;
  }).join('');
  if ([...secSel.options].some((o) => o.value === cur)) secSel.value = cur;
}
limitIn.value = store.meta.newLimit;
limitIn.addEventListener('change', () => { store.meta.newLimit = Math.max(0, Math.min(200, +limitIn.value || 0)); scheduleSave(); refreshStats(); });
secSel.addEventListener('change', () => { refreshStats(); if (!started) renderCard(); });

let queue = [], cur = null, shown = false, reviewed = 0, started = false;
function refreshStats() {
  const c = counts(secSel.value);
  $('#st-due').textContent = c.due; $('#st-new').textContent = c.newLeft; $('#st-learn').textContent = c.learn; $('#st-mat').textContent = c.mat;
}
const fmt = (d) => (d < 1 ? '10m' : d + 'z');
function renderCard() {
  const box = $('#session');
  if (!cur && !started) {
    const c = counts(secSel.value);
    box.innerHTML = c.ids.length ? `<div class="card done"><div class="q">${c.due + c.newLeft} carduri pregătite</div><p class="hint">${c.due} de repetat · ${c.newLeft} noi. Apasă Începe sesiunea.</p></div>`
      : `<div class="card done"><div class="q">Încă nu sunt carduri la ${esc(SUBJ_BY[CUR].label)}</div><p class="hint">${viewChapters().length ? 'Alege un capitol mai jos și apasă „Scrie carduri pentru acest capitol”.' : 'Încarcă întâi cursul în tabul Curs.'}</p></div>`;
    return;
  }
  if (!cur) {
    box.innerHTML = reviewed
      ? `<div class="card done"><div class="q">Sesiune încheiată: ${reviewed} repetări</div><p class="hint">Revino mâine. Pauzele dintre repetări fixează informația.</p></div>`
      : '<div class="card done"><div class="q">Nimic de repetat acum</div><p class="hint">Mărește limita de carduri noi, alege alt capitol sau treci la Cazuri.</p></div>';
    refreshStats(); return;
  }
  const c = byId[cur];
  if (!c) { cur = queue.shift() || null; return renderCard(); }
  const s = store.s[cur], p = previewIntervals(s), st = status(cur);
  box.innerHTML = `<div class="card">
    <div class="meta"><span>${esc(SECTIONS[c[1]][0])} · ${esc(SECTIONS[c[1]][1])}</span><span><span class="pill p-${st}">${st === 'new' ? 'NOU' : st === 'mat' ? 'CONSOLIDAT' : 'ÎN ÎNVĂȚARE'}</span> · ${queue.length} rămase</span></div>
    <div class="q">${esc(c[2])}</div>
    ${shown ? `<div class="a">${esc(c[3])}</div>
      <div class="grades">
        <button class="g-again" data-g="0">Din nou<small>10m · 1</small></button>
        <button class="g-hard" data-g="1">Greu<small>${fmt(p.hard)} · 2</small></button>
        <button class="g-good" data-g="2">Bine<small>${fmt(p.good)} · 3</small></button>
        <button class="g-easy" data-g="3">Ușor<small>${fmt(p.easy)} · 4</small></button>
      </div>` : '<button class="btn primary" id="show">Arată răspunsul</button><p class="hint">Răspunde întâi cu voce tare sau pe hârtie.</p>'}
  </div>`;
  const sb = $('#show'); if (sb) sb.onclick = () => { shown = true; renderCard(); };
  box.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => doGrade(+b.dataset.g)));
}
function doGrade(g) {
  if (!cur || !shown) return;
  grade(cur, g); reviewed++;
  if (g === 0) queue.splice(Math.min(3, queue.length), 0, cur);
  cur = queue.shift() || null; shown = false; renderCard(); refreshStats();
}
$('#start').onclick = () => { started = true; queue = buildQueue(secSel.value); reviewed = 0; cur = queue.shift() || null; shown = false; renderCard(); };
document.addEventListener('keydown', (e) => {
  if ($('#tab-review').hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !$('#modal').hidden) return;
  if (e.code === 'Space' && cur && !shown) { e.preventDefault(); shown = true; renderCard(); }
  else if (shown && ['1', '2', '3', '4'].includes(e.key)) { doGrade(+e.key - 1); }
});

/* ---------- tabs ---------- */
const onShow = {};
function showTab(name) {
  $$('nav.tabs button').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === name));
  $$('section.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  onShow[name]?.();
  try { localStorage.setItem('semio-tab', name); } catch (e) { /* ignore */ }
}
$$('nav.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
function chOptions(sel, { all = false, unassigned = false } = {}) {
  const v = sel.value;
  const list = viewChapters();
  sel.innerHTML = (all ? '<option value="">Toate capitolele</option>' : '') +
    list.map((k) => `<option value="${k}">${esc(CHAPTERS[k])}</option>`).join('') +
    (unassigned && GQ.some((x) => !x.ch && x.sj === CUR) ? '<option value="__none">— Banca de grile (fără capitol încă)</option>' : '') +
    (!all && !list.length ? '<option value="">Niciun capitol încă</option>' : '');
  if ([...sel.options].some((o) => o.value === v)) sel.value = v;
}

/* ---------- cases ---------- */
let caseRight = 0, caseDone = 0;
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const caseList = () => CASES.filter((c) => chSubj(c.ch) === CUR && (!$('#case-ch').value || c.ch === $('#case-ch').value));
function renderCases() {
  const list = caseList();
  caseRight = 0; caseDone = 0;
  const order = shuffle(list.map((_, i) => i));
  $('#cases').innerHTML = order.map((ci, n) => { const c = list[ci]; return `<div class="case" data-c="${ci}">
    <b>${n + 1}.</b> ${esc(c.q)}
    <div class="opts">${c.o.map((o, k) => `<button data-k="${k}">${esc(o)}</button>`).join('')}</div>
    <div class="why" hidden>${esc(c.w)}</div></div>`; }).join('') || '<p class="hint">Încă nu sunt cazuri aici. Alege un capitol și apasă „Scrie 10 cazuri noi”.</p>';
  $('#cases').querySelectorAll('.case').forEach((el) => {
    el.querySelectorAll('.opts button').forEach((btn) => (btn.onclick = () => {
      if (el.dataset.done) return; el.dataset.done = 1;
      const c = list[+el.dataset.c], k = +btn.dataset.k;
      el.querySelectorAll('.opts button')[c.a]?.classList.add('right');
      if (k !== c.a) btn.classList.add('wrong'); else caseRight++;
      caseDone++; el.querySelector('.why').hidden = false; updScore();
    }));
  });
  updScore();
}
function updScore() { $('#case-score').textContent = caseDone ? `Scor: ${caseRight}/${caseDone}` : `${caseList().length} cazuri`; }
$('#case-shuffle').onclick = renderCases;
$('#case-ch').onchange = () => { renderCases(); aiButtons(); };

/* ---------- exam questions (grile) ---------- */
function gstat(id) { return (store.g && store.g[id]) || null; }
function gRecord(id, ok) {
  store.g = store.g || {};
  const s = store.g[id] || [0, 0, 0];
  s[0]++; if (ok) s[1]++; s[2] = ok ? 1 : 0;
  store.g[id] = s; scheduleSave();
}
const gFilt = { ch: $('#g-ch'), src: $('#g-src'), type: $('#g-type'), wrong: $('#g-wrong'), fixed: $('#g-fixed') };
gFilt.ch.innerHTML = '<option value="I">I</option>';
function fillGFilters() {
  chOptions(gFilt.ch, { all: true, unassigned: true });
  const src = gFilt.src.value;
  gFilt.src.innerHTML = '<option value="">Toate sursele</option>' + Object.entries(SOURCES).filter(([k]) => GQ.some((x) => x.src === k && x.sj === CUR)).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  if ([...gFilt.src.options].some((o) => o.value === src)) gFilt.src.value = src;
}
function gPool() {
  return GQ.filter((x) => x.sj === CUR &&
    (!gFilt.ch.value || (gFilt.ch.value === '__none' ? !x.ch : x.ch === gFilt.ch.value)) &&
    (!gFilt.src.value || x.src === gFilt.src.value) &&
    (!gFilt.type.value || (gFilt.type.value === 's' ? x.k.length === 1 : x.k.length > 1)) &&
    (!gFilt.wrong.checked || (gstat(x.id) && gstat(x.id)[2] === 0)) &&
    (!gFilt.fixed.checked || x.m || (x.n && x.src !== 'new' && x.src !== 'ai')));
}
function gRenderStats() {
  const target = getSettings().target;
  $('#g-stats').innerHTML = viewChapters().map((k) => {
    const all = GQ.filter((x) => x.ch === k);
    const done = all.filter((x) => gstat(x.id));
    const right = done.filter((x) => gstat(x.id)[2] === 1).length;
    const pct = done.length ? Math.round(100 * right / done.length) : 0;
    return `<div class="gstat"><span>${esc(CHAPTERS[k])}</span><b>${done.length}/${all.length}</b><div class="bar"><i style="width:${done.length ? pct : 0}%"></i></div><small>${done.length ? pct + '% corecte la ultima încercare' : 'neînceput'}${all.length < target ? ` · lipsesc ${target - all.length} până la ${target}` : ''}</small></div>`;
  }).join('');
  $('#g-count').textContent = gPool().length + ' grile găsite';
}
Object.values(gFilt).forEach((el) => el.addEventListener('change', gRenderStats));

let gMode = null, gList = [], gPos = 0, gSel = new Set(), gChecked = false, gAns = {};
function gStart(mode) {
  const pool = gPool();
  if (!pool.length) { $('#gq').innerHTML = '<div class="card done"><div class="q">Nicio grilă pentru aceste filtre</div><p class="hint">Alege alt capitol sau altă sursă, ori debifează „Doar greșelile mele”.</p></div>'; return; }
  gMode = mode; gPos = 0; gAns = {};
  gList = shuffle(pool).slice(0, mode === 'exam' ? Math.min(+$('#g-n').value || 30, pool.length) : pool.length).map((x) => x.id);
  gSel = new Set(); gChecked = false; gRender();
}
const letters = (arr) => arr.map((i) => 'abcde'[i]).join(', ');
function gNoteHtml(x) {
  let note = x.n;
  if (!note && x.src === 'y21') note = 'Sursa nu avea cheie; cheia este stabilită după cursul din 2022.';
  if (!note && x.ch === 'X' && BASE_SRC.has(x.src)) note = 'Cheia este cea din material. Capitolul e într-un volum ulterior, deci nu a fost verificat față de cursul tău.';
  const badge = x.m ? '<span class="pill p-learn">CHEIE CORECTATĂ</span> ' : '';
  const expl = x.e ? `<div class="why gnote">${esc(x.e)}</div>` : '';
  return (note ? `<div class="why gnote">${badge}${esc(note)}</div>` : (x.m ? `<div class="why gnote">${badge}</div>` : '')) + expl;
}
function gRender() {
  const box = $('#gq');
  if (gMode === 'exam' && gPos >= gList.length) return gExamResult();
  if (gMode === 'practice' && gPos >= gList.length) { box.innerHTML = `<div class="card done"><div class="q">Ai parcurs toate cele ${gList.length} grile</div><p class="hint">Bifează „Doar greșelile mele” și reia ca să le repeți pe cele greșite.</p></div>`; gRenderStats(); return; }
  const x = GQ_BY[gList[gPos]];
  if (!x) { gList.splice(gPos, 1); return gRender(); }
  const multi = x.k.length > 1;
  const sel = gMode === 'exam' ? new Set(gAns[x.id] || []) : gSel;
  const show = gMode === 'practice' && gChecked;
  const opts = x.o.map((o, i) => {
    let cls = sel.has(i) ? 'on' : '';
    if (show) { const ok = x.k.includes(i); cls = ok ? (sel.has(i) ? 'right' : 'missed') : (sel.has(i) ? 'wrong' : ''); }
    return `<button class="gopt ${cls}" data-i="${i}" ${show ? 'disabled' : ''}><span class="gl">${'abcde'[i]}</span><span>${esc(o)}</span></button>`;
  }).join('');
  let verdict = '';
  if (show) {
    const ok = sameSet(sel, x.k);
    const part = !ok && x.k.some((i) => sel.has(i));
    verdict = `<div class="gverdict ${ok ? 'ok' : part ? 'part' : 'bad'}">${ok ? 'Corect' : part ? 'Parțial corect' : 'Greșit'} · răspuns: <b>${letters(x.k)}</b></div>${gNoteHtml(x)}`;
  }
  box.innerHTML = `<div class="card">
    <div class="meta"><span>${esc(CHAPTERS[x.ch] || 'Fără capitol încă')} · ${esc(SOURCES[x.src] || '')}</span><span>${gPos + 1} / ${gList.length}</span></div>
    <div><span class="pill ${multi ? 'p-new' : 'p-mat'}">${multi ? 'COMPLEMENT MULTIPLU · 2–5 răspunsuri' : 'COMPLEMENT SIMPLU · 1 răspuns'}</span>${x.src === 'ai' ? ' <span class="pill p-ai">SCRISĂ DE AI</span>' : ''}</div>
    <div class="q">${esc(x.q)}</div>
    <div class="gopts">${opts}</div>
    ${verdict}
    <div class="controls" style="margin:0">
      ${gMode === 'practice' ? (show ? '<button class="btn primary" id="g-next">Următoarea →</button>' : '<button class="btn primary" id="g-check">Verifică</button>')
        : `<button class="btn" id="g-prev" ${gPos ? '' : 'disabled'}>← Înapoi</button><button class="btn primary" id="g-next">${gPos === gList.length - 1 ? 'Termină examenul' : 'Următoarea →'}</button><span class="hint">${Object.keys(gAns).length} răspunse</span>`}
      <button class="btn" id="g-stop">Oprește</button>
    </div>
    <p class="hint" style="margin:0">Taste: 1–5 aleg variantele, Enter verifică sau trece mai departe.</p>
  </div>`;
  box.querySelectorAll('.gopt').forEach((b) => (b.onclick = () => gToggle(+b.dataset.i)));
  const ck = $('#g-check'); if (ck) ck.onclick = gCheck;
  const nx = $('#g-next'); if (nx) nx.onclick = gNext;
  const pv = $('#g-prev'); if (pv) pv.onclick = () => { gPos--; gRender(); };
  $('#g-stop').onclick = () => { if (gMode === 'exam' && Object.keys(gAns).length) { gList = gList.filter((id) => gAns[id]); return gExamResult(); } gMode = null; box.innerHTML = ''; gRenderStats(); };
}
function sameSet(set, arr) { return set.size === arr.length && arr.every((i) => set.has(i)); }
function gToggle(i) {
  const x = GQ_BY[gList[gPos]]; const multi = x.k.length > 1;
  if (gMode === 'practice') {
    if (gChecked) return;
    if (!multi) { gSel = new Set(gSel.has(i) ? [] : [i]); } else { gSel.has(i) ? gSel.delete(i) : gSel.add(i); }
  } else {
    const s = new Set(gAns[x.id] || []);
    if (!multi) { s.clear(); if (!(gAns[x.id] || []).includes(i)) s.add(i); } else { s.has(i) ? s.delete(i) : s.add(i); }
    if (s.size) gAns[x.id] = [...s]; else delete gAns[x.id];
  }
  gRender();
}
function gCheck() {
  if (!gSel.size) return;
  const x = GQ_BY[gList[gPos]];
  gChecked = true; gRecord(x.id, sameSet(gSel, x.k)); gRender();
}
function gNext() {
  if (gMode === 'practice') { gPos++; gSel = new Set(); gChecked = false; gRender(); gRenderStats(); }
  else { gPos++; gRender(); }
}
function gExamResult() {
  let right = 0;
  const rows = gList.filter((id) => GQ_BY[id]).map((id) => {
    const x = GQ_BY[id]; const a = new Set(gAns[id] || []); const ok = sameSet(a, x.k);
    if (ok) right++;
    gRecord(id, ok);
    return { x, a, ok };
  });
  const pct = rows.length ? Math.round(100 * right / rows.length) : 0;
  const wrong = rows.filter((r) => !r.ok);
  $('#gq').innerHTML = `<div class="card">
    <div class="q">Rezultat: ${right} / ${rows.length} corecte (${pct}%)</div>
    <p class="hint">O grilă contează doar dacă ai ales exact variantele corecte, cum se punctează complementul multiplu la majoritatea examenelor.</p>
    ${wrong.length ? `<h3>Revizuiește cele ${wrong.length} greșite</h3>` + wrong.map((r) => `<div class="case"><b>${esc(r.x.q)}</b>
      <div class="opts">${r.x.o.map((o, i) => `<div class="gopt ${r.x.k.includes(i) ? (r.a.has(i) ? 'right' : 'missed') : (r.a.has(i) ? 'wrong' : '')}"><span class="gl">${'abcde'[i]}</span><span>${esc(o)}</span></div>`).join('')}</div>
      <div class="gverdict bad">Răspunsul tău: <b>${r.a.size ? letters([...r.a].sort()) : '—'}</b> · corect: <b>${letters(r.x.k)}</b></div>${gNoteHtml(r.x)}</div>`).join('') : '<p>Nicio greșeală. Încearcă un examen mai mare sau alt capitol.</p>'}
    <div class="controls"><button class="btn primary" id="g-again">Examen nou</button></div>
  </div>`;
  $('#g-again').onclick = () => gStart('exam');
  gMode = null; gRenderStats();
}
$('#g-practice').onclick = () => gStart('practice');
$('#g-exam').onclick = () => gStart('exam');
document.addEventListener('keydown', (e) => {
  if ($('#tab-grile').hidden || !gMode || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !$('#modal').hidden) return;
  if (['1', '2', '3', '4', '5'].includes(e.key)) { const i = +e.key - 1; const x = GQ_BY[gList[gPos]]; if (x && i < x.o.length) gToggle(i); }
  else if (e.key === 'Enter') { e.preventDefault(); if (gMode === 'practice') { gChecked ? gNext() : gCheck(); } else gNext(); }
});

/* =====================================================================
   NOU: dialog, notificări, job-uri
   ===================================================================== */
function ask(text, { input = null, ok = 'OK', cancel = 'Renunță' } = {}) {
  return new Promise((resolve) => {
    const m = $('#modal'), inp = $('#modal-input');
    $('#modal-text').textContent = text;
    inp.hidden = input === null; inp.value = input ?? '';
    $('#modal-yes').textContent = ok; $('#modal-no').textContent = cancel;
    m.hidden = false;
    (input === null ? $('#modal-yes') : inp).focus();
    const done = (v) => { m.hidden = true; $('#modal-yes').onclick = $('#modal-no').onclick = inp.onkeydown = null; resolve(v); };
    $('#modal-yes').onclick = () => done(input === null ? true : inp.value.trim() || null);
    $('#modal-no').onclick = () => done(input === null ? false : null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('#modal-yes').click(); if (e.key === 'Escape') { e.preventDefault(); $('#modal-no').click(); } };
  });
}
function toast(msg, ms = 4500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
const jobs = [];
function renderJobs() {
  $('#jobs').hidden = !jobs.length;
  const running = jobs.filter((j) => j.state === 'run').length;
  $('#jobs-count').textContent = running ? `${running} în lucru` : '';
  $('#jobs-list').innerHTML = jobs.slice().reverse().map((j) => `<div class="job ${j.state}">
    <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${esc(j.title)}</b>${j.state === 'run' ? `<button class="btn small" data-abort="${j.id}">Oprește</button>` : ''}</div>
    <div class="st">${esc(j.text)}</div>${j.state === 'run' && j.frac != null ? `<div class="bar"><i style="width:${Math.round(j.frac * 100)}%"></i></div>` : ''}</div>`).join('');
}
$('#jobs').addEventListener('click', (e) => { const id = e.target.dataset.abort; if (id) jobs.find((j) => j.id === id)?.ctrl.abort(); });
$('#jobs-min').onclick = () => $('#jobs').classList.toggle('min');
$('#jobs-close').onclick = () => { for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state !== 'run') jobs.splice(i, 1); renderJobs(); };
async function runJob(title, fn, kind = 'ai') {
  const job = { id: uid('j'), title, kind, state: 'run', text: 'Pornesc…', frac: null, ctrl: new AbortController() };
  jobs.push(job); renderJobs();
  const api = { signal: job.ctrl.signal, status: (t) => { job.text = t; renderJobs(); }, progress: (f) => { job.frac = f; renderJobs(); } };
  try { job.text = (await fn(api)) || 'Gata.'; job.state = 'done'; }
  catch (err) {
    console.error(err);
    job.state = 'err';
    job.text = job.ctrl.signal.aborted || err?.code === 'cancelled' ? 'Oprit.' : 'Problemă: ' + (err?.message || err);
  }
  renderJobs(); refreshAll();
  if (job.state === 'done') setTimeout(() => { const k = jobs.indexOf(job); if (k >= 0) { jobs.splice(k, 1); renderJobs(); } }, 8000);
  return job.state === 'done';
}

/* =====================================================================
   NOU: capabilitățile paginii Claude
   ===================================================================== */
const R = { db: null, user: null, sample: null, tts: null, dl: null, canWrite: false, ready: false, uid: null, images: null, isOwner: false };
function aiReady() { return !!(R.sample && R.db && R.canWrite); }
function needAI() {
  if (aiReady()) return false;
  if (!R.ready) toast('Încă mă conectez la Claude… încearcă din nou peste câteva clipe.');
  else if (!R.db) toast('Deschide pagina în Claude (autentificat) ca să adaugi material și să folosești funcțiile AI.');
  else if (!R.canWrite) toast('Poți învăța tot ce e aici, dar doar cei cu drept de editare pot adăuga material. Cere proprietarului acces de Contributor.');
  else toast('Claude nu este disponibil în această vizualizare.');
  return true;
}
function aiErr(e) {
  const map = {
    not_granted: 'Nu ai permis paginii să folosească Claude. Reîncarcă pagina ca să fii întrebat din nou.',
    rate_limited: 'Ai atins deocamdată limita de utilizare Claude. Încearcă mai târziu.',
    sampling_disabled: 'Claude nu este disponibil pentru acest cont.',
    prompt_too_large: 'Materialul trimis e prea mare. Împarte sursa în fișiere mai mici.',
    refused: 'Claude a refuzat cererea. Încearcă alt material.',
    invalid_json: 'Răspunsul lui Claude nu a putut fi citit. Încearcă din nou.',
    session_expired: 'Sesiunea Claude a expirat. Autentifică-te din nou.',
    empty_completion: 'Claude nu a răspuns nimic. Încearcă din nou.',
  };
  const err = new Error(map[e?.code] || e?.message || 'Claude nu a putut răspunde. Încearcă din nou.');
  err.code = e?.code;
  return err;
}
// Un apel către Claude care întoarce JSON. `tier`: quick | default | complex.
async function askJSON(prompt, { signal, onChars, tier = 'default' } = {}) {
  if (!R.sample) throw new Error('Claude nu este disponibil în această vizualizare.');
  try {
    return await R.sample.json(prompt, { signal, modelTier: tier, cache: false, onText: onChars ? ({ text }) => onChars(text.length) : undefined });
  } catch (e) { throw aiErr(e); }
}
async function askText(prompt, { signal, onText, tier = 'default', images } = {}) {
  if (!R.sample) throw new Error('Claude nu este disponibil în această vizualizare.');
  try {
    const r = await R.sample(prompt, { signal, modelTier: tier, cache: false, onText: onText ? ({ text }) => onText(text) : undefined, ...(images ? { images } : {}) });
    return r.text;
  } catch (e) { throw aiErr(e); }
}

/* ---------- stocarea comună (db) ---------- */
const COLLS = { sources: 'sources', chapters: 'chapters', grilePacks: 'grile', cardPacks: 'cards', outputs: 'outputs' };
function upsertLocal(key, doc) { const arr = U[key]; const i = arr.findIndex((x) => x.id === doc.id); if (i >= 0) arr[i] = doc; else arr.push(doc); }
async function put(key, doc) {
  upsertLocal(key, doc); rebuild();
  const { id, ...body } = doc;
  try { await R.db.collection(COLLS[key]).doc(id).set(JSON.parse(JSON.stringify(body))); }
  catch (e) {
    if (e?.code === 'invalid_argument' && !R.canWriteConfirmed) { R.canWrite = false; refreshAll(); }
    throw new Error(e?.code === 'quota_exceeded' ? 'Spațiul comun al paginii e plin. Șterge niște surse sau capitole.' : (e?.message || 'Nu s-a putut salva.'));
  }
  R.canWriteConfirmed = true;
}
async function del(key, id) {
  U[key] = U[key].filter((x) => x.id !== id); rebuild();
  await R.db.collection(COLLS[key]).doc(id).delete();
}
let refreshTimer = null;
const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAll, 150); };
function subscribe() {
  for (const [key, coll] of Object.entries(COLLS)) {
    R.db.collection(coll).onSnapshot((snap) => {
      U[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rebuild(); refreshSoon();
      if (key === 'sources' && !R.firstSources) { R.firstSources = true; if (R.isOwner) setTimeout(autoProcess, 1500); }
    }, (e) => { console.warn('db', coll, e); });
  }
}
// Textul surselor stă în bucăți de câte 150 de blocuri (un document ≤ 256 KiB).
const CHUNK = 150;
const blockCache = new Map();
async function sourceBlocks(id) {
  if (blockCache.has(id)) return blockCache.get(id);
  const snap = await R.db.collection(`sources/${id}/chunks`).get();
  const blocks = snap.docs.map((d) => d.data()).sort((a, b) => a.n - b.n).flatMap((d) => d.blocks || []);
  blockCache.set(id, blocks);
  return blocks;
}

async function initRuntime() {
  if (!window.claude?.use) { R.ready = true; refreshAll(); return; }
  const use = (n) => window.claude.use(n).catch(() => null);
  [R.db, R.user, R.sample, R.tts, R.dl] = await Promise.all(['db', 'user', 'sample', 'tts', 'downloads'].map(use));
  if (R.user) {
    const can = await R.user.can?.('data.write').catch(() => null);
    R.canWrite = can !== false;
    R.uid = await R.user.id?.().catch(() => null);
    R.isOwner = !!(await R.user.isOwner?.().catch(() => false));
  }
  if (R.sample) R.images = (await R.sample.limits?.().catch(() => null))?.images || null;
  R.ready = true;
  if (R.db) {
    subscribe();
    if (R.uid) {
      try {
        remoteDoc = R.db.doc('data/users/' + R.uid + '/progress');
        const snap = await remoteDoc.get();
        const r = snap.exists ? snap.data() : null;
        if (r && r.s && (r.updated || 0) > (store.updated || 0)) { store = JSON.parse(JSON.stringify(r)); if (!store.g) store.g = {}; lsWrite(); }
        else if (store.updated) flush();
        syncEl.textContent = 'Progres: sincronizat cu contul tău';
      } catch (e) { remoteDoc = null; }
    }
  }
  refreshAll();
}

/* =====================================================================
   NOU: citirea fișierelor
   ===================================================================== */
const CDN = {
  pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
};
const loaded = {};
function loadScript(src) {
  return (loaded[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Nu s-a putut încărca cititorul de fișiere. Verifică conexiunea.')); document.head.appendChild(s); }));
}
async function pdfLib() {
  // Lucrătorul pdf.js rulează în pagină (globalThis.pdfjsWorker), fără Web Worker separat.
  await loadScript(CDN.pdfWorker); await loadScript(CDN.pdf);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  return window.pdfjsLib;
}
function fileKind(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (/\.(png|jpe?g|webp|gif)$/.test(n)) return 'image';
  if (/\.(html?|xhtml)$/.test(n)) return 'html';
  return 'text';
}
async function extractText(file, onProgress) {
  const kind = fileKind(file);
  if (kind === 'pdf') {
    const lib = await pdfLib();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let out = '';
      for (const it of content.items) out += it.str + (it.hasEOL ? '\n' : (it.str.endsWith(' ') ? '' : ' '));
      pages.push(out.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim());
      onProgress(i / pdf.numPages);
    }
    return { text: pages.join('\n\n'), pages: pdf.numPages, pdf };
  }
  if (kind === 'docx') { await loadScript(CDN.mammoth); return { text: (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value }; }
  if (kind === 'html') { const d = new DOMParser().parseFromString(await file.text(), 'text/html'); return { text: d.body.innerText || d.body.textContent || '' }; }
  if (kind === 'image') return { text: '' };
  return { text: await file.text() };
}
// Pagini scanate / poze → imagini trimise lui Claude pentru transcriere.
async function pdfPagesToImages(pdf, from, to) {
  const out = [];
  for (let i = from; i <= to; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)));
  }
  return out;
}
async function transcribe(images, job, label) {
  if (!R.images) throw new Error('Această vizualizare nu poate trimite imagini lui Claude, deci paginile scanate nu pot fi citite aici. Folosește un PDF cu text selectabil.');
  const per = Math.max(1, Math.min(R.images.maxCount || 1, 5));
  let text = '';
  for (let i = 0; i < images.length; i += per) {
    job.status(`${label}: transcriu paginile ${i + 1}–${Math.min(i + per, images.length)} din ${images.length}…`);
    job.progress(i / images.length);
    text += '\n\n' + await askText('These are photos/scans of pages from a medical course or a question bank (in Romanian). Transcribe ALL the text faithfully, in the original language, in reading order, keeping headings, numbering, lists, answer options and any answer keys. Write tables as Markdown tables. Output only the transcription, with no comments.', { signal: job.signal, images: images.slice(i, i + per) });
  }
  return text.trim();
}
function splitBlocks(text, target = 700) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; let cur = '';
  for (const line of lines) {
    if (cur.length + line.length > target * 1.6 && cur.length) { blocks.push(cur.trim()); cur = ''; }
    if (line.length > target * 2.5) { // un rând uriaș (fără rupturi) se taie
      for (let i = 0; i < line.length; i += target) blocks.push(line.slice(i, i + target).trim());
      continue;
    }
    cur += line + '\n';
    if (cur.length >= target && /[.:;!?)]\s*$/.test(line)) { blocks.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) blocks.push(cur.trim());
  return blocks.filter(Boolean);
}
function chunkBlocks(blocks, maxChars, overlap = 0) {
  const chunks = []; let cur = [], len = 0;
  for (const b of blocks) {
    if (len + b.length > maxChars && cur.length) { chunks.push(cur.join('\n')); cur = overlap ? cur.slice(-overlap) : []; len = cur.reduce((s, x) => s + x.length + 1, 0); }
    cur.push(b); len += b.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}

/* =====================================================================
   NOU: capitole pentru AI
   ===================================================================== */
const MAX_MATERIAL = 120000; // caractere de curs trimise într-un apel (limita unui apel e ~256 KiB)
const chGrile = (ch) => GQ.filter((x) => x.ch === ch);
const chCards = (ch) => CARDS.filter((c) => SECTION_CH[c[1]] === ch);
const sectionTitles = (ch) => sectionsOf(ch).map((k) => SECTIONS[k][0]);
const hasMaterial = (ch) => (chMeta(ch)?.ranges || []).length > 0;
function topicsOf(ch) { const t = sectionTitles(ch); return t.length ? t : (chMeta(ch)?.topics || []); }
// Textul de curs al capitolului; `part` alege a câta felie de MAX_MATERIAL (pentru capitole mari).
async function chapterMaterial(ch, part = 0) {
  const m = chMeta(ch);
  let t = '';
  for (const r of m?.ranges || []) {
    const src = U.sources.find((s) => s.id === r.sourceId); if (!src) continue;
    const blocks = await sourceBlocks(src.id);
    t += `\n\n### ${src.name}\n` + blocks.slice(Math.max(0, r.fromBlock), r.toBlock + 1).join('\n');
  }
  t = t.trim();
  if (!t) {
    const ref = chGrile(ch).slice(0, 220).map((x) => `- ${x.q} → ${x.k.map((i) => x.o[i]).join('; ')}`).join('\n') + '\n' +
      chCards(ch).slice(0, 220).map((c) => `- ${c[2]} → ${c[3].replace(/\n/g, ' ')}`).join('\n');
    return { text: '(No course text was uploaded for this chapter. Use the existing questions and cards below as the syllabus, completed with standard medical knowledge; mark anything beyond them with "(completare)".)\n\n' + ref.slice(0, MAX_MATERIAL), parts: 1 };
  }
  const parts = Math.max(1, Math.ceil(t.length / MAX_MATERIAL));
  const i = ((part % parts) + parts) % parts;
  return { text: t.slice(i * MAX_MATERIAL, (i + 1) * MAX_MATERIAL), parts };
}
function chapterHeader(ch) { return `CAPITOL: ${CHAPTERS[ch]}\nSubteme: ${topicsOf(ch).join('; ')}`; }
function sanitizeQ(q) {
  const options = (q.options || q.o || []).map((o) => String(o).replace(/^\s*[A-Ea-e][.)]\s*/, '').trim()).filter(Boolean).slice(0, 5);
  const correct = [...new Set((q.correct || q.k || []).map(Number))].filter((c) => Number.isInteger(c) && c >= 0 && c < options.length).sort();
  const stem = String(q.stem || q.q || '').trim();
  if (options.length < 2 || !correct.length || !stem) return null;
  return { q: stem, o: options, k: correct, e: String(q.explanation || '').trim(), t: String(q.topic || '') };
}
const qText = (x, i) => `${i + 1}. (${x.k.length > 1 ? 'CM' : 'CS'}) ${x.q}\n${x.o.map((o, k) => `${'ABCDE'[k]}. ${o}`).join('\n')}\nRăspuns: ${x.k.map((k) => 'ABCDE'[k]).join(', ')}`;
const Q_JSON = '{"questions":[{"type":"CS" sau "CM","stem":"enunț","options":["A","B","C","D","E" – exact 5 variante, fără litere],"correct":[indici 0-4],"explanation":"1-3 fraze","topic":"subtema"}]}';

/* ---------- segmentare ---------- */
async function segmentNew(job, mats) {
  let created = 0, attached = 0; const createdIds = [], touched = new Set();
  for (const src of mats) {
    const blocks = await sourceBlocks(src.id);
    // bucăți de ~MAX_MATERIAL caractere numerotate pe blocuri
    const groups = []; let g = [], len = 0;
    blocks.forEach((b, i) => { if (len + b.length > MAX_MATERIAL && g.length) { groups.push(g); g = []; len = 0; } g.push(i); len += b.length + 8; });
    if (g.length) groups.push(g);
    for (let gi = 0; gi < groups.length; gi++) {
      job.status(`Împart „${src.name}” pe capitole (${gi + 1}/${groups.length})…`);
      const ids = groups[gi];
      const sj = srcSubj(src) || CUR;
      const existing = CH_ORDER.filter((id) => chSubj(id) === sj).map((id) => `- ${id}: ${CHAPTERS[id]}${topicsOf(id).length ? ' (' + topicsOf(id).slice(0, 8).join('; ') + ')' : ''}`).join('\n');
      const res = await askJSON(
        `Ești profesor universitar de medicină și organizezi materia de examen la ${SUBJ_BY[sj].label}. Mai jos e un fragment dintr-o sursă de curs, împărțit în blocuri numerotate [§n].\n` +
        'Împarte fragmentul în capitole de studiu coerente, în ordinea predării. Un capitol trebuie să fie suficient de bogat pentru ~100 de grile (de regulă un capitol/curs din material); nu fragmenta excesiv.\n' +
        'Aplicația are deja capitolele de mai jos. Dacă o parte din fragment ține de un capitol existent (inclusiv continuarea unui capitol început într-un fragment anterior), pune cheia lui în "existing"; altfel "existing" = "".\n' +
        'Intervalele sunt inclusive și folosesc numerele blocurilor; acoperă tot conținutul util, ignoră cuprinsul și bibliografia. Titlurile, rezumatele și subtemele în limba română; "topics" = 5-15 subteme concrete.\n' +
        (($('#seg-hint').value || '').trim() ? `Indicații de la student: ${$('#seg-hint').value.trim()}\n` : '') +
        `\nCAPITOLE EXISTENTE:\n${existing}\n\nRăspunde doar cu JSON: {"chapters":[{"title":"…","existing":"cheie sau \\"\\"","summary":"1-2 fraze","topics":["…"],"fromBlock":n,"toBlock":n}]}\n\n` +
        `<sursa nume="${src.name}">\n` + ids.map((i) => `[§${i}] ${blocks[i]}`).join('\n') + '\n</sursa>',
        { signal: job.signal, tier: 'complex', onChars: (n) => job.status(`Împart „${src.name}” (${gi + 1}/${groups.length})… ${n} caractere primite`) });
      for (const c of res.chapters || []) {
        const from = Math.max(ids[0], Math.min(+c.fromBlock, +c.toBlock)), to = Math.min(ids[ids.length - 1], Math.max(+c.fromBlock, +c.toBlock));
        if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
        const range = { sourceId: src.id, fromBlock: from, toBlock: to };
        const ex = c.existing && CHAPTERS[c.existing] && chSubj(c.existing) === sj ? c.existing : null;
        if (ex) {
          const m = chMeta(ex) || { id: ex, title: BASE.CHAPTERS[ex] || CHAPTERS[ex], summary: '', topics: [], ranges: [], sections: {}, order: 0 };
          const next = { ...m, ranges: [...(m.ranges || []), range], topics: [...new Set([...(m.topics || []), ...(c.topics || [])])], summary: m.summary || c.summary || '' };
          await put('chapters', next); attached++; touched.add(ex);
        } else {
          const sections = {}; for (const t of c.topics || []) sections[uid('s')] = t;
          const nid = uid('ch');
          await put('chapters', { id: nid, subject: sj, title: String(c.title || 'Capitol nou'), summary: String(c.summary || ''), topics: c.topics || [], ranges: [range], sections, order: Date.now() + created });
          created++; createdIds.push(nid); touched.add(nid);
        }
      }
    }
    await put('sources', { ...src, segmented: true });
  }
  segmentNew.createdIds = createdIds; segmentNew.touched = [...touched];
  return `${created} capitole noi, material adăugat la ${attached} existente`;
}

/* ---------- extragerea grilelor din bănci ---------- */
const srcNow = (id) => U.sources.find((s) => s.id === id);
async function extractBank(job, src, label = '') {
  const blocks = await sourceBlocks(src.id);
  const chunks = chunkBlocks(blocks, 20000, 1);
  const tail = blocks.join('\n').slice(-10000);
  // Grilele din bancă (Drive) nu intră în „Alte capitole": așteaptă capitolul lor.
  const sj = srcSubj(src);
  const ids = CH_ORDER.filter((id) => chSubj(id) === sj && !(src.pool && id === 'X'));
  const menu = ids.map((id, i) => `${i + 1}. ${CHAPTERS[id]} — subteme: ${topicsOf(id).slice(0, 12).join('; ')}`).join('\n');
  const seen = new Set(GQ.map((x) => normStem(x.q)));
  let added = src.extractedCount || 0;
  for (let i = src.doneChunks || 0; i < chunks.length; i++) {
    if (job.signal.aborted) throw new Error('Oprit.');
    job.status(`${label}Citesc grilele din „${src.name}” (partea ${i + 1}/${chunks.length})…`); job.progress(i / chunks.length);
    const res = await askJSON(
      'Extragi grile (întrebări cu răspuns multiplu) dintr-un document de examen de medicină, în română.\n' +
      'Reguli: (1) Copiază fidel enunțul și variantele (fără litera din față). (2) "correct" = indicii variantelor corecte (0=A … 4=E). Dacă documentul dă răspunsul/cheia, folosește-o și pune "answerSource":"cheie"; altfel deduce răspunsul din cunoștințele medicale și pune "answerSource":"dedus". ' +
      '(3) "chapter" = numărul capitolului din listă căruia îi aparține grila, DOAR dacă aparține clar acelui capitol (aceeași materie); altfel 0 — grila rămâne în bancă până apare capitolul ei. (4) "explanation" = 1-3 fraze. (5) Ignoră grilele tăiate la începutul/finalul fragmentului, întrebările deschise fără variante și textele care nu sunt grile. Nu inventa grile. (6) Ignoră grilele care nu sunt în limba română.\n' +
      (src.subject ? `MATERIA (după folderul sursei): ${src.subject}.\n` : '') + '\n' +
      `CAPITOLE:\n${menu || '(niciun capitol încă — pune "chapter": 0)'}\n\n` + (tail && i < chunks.length - 1 ? `FINALUL DOCUMENTULUI (poate conține cheia):\n${tail}\n\n` : '') +
      `FRAGMENTUL ${i + 1}/${chunks.length}:\n${chunks[i]}\n\n` +
      'Răspunde doar cu JSON: {"questions":[{"stem":"…","options":["…"],"correct":[0],"explanation":"…","topic":"…","chapter":n,"answerSource":"cheie"|"dedus"}]}',
      { signal: job.signal });
    const byCh = {};
    for (const raw of res.questions || []) {
      const q = sanitizeQ(raw); if (!q) continue;
      const k = normStem(q.q); if (seen.has(k)) continue; seen.add(k);
      const ch = ids[(+raw.chapter || 0) - 1] || '';
      (byCh[ch] ||= []).push({ id: uid('u'), ...q, n: raw.answerSource === 'dedus' ? 'Sursa nu dădea cheia acestei grile; cheia a fost stabilită de AI. Verific-o cu cursul.' : '', m: false });
    }
    for (const [ch, items] of Object.entries(byCh)) { await put('grilePacks', { id: uid('gp'), ch, src: src.id, subj: src.subject || '', items, createdAt: Date.now() }); added += items.length; }
    await put('sources', { ...(srcNow(src.id) || src), doneChunks: i + 1, nChunks: chunks.length, extractedCount: added });
  }
  await put('sources', { ...(srcNow(src.id) || src), extractedAt: Date.now(), extractedCount: added });
  return `„${src.name}”: ${added} grile noi (duplicatele sărite)`;
}

async function assignOrphans(job, focus = null) {
  const packs = U.grilePacks.filter((p) => !CHAPTERS[p.ch]);
  const all = packs.flatMap((p) => { const sj = subjOf(p.subj) || srcSubj(U.sources.find((x) => x.id === p.src)) || (p.subj ? null : 'semio-med'); return p.items.map((x) => ({ ...x, src: p.src, subj: p.subj || '', sj })); });
  const subjects = focus?.length ? [...new Set(focus.map(chSubj))] : SUBJECTS.map((x) => x.id);
  const moved = {};
  for (const sj of subjects) {
    const items = all.filter((x) => x.sj === sj);
    const ids = CH_ORDER.filter((id) => chSubj(id) === sj && id !== 'X');
    if (!items.length || !ids.length) continue;
    const menu = ids.map((id, i) => `${i + 1}. ${CHAPTERS[id]} — ${topicsOf(id).slice(0, 10).join('; ')}`).join('\n');
    for (let i = 0; i < items.length; i += 120) {
      const part = items.slice(i, i + 120);
      job.status(`${SUBJ_BY[sj].label}: potrivesc grilele din bancă cu capitolele (${Math.min(i + 120, items.length)}/${items.length})…`);
      const res = await askJSON(`Materia: ${SUBJ_BY[sj].label}. Asociază fiecare grilă capitolului căruia îi aparține clar (0 dacă niciunul — grila rămâne în bancă).\n\nCAPITOLE:\n${menu}\n\nGRILE:\n` +
        part.map((x, k) => `${k + 1}. ${x.q} | ${x.o.join(' | ')}`.slice(0, 400)).join('\n') + '\n\nRăspunde doar cu JSON: {"map":[{"q":n,"chapter":n}]}', { signal: job.signal, tier: 'quick' });
      for (const m of res.map || []) { const x = part[m.q - 1]; const ch = ids[m.chapter - 1]; if (x && ch) (moved[ch + '|' + x.src + '|' + x.subj] ||= []).push(x); }
    }
  }
  const movedIds = new Set(Object.values(moved).flat().map((x) => x.id));
  for (const [key, list] of Object.entries(moved)) { const [ch, src, subj] = key.split('|'); await put('grilePacks', { id: uid('gp'), ch, src, subj, items: list.map(({ src: _s, subj: _j, sj: _k, ...x }) => x), createdAt: Date.now() }); }
  for (const p of packs) { const rest = p.items.filter((x) => !movedIds.has(x.id)); if (rest.length !== p.items.length) rest.length ? await put('grilePacks', { ...p, items: rest }) : await del('grilePacks', p.id); }
  return movedIds.size;
}

/* ---------- generare ---------- */
async function fillOne(job, ch, target, batch, prefix = '') {
  let made = 0, fails = 0, part = 0;
  while (chGrile(ch).length < target && fails < 2) {
    if (job.signal.aborted) throw new Error('Oprit.');
    const have = chGrile(ch);
    const n = Math.min(batch, target - have.length);
    const pre = `${prefix}${CHAPTERS[ch]}: ${have.length}/${target}`;
    job.status(`${pre} — scriu ${n} grile…`); job.progress(have.length / target);
    const mat = await chapterMaterial(ch, part++);
    const cover = {}; for (const x of have) if (x.t) cover[x.t] = (cover[x.t] || 0) + 1;
    const res = await askJSON(
      'Ești profesor universitar de medicină și scrii grile pentru examenul de licență/rezidențiat, în română, în stilul grilelor oficiale: 5 variante (A-E), CS (complement simplu: exact 1 răspuns corect) sau CM (complement multiplu: 2-4 corecte). ' +
      'Grilele se bazează STRICT pe materialul de mai jos; testează noțiuni importante (definiții, clasificări, mecanisme, semne, diagnostic, tratament, valori numerice, excepții); distractori plauzibili; fără „toate/niciuna de mai sus”; ~40% CS, ~60% CM; dificultate variată. ' +
      '"explanation" justifică răspunsul cu referire la material. Nu repeta și nu reformula superficial grilele existente.\n\n' +
      `${chapterHeader(ch)}\n\nMATERIAL:\n${mat.text}\n\n` +
      `Acoperirea actuală pe subteme (favorizează-le pe cele slab acoperite): ${JSON.stringify(cover)}\n` +
      `GRILE EXISTENTE (nu le repeta):\n${have.slice(-150).map((x) => '- ' + x.q.slice(0, 140)).join('\n') || '(niciuna)'}\n\n` +
      `Scrie exact ${n} grile NOI. Răspunde doar cu JSON: ${Q_JSON}`,
      { signal: job.signal, onChars: (c) => job.status(`${pre} — scriu ${n} grile… ${c} caractere`) });
    const seen = new Set(have.map((x) => normStem(x.q)));
    const items = [];
    for (const raw of res.questions || []) { const q = sanitizeQ(raw); if (!q || seen.has(normStem(q.q))) continue; seen.add(normStem(q.q)); items.push({ id: uid('u'), ...q, n: '', m: false }); }
    if (!items.length) { fails++; continue; }
    await put('grilePacks', { id: uid('gp'), ch, src: 'ai', items, createdAt: Date.now() });
    made += items.length;
  }
  return made;
}
async function verifyKeys(job, ch) {
  const packs = U.grilePacks.filter((p) => p.ch === ch && p.src !== 'ai');
  const todo = packs.flatMap((p) => p.items.filter((x) => !x.verifiedAt).map((x) => ({ x, p })));
  if (!todo.length || !hasMaterial(ch)) return 'nicio cheie de verificat';
  const mat = await chapterMaterial(ch, 0);
  let changed = 0;
  for (let i = 0; i < todo.length; i += 30) {
    const part = todo.slice(i, i + 30);
    job.status(`Verific cheile față de curs (${Math.min(i + 30, todo.length)}/${todo.length})…`); job.progress(i / todo.length);
    const res = await askJSON(
      'Verifici cheile (răspunsurile corecte) ale unor grile față de MATERIALUL DE CURS, care are prioritate față de orice altă sursă. ' +
      'Pentru fiecare grilă: ok=true dacă cheia e corectă conform cursului; altfel ok=false, "correct" = indicii corecți conform cursului (0=A … 4=E) și "note" explică scurt diferența („Cheia din sursă: B; conform cursului corect este C, deoarece …”). ' +
      'Dacă materialul nu acoperă grila, ok=true și note="".\n\n' + `${chapterHeader(ch)}\n\nMATERIAL:\n${mat.text}\n\nGRILE:\n` + part.map((t, k) => qText(t.x, k)).join('\n\n') +
      '\n\nRăspunde doar cu JSON: {"results":[{"q":n,"ok":true,"correct":[0],"note":""}]}', { signal: job.signal, tier: 'complex' });
    const by = Object.fromEntries((res.results || []).map((r) => [r.q, r]));
    part.forEach((t, k) => {
      const r = by[k + 1]; t.x.verifiedAt = Date.now();
      if (!r || r.ok) { if (/set by the AI/.test(t.x.n || '')) t.x.n = 'Sursa nu dădea cheia; cheia a fost stabilită de AI și corespunde cursului.'; return; }
      const corr = [...new Set((r.correct || []).map(Number))].filter((c) => c >= 0 && c < t.x.o.length).sort();
      if (corr.length && corr.join() !== [...t.x.k].sort().join()) { t.x.k = corr; t.x.n = String(r.note || ''); t.x.m = true; changed++; }
    });
    for (const p of new Set(part.map((t) => t.p))) await put('grilePacks', { ...p, items: p.items.map((x) => ({ ...x })) });
  }
  return `${todo.length} chei verificate față de curs, ${changed} corectate`;
}
async function ensureSections(ch, names = []) {
  const m = chMeta(ch) || { id: ch, title: BASE.CHAPTERS[ch] || CHAPTERS[ch], summary: '', topics: [], ranges: [], sections: {}, order: 0 };
  const sections = { ...(m.sections || {}) };
  const existing = () => [...sectionTitles(ch), ...Object.values(sections)];
  const wanted = names.length ? names : (existing().length ? [] : (m.topics?.length ? m.topics : ['General']));
  let changed = !chMeta(ch);
  for (const n of wanted) if (!existing().some((t) => normStem(t) === normStem(n))) { sections[uid('s')] = n; changed = true; }
  if (changed) await put('chapters', { ...m, sections });
}
function sectionKeyFor(ch, name) {
  const secs = sectionsOf(ch), n = normStem(name);
  return secs.find((k) => normStem(SECTIONS[k][0]) === n) || secs.find((k) => normStem(SECTIONS[k][0]).includes(n) || n.includes(normStem(SECTIONS[k][0]))) || secs[0];
}
async function writeCards(job, ch, target) {
  await ensureSections(ch);
  let made = 0, fails = 0, part = 0;
  while (chCards(ch).length < target && fails < 2) {
    const have = chCards(ch);
    const n = Math.min(30, target - have.length);
    job.status(`${CHAPTERS[ch]}: ${have.length}/${target} carduri — scriu ${n}…`); job.progress(have.length / target);
    const mat = await chapterMaterial(ch, part++);
    const res = await askJSON(
      'Scrii flashcard-uri pentru repetiție spațiată, în română, pentru examenul de medicină. Reguli: o întrebare, un singur răspuns (un card cere UN lucru; listele lungi se sparg); carduri pe DISCRIMINATORI (ce deosebește semnele care se confundă); pragurile numerice primesc card propriu; mnemotehnici doar pentru liste arbitrare, în rest mecanismul; ' +
      'fața = întrebare scurtă, spatele = răspuns concis (2-5 rânduri separate prin \\n). "section" = una dintre subtemele date, scrisă exact. Bazează-te strict pe material.\n\n' +
      `${chapterHeader(ch)}\n\nMATERIAL:\n${mat.text}\n\nCARDURI EXISTENTE (nu le repeta):\n${have.slice(-150).map((c) => '- ' + c[2].slice(0, 110)).join('\n') || '(niciunul)'}\n\n` +
      `Scrie exact ${n} carduri NOI. Răspunde doar cu JSON: {"cards":[{"section":"subtema","front":"întrebare","back":"răspuns"}]}`,
      { signal: job.signal });
    const seen = new Set(have.map((c) => normStem(c[2])));
    const fresh = (res.cards || []).filter((c) => c.front && c.back && !seen.has(normStem(c.front)) && seen.add(normStem(c.front)));
    if (!fresh.length) { fails++; continue; }
    const missing = [...new Set(fresh.map((c) => c.section).filter((s) => s && !sectionsOf(ch).some((k) => normStem(SECTIONS[k][0]) === normStem(s))))];
    if (missing.length && sectionsOf(ch).length < 25) await ensureSections(ch, missing.slice(0, 5));
    await put('cardPacks', { id: uid('cp'), ch, items: fresh.map((c) => ({ id: uid('uc'), sec: sectionKeyFor(ch, c.section || ''), front: String(c.front).trim(), back: String(c.back).trim() })), createdAt: Date.now() });
    made += fresh.length;
  }
  return `${made} carduri`;
}
const latest = (ch, type) => U.outputs.filter((o) => o.ch === ch && o.type === type).sort((a, b) => b.createdAt - a.createdAt)[0];
async function saveOutput(ch, type, content, replace = false) {
  if (replace) for (const o of U.outputs.filter((o) => o.ch === ch && o.type === type)) await del('outputs', o.id);
  await put('outputs', { id: uid('o'), ch, type, content, createdAt: Date.now() });
}
async function writeCases(job, ch) {
  job.status(`${CHAPTERS[ch]}: scriu cazurile…`);
  const mat = await chapterMaterial(ch, CASES.filter((c) => c.ch === ch).length / 10);
  const res = await askJSON(
    'Scrii cazuri clinice scurte pentru antrenament, în română. Fiecare caz: o vignetă de 1-3 fraze (vârstă, context, semne concrete, valori), "o" = 4 variante plauzibile care se confundă (diagnostice sau interpretări), "a" = indicele corect (0-3), "w" = raționamentul în 1-3 fraze (ce indicii decid și de ce nu celelalte). Cazurile testează ALEGEREA conceptului potrivit. Bazează-te pe material.\n\n' +
    `${chapterHeader(ch)}\n\nMATERIAL:\n${mat.text}\n\nCAZURI EXISTENTE (nu le repeta):\n${CASES.filter((c) => c.ch === ch).map((c) => '- ' + c.q.slice(0, 100)).join('\n') || '(niciunul)'}\n\n` +
    'Scrie 10 cazuri NOI, din subteme diferite. Răspunde doar cu JSON: {"cases":[{"q":"vigneta + întrebarea","o":["…","…","…","…"],"a":0,"w":"…"}]}', { signal: job.signal });
  const cases = (res.cases || []).filter((c) => c.q && Array.isArray(c.o) && c.o.length >= 2 && c.a >= 0 && c.a < c.o.length).map((c) => ({ q: String(c.q), o: c.o.map(String), a: +c.a, w: String(c.w || '') }));
  if (!cases.length) throw new Error('Nu au venit cazuri utilizabile. Încearcă din nou.');
  await saveOutput(ch, 'cases', cases);
  return `${cases.length} cazuri`;
}
async function writeSummary(job, ch, onText) {
  const mat = await chapterMaterial(ch, 0);
  const qs = chGrile(ch);
  const hard = qs.filter((x) => gstat(x.id) && gstat(x.id)[2] === 0).slice(0, 30);
  const sample = (hard.length ? hard : qs.filter((x) => x.n || x.m).concat(qs)).slice(0, 40);
  const text = await askText(
    'Ești profesor universitar de medicină. Scrie o SINTEZĂ COMPLETĂ PENTRU EXAMEN, în română, în Markdown, pentru un student care învață pe grile: densă, structurată, fără umplutură, care permite recapitularea întregului capitol fără a reciti cursul. ' +
    'Secțiuni (adaptează la capitol, omite ce nu se aplică): ## Pe scurt · ## Noțiuni-cheie și definiții · ## Clasificări · ## Mecanisme / fiziopatologie · ## Clinic, diagnostic, tratament · ## Tabele comparative (tabele Markdown) · ## Cifre și valori de reținut · ## Mnemotehnici · ## Capcane frecvente la grile · ## Autoevaluare (10 întrebări scurte cu răspuns). ' +
    'Folosește **bold** pentru termenii frecvenți la grile. Bazează-te pe material; ce adaugi din afara lui marchează cu „(completare)”. Scrie direct sinteza, fără introducere.\n\n' +
    `${chapterHeader(ch)}\n\nMATERIAL${mat.parts > 1 ? ' (prima parte a capitolului)' : ''}:\n${mat.text}\n\n` +
    (sample.length ? `GRILE DIN CAPITOL (pentru „Capcane frecvente”):\n${sample.map(qText).join('\n\n').slice(0, 40000)}` : ''),
    { signal: job.signal, tier: 'complex', onText });
  await saveOutput(ch, 'summary', text, true);
  return text;
}
async function writePodcast(job, ch, minutes) {
  job.status(`${CHAPTERS[ch]}: scriu episodul…`);
  const mat = await chapterMaterial(ch, 0);
  const res = await askJSON(
    'Scrii scenariul unui podcast educațional scurt, în română, pentru studenți la medicină care se pregătesc de examen. Doi prezentatori: Ana (explică, structurează) și Mihai (pune întrebări de student, face legături, recapitulează). Ton natural, dar dens în informație. ' +
    'Conținut: doar ce TREBUIE ținut minte din capitol — ideile principale, clasificări, cifre-cheie, diferențele care se confundă la grile, mnemotehnici. Încheie cu „top 5 de reținut”. Textul va fi citit de o voce sintetică: fără Markdown, abrevierile scrise o dată pe larg, replici de 1-4 fraze.\n\n' +
    `${chapterHeader(ch)}\n\nMATERIAL:\n${mat.text}\n\nLungime: aproximativ ${minutes} minute (~${Math.round(minutes * 145)} de cuvinte). Răspunde doar cu JSON: {"title":"…","lines":[{"speaker":"Ana","text":"…"},{"speaker":"Mihai","text":"…"}]}`,
    { signal: job.signal, onChars: (c) => job.status(`${CHAPTERS[ch]}: scriu episodul… ${c} caractere`) });
  const content = { title: String(res.title || CHAPTERS[ch]), lines: (res.lines || []).filter((l) => l.text).map((l) => ({ speaker: l.speaker === 'Mihai' ? 'Mihai' : 'Ana', text: String(l.text) })) };
  if (!content.lines.length) throw new Error('Episodul a venit gol. Încearcă din nou.');
  await saveOutput(ch, 'podcast', content, true);
  return content;
}

/* =====================================================================
   NOU: Surse & capitole (UI)
   ===================================================================== */
let upKind = 'material';
$$('#up-kind button').forEach((b) => (b.onclick = () => { upKind = b.dataset.k; $$('#up-kind button').forEach((x) => x.classList.toggle('on', x === b)); }));
const drop = $('#drop'), fileIn = $('#file');
drop.onclick = () => { if (!needAI()) fileIn.click(); };
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.click(); } };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (!needAI()) addFiles([...e.dataTransfer.files], upKind); };
fileIn.onchange = () => { addFiles([...fileIn.files], upKind); fileIn.value = ''; };
$('#paste-add').onclick = async () => {
  if (needAI()) return;
  const text = $('#paste-text').value.trim();
  if (!text) return toast('Lipește întâi un text.');
  const name = $('#paste-name').value.trim() || `Text lipit ${new Date().toLocaleString('ro-RO')}`;
  const kind = upKind;
  $('#paste-text').value = ''; $('#paste-name').value = '';
  runJob(`Salvez „${name}”`, async (job) => { await saveSource(name, kind, text, {}, job); return 'Salvat.'; }, 'upload').then(autoProcess);
};
async function saveSource(name, kind, text, extra, job) {
  const id = uid('src');
  extra = { subjectId: CUR, subject: SUBJ_BY[CUR].label, ...extra };
  const blocks = splitBlocks(text);
  for (let i = 0, n = 0; i < blocks.length; i += CHUNK, n++) {
    job?.status(`Salvez… ${Math.min(i + CHUNK, blocks.length)}/${blocks.length} blocuri`);
    await R.db.collection(`sources/${id}/chunks`).doc('c' + String(n).padStart(4, '0')).set({ n, blocks: blocks.slice(i, i + CHUNK) });
  }
  blockCache.set(id, blocks);
  await put('sources', { id, name, kind, chars: text.length, nBlocks: blocks.length, addedAt: Date.now(), ...extra });
}
function addFiles(files, kind) {
  for (const file of files) {
    runJob(`Citesc „${file.name}”`, async (job) => {
      const fk = fileKind(file);
      let text = '', transcribed = false;
      if (fk === 'image') { text = await transcribe([file], job, file.name); transcribed = true; }
      else {
        job.status('Extrag textul…');
        const r = await extractText(file, (f) => job.progress(f));
        text = r.text.trim();
        if (fk === 'pdf' && text.length < (r.pages || 1) * 150) {
          if (r.pages > 60) throw new Error(`PDF-ul pare scanat (${r.pages} pagini). Împarte-l în părți de cel mult 60 de pagini sau folosește un PDF cu text selectabil.`);
          job.status('PDF scanat: pregătesc paginile…');
          text = await transcribe(await pdfPagesToImages(r.pdf, 1, r.pages), job, file.name); transcribed = true;
        }
      }
      if (!text) throw new Error('Nu am găsit text în fișier.');
      job.progress(null);
      await saveSource(file.name, kind, text, transcribed ? { transcribed: true } : {}, job);
      return `Adăugat: ${fmtN(text.length)} caractere${transcribed ? ' (transcris de Claude)' : ''}.`;
    }, 'upload').then(autoProcess);
  }
}
let processing = false;
async function autoProcess() {
  if (processing || !aiReady() || jobs.some((j) => j.kind === 'upload' && j.state === 'run')) return;
  const newMat = U.sources.filter((s) => s.kind === 'material' && !s.segmented);
  const inList = (s) => !!SUBJ_BY[srcSubj(s)];
  const newBanks = U.sources.filter((s) => s.kind === 'grile' && !s.extractedAt && inList(s));
  if (!newMat.length && !newBanks.length) return;
  processing = true;
  await runJob(newMat.length ? 'Procesez sursele noi' : 'Citesc banca de grile', async (job) => {
    const msg = [];
    let touched = [];
    if (newMat.length) { msg.push(await segmentNew(job, newMat)); touched = segmentNew.touched || []; }
    const banks = U.sources.filter((s) => s.kind === 'grile' && !s.extractedAt && inList(s));
    let bankAdded = 0;
    for (let i = 0; i < banks.length; i++) {
      const before = srcNow(banks[i].id)?.extractedCount || 0;
      await extractBank(job, srcNow(banks[i].id) || banks[i], banks.length > 1 ? `[file ${i + 1}/${banks.length}] ` : '');
      bankAdded += (srcNow(banks[i].id)?.extractedCount || 0) - before;
    }
    if (bankAdded) msg.push(`${bankAdded} grile citite din bănci`);
    const n = await assignOrphans(job, touched.length ? touched : null);
    if (n) msg.push(`${n} grile mutate din bancă în capitole`);
    const s = getSettings();
    if (s.autoFill && touched.length) {
      let made = 0;
      for (let i = 0; i < touched.length; i++) if (CHAPTERS[touched[i]] && chGrile(touched[i]).length < s.target) made += await fillOne(job, touched[i], s.target, s.batch, `[${i + 1}/${touched.length}] `);
      if (made) msg.push(`${made} grile noi scrise până la ${s.target} pe capitol`);
    }
    return msg.join(' · ') || 'Nimic nou de procesat.';
  });
  processing = false;
}
$('#seg').onclick = () => {
  if (needAI()) return;
  const mats = U.sources.filter((s) => s.kind === 'material' && !s.segmented);
  if (!mats.length) return toast('Niciun curs nou de împărțit. Încarcă întâi unul.');
  runJob('Împart cursul pe capitole', (job) => segmentNew(job, mats));
};
$('#assign-orphans').onclick = () => { if (!needAI()) runJob('Sortez grilele pe capitole', async (job) => `${await assignOrphans(job)} grile sortate.`); };
$('#fill-all').onclick = () => fillChapters(viewChapters().filter((ch) => chGrile(ch).length < getSettings().target));
function fillChapters(ids) {
  if (needAI()) return;
  if (!ids.length) return toast('Toate capitolele au deja destule grile.');
  const { target, batch } = getSettings();
  runJob(ids.length > 1 ? `Completez ${ids.length} capitole până la ${target} grile` : `Scriu grile: ${CHAPTERS[ids[0]]}`, async (job) => {
    let made = 0;
    for (let i = 0; i < ids.length; i++) made += await fillOne(job, ids[i], target, batch, ids.length > 1 ? `[${i + 1}/${ids.length}] ` : '');
    return `${made} grile noi scrise.`;
  });
}
async function prepareChapter(ch) {
  if (needAI()) return;
  const s = getSettings();
  if (!await ask(`Pregătești tot pentru „${CHAPTERS[ch]}”?\n\nSe verifică cheile față de curs, capitolul se completează până la ${s.target} grile și ${s.cardTarget} carduri, apoi se scriu cazuri, sinteza de examen și podcastul, unde lipsesc. Durează câteva minute și consumă din utilizarea ta Claude.`, { ok: 'Pregătește' })) return;
  runJob(`Pregătesc: ${CHAPTERS[ch]}`, async (job) => {
    const done = [];
    if (hasMaterial(ch)) done.push(await verifyKeys(job, ch));
    done.push(`${await fillOne(job, ch, s.target, s.batch)} grile`);
    done.push(await writeCards(job, ch, s.cardTarget));
    job.progress(null);
    if (ch !== 'I' && !latest(ch, 'cases')) done.push(await writeCases(job, ch));
    if (!latest(ch, 'summary')) { job.status('Scriu sinteza de examen…'); await writeSummary(job, ch); done.push('sinteză'); }
    if (!latest(ch, 'podcast')) { await writePodcast(job, ch, s.podcastMinutes); done.push('podcast'); }
    return `${CHAPTERS[ch]} e gata: ${done.join(', ')}.`;
  });
}

function renderSources() {
  const { target, cardTarget } = getSettings();
  $('#target-label').textContent = target;
  const acc = $('#src-access');
  acc.innerHTML = !R.ready ? '<div class="notice info">Mă conectez la Claude…</div>'
    : !R.db && SNAP ? `<div class="notice info">Versiune de partajare, cu conținutul din ${esc(new Date(SNAP.date).toLocaleDateString('ro-RO'))}. Poți învăța tot ce e aici; materialul nou se adaugă în aplicația din Claude.</div>`
    : !R.db ? '<div class="notice">Pentru a adăuga material, pagina trebuie deschisă în Claude, autentificat. Restul paginii funcționează normal.</div>'
    : !R.canWrite ? '<div class="notice info">Poți învăța tot ce e aici, inclusiv ce au adăugat alții. Doar cei cu drept de editare pot adăuga material; cere proprietarului acces de Contributor.</div>'
    : !R.sample ? '<div class="notice">Claude nu este disponibil aici, deci materialul nou nu poate fi procesat.</div>'
    : '<div class="notice info">Tot ce adaugi aici e comun pentru toți cei care deschid pagina. Munca AI consumă din utilizarea ta Claude.</div>';
  $('#upload-box').hidden = !aiReady();
  const mats = U.sources.filter((s) => s.kind === 'material' && srcSubj(s) === CUR), banks = U.sources.filter((s) => s.kind === 'grile' && srcSubj(s) === CUR);
  const row = (s) => `<div class="srow"><div><div class="nm">${s.kind === 'material' ? '📘' : '📝'} ${esc(s.name)}</div>
      <div class="hint">${fmtN(s.chars || 0)} caractere${s.transcribed ? ' · transcris de Claude' : ''} · ${s.kind === 'material' ? (s.segmented ? 'împărțit pe capitole' : '<b>neîmpărțit încă</b>') : (s.extractedAt ? `${s.extractedCount ?? 0} grile adăugate` : s.doneChunks ? `în citire: partea ${s.doneChunks}/${s.nChunks || '?'}` : '<b>necitit încă</b>')}${s.subject ? ` · ${esc(s.subject)}` : ''}${s.origin ? ` · <span title="${esc(s.origin)}">din Drive</span>` : ''}</div></div>
      ${aiReady() ? `<div class="acts"><button class="btn small" data-flip="${s.id}" title="Schimbă între curs și bancă de grile">⇄</button><button class="btn small danger" data-delsrc="${s.id}">Șterge</button></div>` : ''}</div>`;
  const pool = GQ.filter((x) => !x.ch && x.src !== 'ai' && x.sj === CUR);
  const pending = banks.filter((s) => !s.extractedAt);
  const bankBox = (banks.length ? `<div class="box"><b>Banca de grile</b>
    <p class="hint" style="margin:6px 0">${fmtN(banks.reduce((n, s) => n + (s.extractedCount || 0), 0))} grile citite din ${banks.length} fișiere${pending.length ? `; mai sunt de citit ${pending.length} fișiere (${pending.reduce((n, s) => n + (s.doneChunks || 0), 0)} părți gata)` : ''}.
    ${pool.length ? `<b>${fmtN(pool.length)}</b> își așteaptă capitolul. Când încarci cursul, trec automat în capitolele lui.` : ''}</p>
    ${pending.length && aiReady() && !processing ? '<button class="btn small primary" id="bank-continue">Continuă citirea băncii de grile</button>' : ''}${processing ? '<span class="hint">Citesc acum — ține pagina deschisă. Dacă o închizi, data viitoare continuă de unde a rămas.</span>' : ''}</div>` : '');
  const listed = [...mats, ...banks.filter((s) => !s.pool)];
  const drive = banks.filter((s) => s.pool);
  $('#src-list').innerHTML = bankBox + (listed.length ? `<div class="box">${listed.map(row).join('')}</div>` : '') +
    (drive.length ? `<details class="box"><summary><b>Fișiere din Google Drive</b> <span class="hint">(${drive.length})</span></summary>${drive.map(row).join('')}</details>` : '');
  const bc = $('#bank-continue'); if (bc) bc.onclick = () => autoProcess();
  const orphans = GQ.filter((x) => !x.ch && x.sj === CUR).length;
  $('#assign-orphans').hidden = !orphans || !aiReady();
  $('#assign-orphans').textContent = `Sortează pe capitole cele ${orphans} grile din bancă`;
  $('#fill-all').textContent = `Completează toate capitolele până la ${target} grile`;
  $('#fill-all').hidden = $('#seg').hidden = $('#seg-hint').hidden = !aiReady();
  const w = aiReady();
  $('#ch-list').innerHTML = (viewChapters().length ? '' : `<p class="hint">Încă nu sunt capitole la ${esc(SUBJ_BY[CUR].label)}. Încarcă cursul mai sus.</p>`) + viewChapters().map((ch) => {
    const m = chMeta(ch) || {};
    const qs = chGrile(ch), base = qs.filter((x) => BASE_SRC.has(x.src)).length, ai = qs.filter((x) => x.src === 'ai').length;
    const pct = Math.min(100, Math.round((qs.length / target) * 100));
    const isBase = !!BASE.CHAPTERS[ch];
    const topics = topicsOf(ch);
    const chars = (m.ranges || []).reduce((s, r) => { const src = U.sources.find((x) => x.id === r.sourceId); return s + (src ? Math.round(((r.toBlock - r.fromBlock + 1) / Math.max(1, src.nBlocks)) * src.chars) : 0); }, 0);
    return `<div class="chap">
      <div class="row"><h4>${esc(CHAPTERS[ch])}</h4><span class="sp"></span>
        ${w ? `<button class="btn small primary" data-prep="${ch}">⚡ Pregătește tot</button>
        <button class="btn small" data-fill="${ch}" ${qs.length >= target ? 'disabled' : ''}>Completează la ${target}</button>
        ${hasMaterial(ch) && U.grilePacks.some((p) => p.ch === ch && p.src !== 'ai' && p.items.some((x) => !x.verifiedAt)) ? `<button class="btn small" data-verify="${ch}">Verifică cheile</button>` : ''}
        <button class="btn small" data-ren="${ch}">Redenumește</button>${isBase ? '' : `<button class="btn small danger" data-delch="${ch}">Șterge</button>`}` : ''}</div>
      ${m.summary ? `<div class="hint">${esc(m.summary)}</div>` : ''}
      ${topics.length ? `<div class="topics">${topics.slice(0, 20).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="nums"><div><b>${qs.length}/${target}</b>grile (${base} originale · ${qs.length - base - ai} din bănci · ${ai} AI)</div>
        <div><b>${chCards(ch).length}</b>carduri (țintă ${cardTarget})</div>
        <div><b>${chars ? '~' + fmtN(chars) : '—'}</b>${chars ? 'caractere de curs' : 'niciun curs încărcat'}</div></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join('');
}
$('#src-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || needAI()) return;
  const s = U.sources.find((x) => x.id === (b.dataset.delsrc || b.dataset.flip)); if (!s) return;
  if (b.dataset.delsrc) {
    if (!await ask(`Ștergi „${s.name}”? Grilele luate deja din el rămân. Capitolele care îi folosesc textul pierd acel material.`, { ok: 'Șterge' })) return;
    const chunks = await R.db.collection(`sources/${s.id}/chunks`).get();
    for (const d of chunks.docs) await R.db.doc(`sources/${s.id}/chunks/${d.id}`).delete();
    blockCache.delete(s.id);
    for (const m of U.chapters.filter((c) => (c.ranges || []).some((r) => r.sourceId === s.id))) await put('chapters', { ...m, ranges: m.ranges.filter((r) => r.sourceId !== s.id) });
    await del('sources', s.id);
  } else {
    await put('sources', { ...s, kind: s.kind === 'material' ? 'grile' : 'material', segmented: false, extractedAt: null });
    autoProcess();
  }
  refreshAll();
});
$('#ch-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || needAI()) return;
  const ch = b.dataset.prep || b.dataset.fill || b.dataset.verify || b.dataset.ren || b.dataset.delch;
  if (b.dataset.prep) prepareChapter(ch);
  if (b.dataset.fill) fillChapters([ch]);
  if (b.dataset.verify) runJob(`Verific cheile: ${CHAPTERS[ch]}`, (job) => verifyKeys(job, ch));
  if (b.dataset.ren) {
    const t = await ask('Numele nou al capitolului:', { input: CHAPTERS[ch], ok: 'Redenumește' });
    if (t) { const m = chMeta(ch) || { id: ch, summary: '', topics: [], ranges: [], sections: {}, order: 0 }; await put('chapters', { ...m, title: t }); refreshAll(); }
  }
  if (b.dataset.delch) {
    if (!await ask(`Ștergi capitolul „${CHAPTERS[ch]}”? Grilele lui rămân în bancă; cardurile și materialele generate se șterg pentru toți.`, { ok: 'Șterge' })) return;
    for (const p of U.grilePacks.filter((p) => p.ch === ch)) await put('grilePacks', { ...p, ch: '' });
    for (const p of U.cardPacks.filter((p) => p.ch === ch)) await del('cardPacks', p.id);
    for (const o of U.outputs.filter((o) => o.ch === ch)) await del('outputs', o.id);
    await del('chapters', ch);
    refreshAll();
  }
});
onShow.sources = renderSources;

/* ---------- generare din tab-urile originale ---------- */
function aiButtons() {
  const w = aiReady();
  for (const id of ['#case-gen', '#cards-gen', '#cards-ch']) $(id).hidden = !w;
  $('#case-gen').disabled = !$('#case-ch').value; $('#cards-gen').disabled = !$('#cards-ch').value;
  $('#cards-info').textContent = w ? `${chCards($('#cards-ch').value).length} carduri în acest capitol` : '';
}
$('#case-gen').onclick = () => { const ch = $('#case-ch').value; if (ch && !needAI()) runJob(`Cazuri: ${CHAPTERS[ch]}`, (job) => writeCases(job, ch)); };
$('#cards-gen').onclick = () => { const ch = $('#cards-ch').value; if (ch && !needAI()) runJob(`Carduri: ${CHAPTERS[ch]}`, (job) => writeCards(job, ch, Math.max(getSettings().cardTarget, chCards(ch).length + 20))); };
$('#cards-ch').onchange = aiButtons;

/* =====================================================================
   NOU: Sinteze de examen
   ===================================================================== */
let sumStreaming = null;
async function saveFile(name, data) {
  if (R.dl) {
    try { await R.dl.save({ filename: name, data }); } catch (e) { if (e?.code !== 'declined' && e?.code !== 'cancelled') toast('Fișierul nu a putut fi salvat.'); }
    return;
  }
  if (window.claude) { toast('Salvarea fișierelor nu e disponibilă aici.'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain;charset=utf-8' }));
  a.download = name.replace(/[\\/:*?"<>|]/g, '_'); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function renderSummary() {
  const ch = $('#sum-ch').value;
  const o = latest(ch, 'summary');
  $('#sum-gen').textContent = o ? 'Rescrie sinteza' : 'Scrie sinteza';
  $('#sum-gen').hidden = $('#sum-all').hidden = !aiReady();
  const n = viewChapters().filter((k) => latest(k, 'summary')).length;
  $('#sum-status').textContent = `${n}/${viewChapters().length} capitole au sinteză`;
  $('#sum-tools').hidden = !o;
  $('#sum-print').hidden = true;
  if (o) $('#sum-date').textContent = 'Scrisă la ' + new Date(o.createdAt).toLocaleString('ro-RO');
  if (sumStreaming !== ch) $('#sum-body').innerHTML = o ? md(o.content) : `<p class="hint">${ch ? 'Încă nu e o sinteză pentru acest capitol.' + (aiReady() ? ' Apasă Scrie sinteza.' : '') : 'Niciun capitol încă. Încarcă cursul în tabul Curs.'}</p>`;
}
$('#sum-ch').onchange = renderSummary;
function writeSummaries(chs) {
  if (needAI()) return;
  if (!chs.length) return toast('Toate capitolele au deja sinteză.');
  runJob(chs.length > 1 ? `Sinteze (${chs.length} capitole)` : `Sinteză: ${CHAPTERS[chs[0]]}`, async (job) => {
    for (let i = 0; i < chs.length; i++) {
      const ch = chs[i];
      job.progress(i / chs.length); job.status(`${CHAPTERS[ch]}: Claude se gândește…`);
      sumStreaming = ch;
      if ($('#sum-ch').value === ch) $('#sum-body').innerHTML = '<p class="hint">Claude se gândește…</p>';
      try {
        await writeSummary(job, ch, (t) => {
          job.status(`${CHAPTERS[ch]}: ${fmtN(t.length)} caractere`);
          if ($('#sum-ch').value === ch && !$('#tab-summaries').hidden) $('#sum-body').innerHTML = md(t);
        });
      } finally { sumStreaming = null; }
    }
    return 'Sintezele sunt gata.';
  });
}
$('#sum-gen').onclick = () => { if ($('#sum-ch').value) writeSummaries([$('#sum-ch').value]); else toast('Încarcă întâi cursul, ca să existe capitole.'); };
$('#sum-all').onclick = () => writeSummaries(viewChapters().filter((k) => !latest(k, 'summary')));
$('#sum-dl').onclick = () => { const o = latest($('#sum-ch').value, 'summary'); if (o) saveFile(`Sinteza - ${CHAPTERS[o.ch]}.md`, `# ${CHAPTERS[o.ch]}\n\n${o.content}`); };
onShow.summaries = renderSummary;

/* =====================================================================
   NOU: Podcast (voci Claude; altfel vocea browserului)
   ===================================================================== */
const pod = { playing: false, idx: 0, rate: 1, offTts: [] };
function renderPodcast() {
  const ch = $('#pod-ch').value;
  const o = latest(ch, 'podcast');
  $('#pod-gen').textContent = o ? 'Rescrie episodul' : 'Scrie episodul';
  $('#pod-gen').hidden = !aiReady();
  if (!o) { $('#pod-box').innerHTML = `<p class="hint">Încă nu e un episod pentru acest capitol.${aiReady() ? ' Apasă Scrie episodul.' : ''}</p>`; return; }
  const canSpeak = !!R.tts || 'speechSynthesis' in window;
  $('#pod-box').innerHTML = `<div class="box">
    <div class="controls"><b style="flex:1">🎙️ ${esc(o.content.title)}</b><button class="btn small" id="pod-dl">Salvează scenariul</button></div>
    ${canSpeak ? `<div class="controls"><button class="btn primary" id="pod-play">${pod.playing ? '⏸ Pauză' : '▶ Redă'}</button><button class="btn" id="pod-stop">⏹ Oprește</button>
      <label class="inline">Viteză <input type="range" id="pod-rate" min="0.7" max="1.5" step="0.1" value="${pod.rate}"></label>
      <span class="hint">${R.tts ? 'Voci Claude' : 'Vocea browserului'} · apasă pe o replică pentru a începe de acolo</span></div>` : '<p class="hint">Citirea cu voce nu e disponibilă aici; citește scenariul mai jos.</p>'}
    <div id="pod-lines">${o.content.lines.map((l, i) => `<div class="pod-line ${esc(l.speaker)}" data-i="${i}"><b>${esc(l.speaker)}</b>${esc(l.text)}</div>`).join('')}</div></div>`;
  $('#pod-dl').onclick = () => saveFile(`Podcast - ${CHAPTERS[ch]}.txt`, `${o.content.title}\n\n` + o.content.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n\n'));
  if (!canSpeak) return;
  $('#pod-play').onclick = () => {
    if (pod.playing && !pod.paused) { pod.paused = true; R.tts ? R.tts.pause().catch(() => {}) : speechSynthesis.pause(); $('#pod-play').textContent = '▶ Continuă'; return; }
    if (pod.paused) { pod.paused = false; R.tts ? R.tts.resume().catch(() => {}) : speechSynthesis.resume(); $('#pod-play').textContent = '⏸ Pauză'; return; }
    play(o.content.lines, pod.idx);
  };
  $('#pod-stop').onclick = () => { stopPod(); pod.idx = 0; highlight(-1); };
  $('#pod-rate').oninput = (e) => { pod.rate = +e.target.value; R.tts?.setRate?.(pod.rate); };
  $$('.pod-line').forEach((el) => (el.onclick = () => play(o.content.lines, +el.dataset.i)));
  if (pod.playing) highlight(pod.idx);
}
function highlight(i) {
  $$('.pod-line').forEach((x) => x.classList.toggle('now', +x.dataset.i === i));
  if (i >= 0) $(`.pod-line[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function play(lines, start) {
  stopPod();
  pod.playing = true; pod.paused = false; pod.idx = start;
  const btn = $('#pod-play'); if (btn) btn.textContent = '⏸ Pauză';
  if (R.tts) {
    const voice = { Ana: 'airy', Mihai: 'rounded' };
    pod.offTts = [
      R.tts.onLine(({ line }) => { pod.idx = start + line; highlight(pod.idx); }),
      R.tts.onState(({ state }) => { if (state === 'idle') { pod.playing = false; pod.paused = false; const b = $('#pod-play'); if (b) b.textContent = '▶ Redă'; } }),
    ];
    R.tts.setRate?.(pod.rate);
    R.tts.speak(lines.slice(start, start + 100).map((l) => ({ text: l.text.slice(0, 1900), voice: voice[l.speaker] || 'buttery', language: 'ro' })), { rate: pod.rate })
      .catch((e) => { if (e?.code === 'not_granted') toast('Citirea cu voce e oprită pentru această pagină (meniul Permissions).'); });
    return;
  }
  const token = (pod.token = Symbol());
  const voices = speechSynthesis.getVoices().filter((v) => /^ro/i.test(v.lang));
  const speak = (i) => {
    if (pod.token !== token) return;
    if (i >= lines.length) { pod.playing = false; pod.idx = 0; const b = $('#pod-play'); if (b) b.textContent = '▶ Redă'; return; }
    pod.idx = i; highlight(i);
    const u = new SpeechSynthesisUtterance(lines[i].text);
    const v = voices[lines[i].speaker === 'Ana' ? 0 : Math.min(1, voices.length - 1)];
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ro-RO';
    u.rate = pod.rate; if (voices.length < 2) u.pitch = lines[i].speaker === 'Ana' ? 1.15 : 0.85;
    u.onend = () => speak(i + 1);
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') speak(i + 1); };
    speechSynthesis.speak(u);
  };
  speak(start);
}
function stopPod() {
  pod.token = null; pod.playing = false; pod.paused = false;
  pod.offTts.forEach((f) => f()); pod.offTts = [];
  if (R.tts) R.tts.stop().catch(() => {}); else if ('speechSynthesis' in window) speechSynthesis.cancel();
}
$('#pod-ch').onchange = () => { stopPod(); pod.idx = 0; renderPodcast(); };
$('#pod-min').value = String(getSettings().podcastMinutes || 5);
$('#pod-min').onchange = (e) => saveSettings({ ...getSettings(), podcastMinutes: +e.target.value });
$('#pod-gen').onclick = () => {
  const ch = $('#pod-ch').value;
  if (!ch) return toast('Încarcă întâi cursul, ca să existe capitole.');
  if (needAI()) return;
  stopPod();
  runJob(`Podcast: ${CHAPTERS[ch]}`, async (job) => { const c = await writePodcast(job, ch, +$('#pod-min').value); return `Episodul e gata: ${c.lines.length} replici.`; });
};
onShow.podcast = renderPodcast;

/* =====================================================================
   NOU: Setări
   ===================================================================== */
function renderSettings() {
  const s = getSettings();
  $('#st-target').value = s.target; $('#st-batch').value = s.batch; $('#st-ctarget').value = s.cardTarget; $('#st-autofill').checked = !!s.autoFill;
  $('#st-ai').textContent = !R.ready ? 'Mă conectez la Claude…'
    : aiReady() ? 'Claude e conectat. Munca AI (împărțirea, sortarea și scrierea grilelor, cardurile, sintezele, podcasturile) consumă din utilizarea ta Claude; Claude te întreabă o dată înainte de prima cerere.'
    : R.db ? 'Poți învăța tot ce e aici. Pentru a adăuga material e nevoie de drept de editare.' : 'Deschide pagina în Claude, autentificat, ca să folosești funcțiile AI și materialul comun.';
  const nCh = U.chapters.filter((c) => !BASE.CHAPTERS[c.id]).length;
  const nQ = U.grilePacks.reduce((s, p) => s + (p.items?.length || 0), 0), nC = U.cardPacks.reduce((s, p) => s + (p.items?.length || 0), 0);
  $('#st-counts').textContent = `Adăugate până acum: ${U.sources.length} surse, ${nCh} capitole noi, ${nQ} grile, ${nC} carduri, ${U.outputs.length} sinteze/podcasturi/seturi. Împreună cu conținutul original: ${GQ.length} grile și ${CARDS.length} carduri.`;
  $('#st-wipe').hidden = !aiReady(); $('#st-imp').hidden = !aiReady();
  $('#st-share').hidden = $('#st-share-hint').hidden = !R.db;
}
$('#st-save').onclick = () => {
  saveSettings({ ...getSettings(), target: Math.max(10, +$('#st-target').value || 100), batch: Math.min(30, Math.max(5, +$('#st-batch').value || 15)), cardTarget: Math.max(10, +$('#st-ctarget').value || 60), autoFill: $('#st-autofill').checked });
  toast('Setări salvate.'); refreshAll();
};
// Un singur fișier HTML cu tot conținutul de acum, pentru LiveSend sau pentru colegi (fără AI).
function shareHtml() {
  const style = [...document.querySelectorAll('style')].find((x) => x.textContent.includes('--f-display'))?.textContent || '';
  const fonts = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]')?.href || '';
  const libs = [...document.querySelectorAll('script[src]')].filter((x) => /marked|purify/.test(x.src)).map((x) => `<script src="${x.src}"><\/script>`).join('');
  const snap = { date: new Date().toISOString(), user: { sources: U.sources, chapters: U.chapters, grilePacks: U.grilePacks, cardPacks: U.cardPacks, outputs: U.outputs } };
  const json = JSON.stringify(snap).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semiologie Recall</title>' +
    (fonts ? `<link rel="stylesheet" href="${fonts}">` : '') + `<style>[hidden]{display:none!important}body{margin:0}\n${style}</style></head><body>\n${PRISTINE}\n${libs}` +
    `<script>window.SNAPSHOT=${json};<\/script><script>${$('#base-data').textContent}<\/script><script>${$('#app-code').textContent}<\/script></body></html>`;
}
$('#st-share').onclick = () => saveFile(`semiologie-recall-${today()}.html`, shareHtml());
$('#st-exp').onclick = async () => {
  const sources = [];
  if (R.db) for (const s of U.sources) sources.push({ ...s, blocks: await sourceBlocks(s.id).catch(() => []) });
  saveFile(`semiologie-recall-backup-${today()}.json`, JSON.stringify({ app: 'semiologie-recall-plus', version: 2, user: { ...U, sources }, progress: store }));
};
$('#st-imp').onclick = () => { if (!needAI()) $('#st-file').click(); };
$('#st-file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data.user) throw new Error('nu este un backup al acestei aplicații');
    if (!await ask('Adaugi tot din acest backup la materialul comun? Elementele cu același id se înlocuiesc.', { ok: 'Importă' })) return;
    runJob('Import backup', async (job) => {
      for (const s of data.user.sources || []) {
        const { blocks = [], ...meta } = s;
        for (let i = 0, n = 0; i < blocks.length; i += CHUNK, n++) await R.db.collection(`sources/${s.id}/chunks`).doc('c' + String(n).padStart(4, '0')).set({ n, blocks: blocks.slice(i, i + CHUNK) });
        await put('sources', meta);
      }
      for (const key of ['chapters', 'grilePacks', 'cardPacks', 'outputs']) for (const d of data.user[key] || []) { job.status(`Import ${key}…`); await put(key, d); }
      if (data.progress?.s) { store = data.progress; if (!store.g) store.g = {}; scheduleSave(); }
      return 'Backup importat.';
    });
  } catch (err) { toast('Nu s-a putut importa: ' + err.message); }
};
$('#st-wipe').onclick = async () => {
  if (needAI()) return;
  if (!await ask('Ștergi toate sursele, capitolele, grilele, cardurile, sintezele și podcasturile adăugate, pentru toți? Conținutul original rămâne.', { ok: 'Șterge tot' })) return;
  runJob('Șterg materialul adăugat', async (job) => {
    for (const s of U.sources) { const chunks = await R.db.collection(`sources/${s.id}/chunks`).get(); for (const d of chunks.docs) await R.db.doc(`sources/${s.id}/chunks/${d.id}`).delete(); }
    for (const key of Object.keys(COLLS)) for (const d of [...U[key]]) { job.status(`Șterg ${key}…`); await del(key, d.id); }
    return 'Șters.';
  });
};
onShow.settings = renderSettings;

/* =====================================================================
   Reîmprospătare
   ===================================================================== */
function refreshAll() {
  rebuild();
  renderSubjects();
  fillSecSel(); fillGFilters();
  chOptions($('#case-ch'), { all: true });
  for (const id of ['#cards-ch', '#sum-ch', '#pod-ch']) chOptions($(id));
  aiButtons();
  if (!gMode) gRenderStats(); else $('#g-count').textContent = gPool().length + ' grile găsite';
  limitIn.value = store.meta.newLimit; refreshStats(); if (!started) renderCard();
  if (!caseDone) renderCases();
  const visible = $$('nav.tabs button').find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab;
  if (visible === 'podcast') { if (!pod.playing) renderPodcast(); }
  else if (visible && onShow[visible]) onShow[visible]();
}

/* ---------- bara de materii ---------- */
function renderSubjects() {
  const sub = SUBJ_BY[CUR];
  $('#subj-name').textContent = sub.label;
  const nCards = CARDS.filter((c) => chSubj(SECTION_CH[c[1]]) === CUR).length, nQ = GQ.filter((x) => x.sj === CUR).length, nCh = viewChapters().length;
  $('#subtitle').textContent = `${fmtN(nCh)} capitole · ${fmtN(nQ)} grile · ${fmtN(nCards)} carduri`;
  $('#subjects').innerHTML = SUBJECTS.map((x) => `<button role="tab" data-subj="${x.id}" aria-selected="${x.id === CUR}">${esc(x.short)}<small>${fmtN(GQ.filter((q) => q.sj === x.id).length)}</small></button>`).join('');
}
$('#subjects').addEventListener('click', (e) => {
  const b = e.target.closest('[data-subj]'); if (!b || b.dataset.subj === CUR) return;
  CUR = b.dataset.subj;
  try { localStorage.setItem('semio-subject', CUR); } catch (err) { /* ignore */ }
  stopPod(); pod.idx = 0;
  started = false; cur = null; queue = []; gMode = null; $('#gq').innerHTML = ''; caseDone = 0;
  for (const id of ['#sec-filter', '#case-ch', '#cards-ch', '#sum-ch', '#pod-ch', '#g-ch', '#g-src']) $(id).value = '';
  refreshAll();
});

refreshAll();
if (CUR === 'semio-med') { gFilt.ch.value = 'I'; gRenderStats(); }
try { const t = localStorage.getItem('semio-tab'); if (t && $(`nav.tabs button[data-tab="${t}"]`)) showTab(t); else showTab('review'); } catch (e) { /* ignore */ }
initRuntime();
})();
