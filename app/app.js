// Recall pe materii (anul III): fiecare persoană își încarcă documentele, iar aplicația lucrează pe ele.
// • Banca comună (doar citire): cele 868 de grile, 295 de carduri și 36 de cazuri originale (Semiologie medicală)
//   + băncile de grile din Google Drive (citite de proprietar, în db: `sources`, `grile`).
// • Datele fiecărei persoane sunt private: documente, capitole, ce s-a ales din bancă și ce s-a generat
//   (în db la data/users/<id>/me/…, sau în browser dacă pagina nu poate scrie acolo).
// • Nimic nu se generează automat: grilele, cardurile, cazurile, sintezele și podcasturile se fac la cerere.
(async function () {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// Structura curată a paginii, păstrată pentru „Versiune pentru LiveSend” (înainte de orice randare).
const PRISTINE = ['header.chart', 'main.wrap', '#modal', '#jobs', '#toast'].map((q) => document.querySelector(q)?.outerHTML || '').join('\n');
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }
const md = (s) => (window.DOMPurify && window.marked ? DOMPurify.sanitize(marked.parse(s || '')) : `<pre style="white-space:pre-wrap">${esc(s)}</pre>`);
const fmtN = (n) => n.toLocaleString('ro-RO');
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const normStem = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\s*\d+\s*[.)-]\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const today = () => new Date().toISOString().slice(0, 10);
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* =====================================================================
   Materii și setări
   ===================================================================== */
const SUBJECTS = [
  { id: 'semio-med', label: 'Semiologie medicală', short: 'Semio med', aliases: ['semio med', 'semiologie medicala'] },
  { id: 'semio-chir', label: 'Semiologie chirurgicală', short: 'Semio chir', aliases: ['semio chir', 'semiologie chirurgicala'] },
  { id: 'fiziopat', label: 'Fiziopatologie', short: 'Fiziopat', aliases: ['fiziopatologie', 'fizpat', 'fiziopat'] },
  { id: 'farmaco', label: 'Farmacologie', short: 'Farmaco', aliases: ['farmacologie', 'farmaco'] },
  { id: 'morfopat', label: 'Anatomie patologică', short: 'Anatomie patologică', aliases: ['anatomie patologica', 'morfopatologie', 'morfopat', 'anatopat'] },
];
const SUBJ_BY = Object.fromEntries(SUBJECTS.map((x) => [x.id, x]));
function subjOf(name) { const n = normStem(name || ''); if (!n) return null; const x = SUBJECTS.find((x) => x.id === name || normStem(x.label) === n || x.aliases.includes(n)); return x ? x.id : null; }
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } } };
let CUR = SUBJ_BY[ls.get('semio-subject', '')] ? ls.get('semio-subject') : 'semio-med';
const DEFAULTS = { podcastMinutes: 5, pagesPerChapter: 50 };
const getSettings = () => ({ ...DEFAULTS, ...ls.get('semio-plus-settings', {}) });
const saveSettings = (s) => ls.set('semio-plus-settings', s);

/* =====================================================================
   Banca comună (doar citire pentru toți)
   ===================================================================== */
const BANK = { sources: [], packs: [] };
const BASE_SRC = { new: 'Noi · din cursul 2022', mg: 'Teste studenți MG', s1: 'Grile semestrul I', y21: 'Grile 2021', md: 'Bancă Chișinău 2010–2011', g3: 'Grile 3-1 … 3-30' };
const BASE_Q = BASE.GRILE.map((r) => ({ id: r[0], sj: 'semio-med', src: r[2], q: r[3], o: r[4], k: r[5], n: r[6], m: !!r[7], bank: true }));
const BASE_IDS = new Set(BASE_Q.map((x) => x.id));
const BASE_CARDS = BASE.CARDS.map((c) => ({ id: c[0], sj: 'semio-med', front: c[2], back: c[3], sec: BASE.SECTIONS[c[1]]?.[0] || '', bank: true }));
const BASE_CASES = BASE.CASES.map((c, i) => ({ id: 'bc' + i, sj: 'semio-med', ...c, bank: true }));
let BANK_Q = [], BANK_BY = {};
function rebuildBank(extra = null) {
  const drive = extra || BANK.packs.flatMap((p) => { const sj = subjOf(p.subj) || subjOf(BANK.sources.find((s) => s.id === p.src)?.subject); return sj ? (p.items || []).map((x) => ({ ...x, sj, src: p.src, bank: true })) : []; });
  BANK_Q = [...BASE_Q, ...drive];
  BANK_BY = Object.fromEntries([...BANK_Q, ...BASE_CARDS, ...BASE_CASES].map((x) => [x.id, x]));
}
rebuildBank();

/* =====================================================================
   Datele mele (private) — în db la data/users/<id>/me/…, altfel în browser
   ===================================================================== */
const P = { docs: [], chapters: [], items: [], outputs: [] };
const PS = {
  mode: 'mem', base: null, idb: null, mem: new Map(),
  async init(db, id) {
    if (db && id) {
      try { this.base = db.doc(`data/users/${id}/me`); await this.base.set({ v: 1, seen: Date.now() }); this.mode = 'db'; return; } catch (e) { this.base = null; }
    }
    try {
      this.idb = await new Promise((res, rej) => { const r = indexedDB.open('semio-recall-me', 1); r.onupgradeneeded = () => { for (const s of ['docs', 'chapters', 'items', 'outputs', 'chunks']) r.result.createObjectStore(s, { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      this.mode = 'idb';
    } catch (e) { this.mode = 'mem'; }
  },
  tx(store, mode, fn) { return new Promise((res, rej) => { const t = this.idb.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out?.result); t.onerror = () => rej(t.error); }); },
  async all(coll) {
    if (this.mode === 'db') return (await this.base.collection(coll).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    if (this.mode === 'idb') return (await this.tx(coll, 'readonly', (s) => s.getAll())) || [];
    return [];
  },
  async put(coll, doc) {
    const { id, ...body } = doc;
    if (this.mode === 'db') return this.base.collection(coll).doc(id).set(JSON.parse(JSON.stringify(body)));
    if (this.mode === 'idb') return this.tx(coll, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(doc))));
  },
  async del(coll, id) {
    if (this.mode === 'db') return this.base.collection(coll).doc(id).delete();
    if (this.mode === 'idb') return this.tx(coll, 'readwrite', (s) => s.delete(id));
  },
  async putBlocks(docId, blocks) {
    if (this.mode === 'db') { const c = this.base.collection('docs').doc(docId).collection('chunks'); for (let i = 0, n = 0; i < blocks.length; i += 150, n++) await c.doc('c' + String(n).padStart(4, '0')).set({ n, blocks: blocks.slice(i, i + 150) }); return; }
    if (this.mode === 'idb') return this.tx('chunks', 'readwrite', (s) => s.put({ id: docId, blocks }));
    this.mem.set(docId, blocks);
  },
  async getBlocks(docId) {
    if (this.mode === 'db') { const snap = await this.base.collection('docs').doc(docId).collection('chunks').get(); return snap.docs.map((d) => d.data()).sort((a, b) => a.n - b.n).flatMap((d) => d.blocks || []); }
    if (this.mode === 'idb') return (await this.tx('chunks', 'readonly', (s) => s.get(docId)))?.blocks || [];
    return this.mem.get(docId) || [];
  },
  async delBlocks(docId) {
    if (this.mode === 'db') { const c = this.base.collection('docs').doc(docId).collection('chunks'); for (const d of (await c.get()).docs) await c.doc(d.id).delete(); return; }
    if (this.mode === 'idb') return this.tx('chunks', 'readwrite', (s) => s.delete(docId));
    this.mem.delete(docId);
  },
};
async function pPut(coll, doc) { const a = P[coll]; const i = a.findIndex((x) => x.id === doc.id); if (i >= 0) a[i] = doc; else a.push(doc); rebuild(); await PS.put(coll, doc); }
async function pDel(coll, id) { P[coll] = P[coll].filter((x) => x.id !== id); rebuild(); await PS.del(coll, id); }
const blockCache = new Map();
async function docBlocks(id) { if (!blockCache.has(id)) blockCache.set(id, await PS.getBlocks(id)); return blockCache.get(id); }
const srcLabel = (src) => (src === 'ai' ? 'Generate de AI' : BASE_SRC[src] || BANK.sources.find((s) => s.id === src)?.name || P.docs.find((d) => d.id === src)?.name || 'Bancă');

/* =====================================================================
   Ce se vede pentru materia aleasă
   ===================================================================== */
let CH = {}, CH_LIST = [], GQ = [], GQ_BY = {}, CARDS = [], CARD_BY = {}, CASES = [];
const myChapters = (sj = CUR) => P.chapters.filter((c) => c.subject === sj).sort((a, b) => (a.order || 0) - (b.order || 0));
function rebuild() {
  CH_LIST = myChapters(); CH = Object.fromEntries(CH_LIST.map((c) => [c.id, c]));
  const q = [], cards = [], cases = [];
  for (const c of CH_LIST) {
    for (const id of c.bankQ || []) { const x = BANK_BY[id]; if (x) q.push({ ...x, ch: c.id }); }
    for (const id of c.bankCards || []) { const x = BANK_BY[id]; if (x) cards.push({ ...x, ch: c.id }); }
    for (const id of c.bankCases || []) { const x = BANK_BY[id]; if (x) cases.push({ ...x, ch: c.id }); }
  }
  for (const p of P.items) {
    if (p.subject !== CUR) continue;
    const ch = CH[p.ch] ? p.ch : '';
    for (const x of p.items || []) {
      if (p.kind === 'grile') q.push({ ...x, ch, src: p.src, pack: p.id });
      else if (p.kind === 'cards') cards.push({ ...x, ch, pack: p.id });
      else if (p.kind === 'cases') cases.push({ ...x, ch, pack: p.id });
    }
  }
  const seen = new Set(); GQ = q.filter((x) => !seen.has(x.id) && seen.add(x.id));
  GQ_BY = Object.fromEntries(GQ.map((x) => [x.id, x]));
  const seenC = new Set(); CARDS = cards.filter((x) => !seenC.has(x.id) && seenC.add(x.id));
  CARD_BY = Object.fromEntries(CARDS.map((x) => [x.id, x]));
  CASES = cases;
  // Cheile corectate față de cursul meu se aplică peste grilele din bancă.
  for (const c of CH_LIST) for (const [id, f] of Object.entries(c.keyFix || {})) { const x = GQ_BY[id]; if (x) { x.k = f.k; x.n = f.n; x.m = true; } }
}
const chTitle = (id) => CH[id]?.title || 'Fără capitol';

/* ---------- progres (browser + cont) ---------- */
const LS_KEY = 'semio-srs-v1';
let store = ls.get(LS_KEY, null) || { s: {}, g: {}, meta: { newLimit: 25, newDay: '', newCount: 0 }, updated: 0 };
if (!store.g) store.g = {}; if (!store.s) store.s = {}; if (!store.meta) store.meta = { newLimit: 25, newDay: '', newCount: 0 };
let remoteDoc = null, saving = false, pending = false, saveTimer = null;
const syncEl = $('#sync');
function scheduleSave() { store.updated = Date.now(); ls.set(LS_KEY, store); if (!remoteDoc) return; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200); }
async function flush() {
  if (!remoteDoc) return;
  if (saving) { pending = true; return; }
  saving = true;
  try { await remoteDoc.set(JSON.parse(JSON.stringify(store))); syncEl.textContent = 'Progres: sincronizat cu contul tău · ' + new Date().toLocaleTimeString(); }
  catch (e) { syncEl.textContent = 'Progres: salvat în acest browser'; }
  saving = false;
  if (pending) { pending = false; flush(); }
}

/* =====================================================================
   Repetiție spațiată
   ===================================================================== */
const DAY = 864e5;
function dueAt(days) { const d = new Date(); d.setHours(4, 0, 0, 0); return d.getTime() + days * DAY; }
function status(id) { const c = store.s[id]; if (!c) return 'new'; return c.i >= 21 ? 'mat' : 'learn'; }
function previewIntervals(c) {
  const r = c ? c.r : 0, i = c ? c.i : 0, e = c ? c.e : 2.5;
  return { hard: r === 0 ? 1 : Math.max(1, Math.round(i * 1.2)), good: r === 0 ? 1 : r === 1 ? 3 : Math.round(i * e), easy: r === 0 ? 3 : Math.round(Math.max(i, 1) * e * 1.3) };
}
function rollDay() { if (store.meta.newDay !== today()) { store.meta.newDay = today(); store.meta.newCount = 0; } }
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
}
const secSel = $('#sec-filter'), limitIn = $('#new-limit');
function counts(f) {
  rollDay();
  const now = Date.now(); let due = 0, nw = 0, learn = 0, mat = 0;
  const ids = CARDS.filter((c) => !f || c.ch === f);
  ids.forEach((c) => { const s = store.s[c.id]; if (!s) nw++; else { if (s.d <= now) due++; s.i >= 21 ? mat++ : learn++; } });
  return { due, newLeft: Math.max(0, Math.min(nw, store.meta.newLimit - store.meta.newCount)), learn, mat, ids };
}
function buildQueue(f) {
  const { newLeft, ids } = counts(f); const now = Date.now();
  const due = ids.filter((c) => store.s[c.id] && store.s[c.id].d <= now).sort((a, b) => store.s[a.id].d - store.s[b.id].d).map((c) => c.id);
  const fresh = ids.filter((c) => !store.s[c.id]).slice(0, newLeft).map((c) => c.id);
  const q = []; let i = 0, j = 0;
  while (i < due.length || j < fresh.length) { if (i < due.length) q.push(due[i++]); if (i < due.length) q.push(due[i++]); if (j < fresh.length) q.push(fresh[j++]); }
  return q;
}
limitIn.value = store.meta.newLimit;
limitIn.addEventListener('change', () => { store.meta.newLimit = Math.max(0, Math.min(200, +limitIn.value || 0)); scheduleSave(); refreshStats(); });
secSel.addEventListener('change', () => { refreshStats(); if (!started) renderCard(); });
let queue = [], cur = null, shown = false, reviewed = 0, started = false;
function refreshStats() { const c = counts(secSel.value); $('#st-due').textContent = c.due; $('#st-new').textContent = c.newLeft; $('#st-learn').textContent = c.learn; $('#st-mat').textContent = c.mat; }
const fmtD = (d) => (d < 1 ? '10m' : d + 'z');
const noChapters = () => `<div class="card done"><div class="q">Încarcă întâi cursul</div><p class="hint">În tabul Documente încarci cursul de ${esc(SUBJ_BY[CUR].label)}; apoi aici apar cardurile capitolelor tale.</p></div>`;
function renderCard() {
  const box = $('#session');
  if (!CH_LIST.length) { box.innerHTML = noChapters(); return; }
  if (!cur && !started) {
    const c = counts(secSel.value);
    box.innerHTML = c.ids.length ? `<div class="card done"><div class="q">${c.due + c.newLeft} carduri pregătite</div><p class="hint">${c.due} de repetat · ${c.newLeft} noi. Apasă Începe sesiunea.</p></div>`
      : '<div class="card done"><div class="q">Încă nu ai carduri aici</div><p class="hint">În Documente, la fiecare capitol: „Caută în bancă” sau „+ Carduri”.</p></div>';
    return;
  }
  if (!cur) {
    box.innerHTML = reviewed ? `<div class="card done"><div class="q">Sesiune încheiată: ${reviewed} repetări</div><p class="hint">Revino mâine. Pauzele dintre repetări fixează informația.</p></div>`
      : '<div class="card done"><div class="q">Nimic de repetat acum</div><p class="hint">Mărește limita de carduri noi sau alege alt capitol.</p></div>';
    refreshStats(); return;
  }
  const c = CARD_BY[cur];
  if (!c) { cur = queue.shift() || null; return renderCard(); }
  const p = previewIntervals(store.s[cur]), st = status(cur);
  box.innerHTML = `<div class="card">
    <div class="meta"><span>${esc(chTitle(c.ch))}${c.sec ? ' · ' + esc(c.sec) : ''}</span><span><span class="pill p-${st}">${st === 'new' ? 'NOU' : st === 'mat' ? 'CONSOLIDAT' : 'ÎN ÎNVĂȚARE'}</span> · ${queue.length} rămase</span></div>
    <div class="q">${esc(c.front)}</div>
    ${shown ? `<div class="a">${esc(c.back)}</div>
      <div class="grades"><button class="g-again" data-g="0">Din nou<small>10m · 1</small></button><button class="g-hard" data-g="1">Greu<small>${fmtD(p.hard)} · 2</small></button><button class="g-good" data-g="2">Bine<small>${fmtD(p.good)} · 3</small></button><button class="g-easy" data-g="3">Ușor<small>${fmtD(p.easy)} · 4</small></button></div>`
      : '<button class="btn primary" id="show">Arată răspunsul</button><p class="hint">Răspunde întâi cu voce tare sau pe hârtie.</p>'}
  </div>`;
  const sb = $('#show'); if (sb) sb.onclick = () => { shown = true; renderCard(); };
  box.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => doGrade(+b.dataset.g)));
}
function doGrade(g) { if (!cur || !shown) return; grade(cur, g); reviewed++; if (g === 0) queue.splice(Math.min(3, queue.length), 0, cur); cur = queue.shift() || null; shown = false; renderCard(); refreshStats(); }
$('#start').onclick = () => { started = true; queue = buildQueue(secSel.value); reviewed = 0; cur = queue.shift() || null; shown = false; renderCard(); };
document.addEventListener('keydown', (e) => {
  if ($('#tab-review').hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !$('#modal').hidden) return;
  if (e.code === 'Space' && cur && !shown) { e.preventDefault(); shown = true; renderCard(); }
  else if (shown && ['1', '2', '3', '4'].includes(e.key)) doGrade(+e.key - 1);
});

/* ---------- tab-uri și selectoare ---------- */
const onShow = {};
function showTab(name) {
  $$('nav.tabs button').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === name));
  $$('section.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  onShow[name]?.();
  ls.set('semio-tab', name);
}
$$('nav.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
function chOptions(sel, { all = false } = {}) {
  const v = sel.value;
  sel.innerHTML = (all ? '<option value="">Toate capitolele</option>' : '') + CH_LIST.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('') + (!all && !CH_LIST.length ? '<option value="">Niciun capitol încă</option>' : '');
  if ([...sel.options].some((o) => o.value === v)) sel.value = v;
}

/* =====================================================================
   Cazuri clinice
   ===================================================================== */
let caseRight = 0, caseDone = 0;
const caseList = () => CASES.filter((c) => !$('#case-ch').value || c.ch === $('#case-ch').value);
function renderCases() {
  const list = caseList(); caseRight = 0; caseDone = 0;
  $('#cases').innerHTML = !CH_LIST.length ? '<p class="hint">Încarcă întâi cursul în tabul Documente.</p>' : shuffle(list.map((_, i) => i)).map((ci, n) => { const c = list[ci]; return `<div class="case" data-c="${ci}"><b>${n + 1}.</b> ${esc(c.q)}
    <div class="opts">${c.o.map((o, k) => `<button data-k="${k}">${esc(o)}</button>`).join('')}</div><div class="why" hidden>${esc(c.w)}</div></div>`; }).join('') || '<p class="hint">Încă nu ai cazuri aici. În Documente, la capitol: „Caută în bancă” sau „+ Cazuri”.</p>';
  $('#cases').querySelectorAll('.case').forEach((el) => el.querySelectorAll('.opts button').forEach((btn) => (btn.onclick = () => {
    if (el.dataset.done) return; el.dataset.done = 1;
    const c = list[+el.dataset.c], k = +btn.dataset.k;
    el.querySelectorAll('.opts button')[c.a]?.classList.add('right');
    if (k !== c.a) btn.classList.add('wrong'); else caseRight++;
    caseDone++; el.querySelector('.why').hidden = false; updScore();
  })));
  updScore();
}
function updScore() { $('#case-score').textContent = caseDone ? `Scor: ${caseRight}/${caseDone}` : `${caseList().length} cazuri`; }
$('#case-shuffle').onclick = renderCases;
$('#case-ch').onchange = renderCases;

/* =====================================================================
   Grile: exersare și simulare de examen
   ===================================================================== */
const gstat = (id) => (store.g && store.g[id]) || null;
function gRecord(id, ok) { const s = store.g[id] || [0, 0, 0]; s[0]++; if (ok) s[1]++; s[2] = ok ? 1 : 0; store.g[id] = s; scheduleSave(); }
const gFilt = { ch: $('#g-ch'), src: $('#g-src'), type: $('#g-type'), wrong: $('#g-wrong'), fixed: $('#g-fixed') };
const srcKind = (x) => (x.bank ? 'bank' : x.src === 'ai' ? 'ai' : 'mine');
function fillGFilters() {
  chOptions(gFilt.ch, { all: true });
  const v = gFilt.src.value;
  const kinds = [['bank', 'Din bancă'], ['ai', 'Generate de AI'], ['mine', 'Grilele mele']].filter(([k]) => GQ.some((x) => srcKind(x) === k));
  gFilt.src.innerHTML = '<option value="">Toate sursele</option>' + kinds.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  if ([...gFilt.src.options].some((o) => o.value === v)) gFilt.src.value = v;
}
function gPool() {
  return GQ.filter((x) => (!gFilt.ch.value || x.ch === gFilt.ch.value) && (!gFilt.src.value || srcKind(x) === gFilt.src.value) &&
    (!gFilt.type.value || (gFilt.type.value === 's' ? x.k.length === 1 : x.k.length > 1)) &&
    (!gFilt.wrong.checked || (gstat(x.id) && gstat(x.id)[2] === 0)) && (!gFilt.fixed.checked || x.m || (x.n && x.src !== 'new' && x.src !== 'ai')));
}
function gRenderStats() {
  $('#g-stats').innerHTML = CH_LIST.map((c) => {
    const all = GQ.filter((x) => x.ch === c.id), done = all.filter((x) => gstat(x.id)), right = done.filter((x) => gstat(x.id)[2] === 1).length;
    const pct = done.length ? Math.round(100 * right / done.length) : 0;
    return `<div class="gstat"><span>${esc(c.title)}</span><b>${done.length}/${all.length}</b><div class="bar"><i style="width:${done.length ? pct : 0}%"></i></div><small>${done.length ? pct + '% corecte la ultima încercare' : 'neînceput'}</small></div>`;
  }).join('');
  $('#g-count').textContent = CH_LIST.length ? gPool().length + ' grile găsite' : 'Încarcă întâi cursul în tabul Documente.';
}
Object.values(gFilt).forEach((el) => el.addEventListener('change', gRenderStats));
let gMode = null, gList = [], gPos = 0, gSel = new Set(), gChecked = false, gAns = {};
function gStart(mode) {
  const pool = gPool();
  if (!pool.length) { $('#gq').innerHTML = '<div class="card done"><div class="q">Nicio grilă pentru aceste filtre</div><p class="hint">În Documente, la fiecare capitol: „Caută în bancă” sau „+ Grile”.</p></div>'; return; }
  gMode = mode; gPos = 0; gAns = {};
  gList = shuffle(pool).slice(0, mode === 'exam' ? Math.min(+$('#g-n').value || 30, pool.length) : pool.length).map((x) => x.id);
  gSel = new Set(); gChecked = false; gRender();
}
const letters = (arr) => arr.map((i) => 'abcde'[i]).join(', ');
function gNoteHtml(x) {
  let note = x.n;
  if (!note && x.src === 'y21') note = 'Sursa nu avea cheie; cheia este stabilită după cursul din 2022.';
  const badge = x.m ? '<span class="pill p-learn">CHEIE CORECTATĂ</span> ' : '';
  return (note ? `<div class="why gnote">${badge}${esc(note)}</div>` : x.m ? `<div class="why gnote">${badge}</div>` : '') + (x.e ? `<div class="why gnote">${esc(x.e)}</div>` : '');
}
const sameSet = (set, arr) => set.size === arr.length && arr.every((i) => set.has(i));
function gRender() {
  const box = $('#gq');
  if (gMode === 'exam' && gPos >= gList.length) return gExamResult();
  if (gMode === 'practice' && gPos >= gList.length) { box.innerHTML = `<div class="card done"><div class="q">Ai parcurs toate cele ${gList.length} grile</div><p class="hint">Bifează „Doar greșelile mele” și reia.</p></div>`; gRenderStats(); return; }
  const x = GQ_BY[gList[gPos]];
  if (!x) { gList.splice(gPos, 1); return gRender(); }
  const multi = x.k.length > 1, sel = gMode === 'exam' ? new Set(gAns[x.id] || []) : gSel, show = gMode === 'practice' && gChecked;
  const opts = x.o.map((o, i) => { let cls = sel.has(i) ? 'on' : ''; if (show) { const ok = x.k.includes(i); cls = ok ? (sel.has(i) ? 'right' : 'missed') : (sel.has(i) ? 'wrong' : ''); }
    return `<button class="gopt ${cls}" data-i="${i}" ${show ? 'disabled' : ''}><span class="gl">${'abcde'[i]}</span><span>${esc(o)}</span></button>`; }).join('');
  let verdict = '';
  if (show) { const ok = sameSet(sel, x.k), part = !ok && x.k.some((i) => sel.has(i)); verdict = `<div class="gverdict ${ok ? 'ok' : part ? 'part' : 'bad'}">${ok ? 'Corect' : part ? 'Parțial corect' : 'Greșit'} · răspuns: <b>${letters(x.k)}</b></div>${gNoteHtml(x)}`; }
  box.innerHTML = `<div class="card">
    <div class="meta"><span>${esc(chTitle(x.ch))} · ${esc(srcLabel(x.src))}</span><span>${gPos + 1} / ${gList.length}</span></div>
    <div><span class="pill ${multi ? 'p-new' : 'p-mat'}">${multi ? 'COMPLEMENT MULTIPLU · 2–5 răspunsuri' : 'COMPLEMENT SIMPLU · 1 răspuns'}</span>${x.src === 'ai' ? ' <span class="pill p-ai">SCRISĂ DE AI</span>' : ''}</div>
    <div class="q">${esc(x.q)}</div><div class="gopts">${opts}</div>${verdict}
    <div class="controls" style="margin:0">
      ${gMode === 'practice' ? (show ? '<button class="btn primary" id="g-next">Următoarea →</button>' : '<button class="btn primary" id="g-check">Verifică</button>')
        : `<button class="btn" id="g-prev" ${gPos ? '' : 'disabled'}>← Înapoi</button><button class="btn primary" id="g-next">${gPos === gList.length - 1 ? 'Termină examenul' : 'Următoarea →'}</button><span class="hint">${Object.keys(gAns).length} răspunse</span>`}
      <button class="btn" id="g-stop">Oprește</button></div>
    <p class="hint" style="margin:0">Taste: 1–5 aleg variantele, Enter verifică sau trece mai departe.</p></div>`;
  box.querySelectorAll('.gopt').forEach((b) => (b.onclick = () => gToggle(+b.dataset.i)));
  const ck = $('#g-check'); if (ck) ck.onclick = gCheck;
  const nx = $('#g-next'); if (nx) nx.onclick = gNext;
  const pv = $('#g-prev'); if (pv) pv.onclick = () => { gPos--; gRender(); };
  $('#g-stop').onclick = () => { if (gMode === 'exam' && Object.keys(gAns).length) { gList = gList.filter((id) => gAns[id]); return gExamResult(); } gMode = null; box.innerHTML = ''; gRenderStats(); };
}
function gToggle(i) {
  const x = GQ_BY[gList[gPos]]; const multi = x.k.length > 1;
  if (gMode === 'practice') { if (gChecked) return; if (!multi) gSel = new Set(gSel.has(i) ? [] : [i]); else gSel.has(i) ? gSel.delete(i) : gSel.add(i); }
  else { const s = new Set(gAns[x.id] || []); if (!multi) { s.clear(); if (!(gAns[x.id] || []).includes(i)) s.add(i); } else s.has(i) ? s.delete(i) : s.add(i); if (s.size) gAns[x.id] = [...s]; else delete gAns[x.id]; }
  gRender();
}
function gCheck() { if (!gSel.size) return; const x = GQ_BY[gList[gPos]]; gChecked = true; gRecord(x.id, sameSet(gSel, x.k)); gRender(); }
function gNext() { if (gMode === 'practice') { gPos++; gSel = new Set(); gChecked = false; gRender(); gRenderStats(); } else { gPos++; gRender(); } }
function gExamResult() {
  let right = 0;
  const rows = gList.filter((id) => GQ_BY[id]).map((id) => { const x = GQ_BY[id], a = new Set(gAns[id] || []), ok = sameSet(a, x.k); if (ok) right++; gRecord(id, ok); return { x, a, ok }; });
  const pct = rows.length ? Math.round(100 * right / rows.length) : 0, wrong = rows.filter((r) => !r.ok);
  $('#gq').innerHTML = `<div class="card"><div class="q">Rezultat: ${right} / ${rows.length} corecte (${pct}%)</div>
    <p class="hint">O grilă contează doar dacă ai ales exact variantele corecte.</p>
    ${wrong.length ? `<h3>Revizuiește cele ${wrong.length} greșite</h3>` + wrong.map((r) => `<div class="case"><b>${esc(r.x.q)}</b>
      <div class="opts">${r.x.o.map((o, i) => `<div class="gopt ${r.x.k.includes(i) ? (r.a.has(i) ? 'right' : 'missed') : (r.a.has(i) ? 'wrong' : '')}"><span class="gl">${'abcde'[i]}</span><span>${esc(o)}</span></div>`).join('')}</div>
      <div class="gverdict bad">Răspunsul tău: <b>${r.a.size ? letters([...r.a].sort()) : '—'}</b> · corect: <b>${letters(r.x.k)}</b></div>${gNoteHtml(r.x)}</div>`).join('') : '<p>Nicio greșeală.</p>'}
    <div class="controls"><button class="btn primary" id="g-again">Examen nou</button></div></div>`;
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
   Dialog, notificări, job-uri
   ===================================================================== */
function ask(text, { input = null, ok = 'OK', cancel = 'Renunță' } = {}) {
  return new Promise((resolve) => {
    const m = $('#modal'), inp = $('#modal-input');
    $('#modal-text').textContent = text; inp.hidden = input === null; inp.value = input ?? '';
    $('#modal-yes').textContent = ok; $('#modal-no').textContent = cancel; m.hidden = false;
    (input === null ? $('#modal-yes') : inp).focus();
    const done = (v) => { m.hidden = true; $('#modal-yes').onclick = $('#modal-no').onclick = inp.onkeydown = null; resolve(v); };
    $('#modal-yes').onclick = () => done(input === null ? true : inp.value.trim() || null);
    $('#modal-no').onclick = () => done(input === null ? false : null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('#modal-yes').click(); if (e.key === 'Escape') { e.preventDefault(); $('#modal-no').click(); } };
  });
}
function toast(msg, ms = 4500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
const jobs = [];
function renderJobs() {
  $('#jobs').hidden = !jobs.length;
  const running = jobs.filter((j) => j.state === 'run').length;
  $('#jobs-count').textContent = running ? `${running} în lucru` : '';
  $('#jobs-list').innerHTML = jobs.slice().reverse().map((j) => `<div class="job ${j.state}"><div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${esc(j.title)}</b>${j.state === 'run' ? `<button class="btn small" data-abort="${j.id}">Oprește</button>` : ''}</div>
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
  catch (err) { console.error(err); job.state = 'err'; job.text = job.ctrl.signal.aborted || err?.code === 'cancelled' ? 'Oprit.' : 'Problemă: ' + (err?.message || err); }
  renderJobs(); refreshAll();
  if (job.state === 'done') setTimeout(() => { const k = jobs.indexOf(job); if (k >= 0) { jobs.splice(k, 1); renderJobs(); } }, 8000);
  return job.state === 'done';
}
const busy = new Set(); // capitolele la care se lucrează acum

/* =====================================================================
   Capabilitățile paginii Claude
   ===================================================================== */
const R = { db: null, user: null, sample: null, tts: null, dl: null, ready: false, uid: null, images: null, isOwner: false };
const SNAP = window.SNAPSHOT && window.SNAPSHOT.p ? window.SNAPSHOT : null;
const aiReady = () => !!R.sample && !SNAP;
function needAI() {
  if (aiReady()) return false;
  toast(!R.ready ? 'Încă mă conectez la Claude… încearcă din nou peste câteva clipe.' : 'Deschide pagina în Claude (autentificat) ca să folosești funcțiile AI.');
  return true;
}
function aiErr(e) {
  const map = { not_granted: 'Nu ai permis paginii să folosească Claude. Reîncarcă pagina ca să fii întrebat din nou.', rate_limited: 'Ai atins deocamdată limita de utilizare Claude. Încearcă mai târziu.',
    sampling_disabled: 'Claude nu este disponibil pentru acest cont.', prompt_too_large: 'Materialul trimis e prea mare. Împarte documentul în fișiere mai mici.',
    refused: 'Claude a refuzat cererea. Încearcă alt material.', invalid_json: 'Răspunsul lui Claude nu a putut fi citit. Încearcă din nou.', session_expired: 'Sesiunea Claude a expirat. Autentifică-te din nou.', empty_completion: 'Claude nu a răspuns nimic. Încearcă din nou.' };
  const err = new Error(map[e?.code] || e?.message || 'Claude nu a putut răspunde. Încearcă din nou.'); err.code = e?.code; return err;
}
async function askJSON(prompt, { signal, onChars, tier = 'default' } = {}) {
  if (!R.sample) throw new Error('Claude nu este disponibil aici.');
  try { return await R.sample.json(prompt, { signal, modelTier: tier, cache: false, onText: onChars ? ({ text }) => onChars(text.length) : undefined }); } catch (e) { throw aiErr(e); }
}
async function askText(prompt, { signal, onText, tier = 'default', images } = {}) {
  if (!R.sample) throw new Error('Claude nu este disponibil aici.');
  try { return (await R.sample(prompt, { signal, modelTier: tier, cache: false, onText: onText ? ({ text }) => onText(text) : undefined, ...(images ? { images } : {}) })).text; } catch (e) { throw aiErr(e); }
}

let refreshTimer = null;
const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshAll, 150); };
function subscribeBank() {
  R.db.collection('sources').onSnapshot((snap) => {
    BANK.sources = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.kind === 'grile'); rebuildBank(); refreshSoon();
    if (R.isOwner && !R.bankStarted) { R.bankStarted = true; setTimeout(readBank, 1500); }
  }, () => {});
  R.db.collection('grile').onSnapshot((snap) => { BANK.packs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); rebuildBank(); refreshSoon(); }, () => {});
}

async function initRuntime() {
  if (window.claude?.use && !SNAP) {
    const use = (n) => window.claude.use(n).catch(() => null);
    [R.db, R.user, R.sample, R.tts, R.dl] = await Promise.all(['db', 'user', 'sample', 'tts', 'downloads'].map(use));
    if (R.user) { R.uid = await R.user.id?.().catch(() => null); R.isOwner = !!(await R.user.isOwner?.().catch(() => false)); }
    if (R.sample) R.images = (await R.sample.limits?.().catch(() => null))?.images || null;
  }
  if (!SNAP) {
    await PS.init(R.db, R.uid);
    for (const k of Object.keys(P)) P[k] = await PS.all(k).catch(() => []);
  }
  R.ready = true;
  if (R.db) {
    subscribeBank();
    if (R.uid) {
      try {
        remoteDoc = R.db.doc('data/users/' + R.uid + '/progress');
        const snap = await remoteDoc.get(); const r = snap.exists ? snap.data() : null;
        if (r && r.s && (r.updated || 0) > (store.updated || 0)) { store = JSON.parse(JSON.stringify(r)); if (!store.g) store.g = {}; ls.set(LS_KEY, store); } else if (store.updated) flush();
        syncEl.textContent = 'Progres: sincronizat cu contul tău';
      } catch (e) { remoteDoc = null; }
    }
  }
  refreshAll();
  if (!CH_LIST.length && !SNAP) showTab('sources');
}

/* =====================================================================
   Citirea fișierelor
   ===================================================================== */
const CDN = { pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js', mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js' };
const loaded = {};
function loadScript(src) { return (loaded[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Nu s-a putut încărca cititorul de fișiere. Verifică conexiunea.')); document.head.appendChild(s); })); }
async function pdfLib() { await loadScript(CDN.pdfWorker); await loadScript(CDN.pdf); window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker; return window.pdfjsLib; }
function fileKind(file) { const n = file.name.toLowerCase(); if (n.endsWith('.pdf')) return 'pdf'; if (n.endsWith('.docx')) return 'docx'; if (/\.(png|jpe?g|webp|gif)$/.test(n)) return 'image'; if (/\.(html?|xhtml)$/.test(n)) return 'html'; return 'text'; }
async function extractText(file, onProgress) {
  const kind = fileKind(file);
  if (kind === 'pdf') {
    const pdf = await (await pdfLib()).getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent(); let out = '';
      for (const it of content.items) out += it.str + (it.hasEOL ? '\n' : (it.str.endsWith(' ') ? '' : ' '));
      pages.push(out.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim()); onProgress(i / pdf.numPages);
    }
    return { text: pages.join('\n\n'), pages: pdf.numPages, pdf };
  }
  if (kind === 'docx') { await loadScript(CDN.mammoth); return { text: (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value }; }
  if (kind === 'html') { const d = new DOMParser().parseFromString(await file.text(), 'text/html'); return { text: d.body.innerText || d.body.textContent || '' }; }
  if (kind === 'image') return { text: '' };
  return { text: await file.text() };
}
async function pdfPagesToImages(pdf, from, to) {
  const out = [];
  for (let i = from; i <= to; i++) {
    const page = await pdf.getPage(i), vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)));
  }
  return out;
}
async function transcribe(images, job, label) {
  if (!R.images) throw new Error('Această vizualizare nu poate trimite imagini lui Claude, deci paginile scanate nu pot fi citite aici. Folosește un PDF cu text selectabil.');
  const per = Math.max(1, Math.min(R.images.maxCount || 1, 5)); let text = '';
  for (let i = 0; i < images.length; i += per) {
    job.status(`${label}: transcriu paginile ${i + 1}–${Math.min(i + per, images.length)} din ${images.length}…`); job.progress(i / images.length);
    text += '\n\n' + await askText('These are photos/scans of pages from a medical course or a question bank (in Romanian). Transcribe ALL the text faithfully, in the original language, in reading order, keeping headings, numbering, lists, answer options and any answer keys. Write tables as Markdown tables. Output only the transcription, with no comments.', { signal: job.signal, images: images.slice(i, i + per) });
  }
  return text.trim();
}
async function readFile(file, job) {
  const fk = fileKind(file); let text = '', transcribed = false, pages = 0;
  if (fk === 'image') { text = await transcribe([file], job, file.name); transcribed = true; }
  else {
    job.status('Extrag textul…');
    const r = await extractText(file, (f) => job.progress(f)); text = r.text.trim();
    if (fk === 'pdf') pages = r.pages;
    if (fk === 'pdf' && text.length < (r.pages || 1) * 150) {
      if (r.pages > 60) throw new Error(`PDF-ul pare scanat (${r.pages} pagini). Împarte-l în părți de cel mult 60 de pagini sau folosește un PDF cu text selectabil.`);
      job.status('PDF scanat: pregătesc paginile…'); text = await transcribe(await pdfPagesToImages(r.pdf, 1, r.pages), job, file.name); transcribed = true;
    }
  }
  if (!text) throw new Error('Nu am găsit text în fișier.');
  job.progress(null);
  return { text, transcribed, pages };
}
function splitBlocks(text, target = 700) {
  const blocks = []; let cur = '';
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (cur.length + line.length > target * 1.6 && cur.length) { blocks.push(cur.trim()); cur = ''; }
    if (line.length > target * 2.5) { for (let i = 0; i < line.length; i += target) blocks.push(line.slice(i, i + target).trim()); continue; }
    cur += line + '\n';
    if (cur.length >= target && /[.:;!?)]\s*$/.test(line)) { blocks.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) blocks.push(cur.trim());
  return blocks.filter(Boolean);
}
function chunkBlocks(blocks, maxChars, overlap = 0) {
  const chunks = []; let cur = [], len = 0;
  for (const b of blocks) { if (len + b.length > maxChars && cur.length) { chunks.push(cur.join('\n')); cur = overlap ? cur.slice(-overlap) : []; len = cur.reduce((s, x) => s + x.length + 1, 0); } cur.push(b); len += b.length + 1; }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}

/* =====================================================================
   AI pe documentele mele
   ===================================================================== */
const MAX_MATERIAL = 120000;
const sectionTitles = (c) => Object.values(c.sections || {});
const topicsOf = (c) => (sectionTitles(c).length ? sectionTitles(c) : c.topics || []);
async function chapterMaterial(c, part = 0) {
  let t = '';
  for (const r of c.ranges || []) { const d = P.docs.find((x) => x.id === r.docId); if (!d) continue; t += `\n\n### ${d.name}\n` + (await docBlocks(d.id)).slice(Math.max(0, r.fromBlock), r.toBlock + 1).join('\n'); }
  t = t.trim();
  const parts = Math.max(1, Math.ceil(t.length / MAX_MATERIAL)), i = ((part % parts) + parts) % parts;
  return { text: t.slice(i * MAX_MATERIAL, (i + 1) * MAX_MATERIAL), parts };
}
const chapterHeader = (c) => `MATERIA: ${SUBJ_BY[c.subject].label}\nCAPITOL: ${c.title}\nSubteme: ${topicsOf(c).join('; ')}`;
function sanitizeQ(q) {
  const options = (q.options || []).map((o) => String(o).replace(/^\s*[A-Ea-e][.)]\s*/, '').trim()).filter(Boolean).slice(0, 5);
  const correct = [...new Set((q.correct || []).map(Number))].filter((c) => Number.isInteger(c) && c >= 0 && c < options.length).sort();
  const stem = String(q.stem || '').trim();
  if (options.length < 2 || !correct.length || !stem) return null;
  return { q: stem, o: options, k: correct, e: String(q.explanation || '').trim(), t: String(q.topic || '') };
}
const qText = (x, i) => `${i + 1}. (${x.k.length > 1 ? 'CM' : 'CS'}) ${x.q}\n${x.o.map((o, k) => `${'ABCDE'[k]}. ${o}`).join('\n')}\nRăspuns: ${x.k.map((k) => 'ABCDE'[k]).join(', ')}`;
const EXTRACT_RULES = 'Copiază fidel enunțul și variantele (fără litera din față). "correct" = indicii corecți (0=A … 4=E); dacă documentul dă cheia, folosește-o ("answerSource":"cheie"), altfel deduce-o ("answerSource":"dedus"). Ignoră grilele tăiate la margini, întrebările fără variante, textele care nu sunt grile și grilele care nu sunt în română. Nu inventa.';

// 1. Cursul meu → capitole (capitolele cărții; altfel ~N pagini)
async function splitDoc(job, d) {
  const blocks = await docBlocks(d.id);
  const perPage = d.pages ? Math.max(800, d.chars / d.pages) : 2200;
  const want = getSettings().pagesPerChapter || 50;
  const blocksPerChapter = Math.round((want * perPage) / Math.max(1, d.chars / Math.max(1, blocks.length)));
  const groups = []; let g = [], len = 0;
  blocks.forEach((b, i) => { if (len + b.length > MAX_MATERIAL && g.length) { groups.push(g); g = []; len = 0; } g.push(i); len += b.length + 8; });
  if (g.length) groups.push(g);
  const created = [];
  for (let gi = 0; gi < groups.length; gi++) {
    job.status(`Împart „${d.name}” pe capitole (${gi + 1}/${groups.length})…`); job.progress(gi / groups.length);
    const ids = groups[gi], mine = myChapters(d.subject);
    const pagesOf = (c) => Math.round((c.ranges || []).filter((r) => r.docId === d.id).reduce((n, r) => n + blocks.slice(r.fromBlock, r.toBlock + 1).join('').length, 0) / perPage);
    const existing = mine.map((c) => `- ${c.id}: ${c.title}${pagesOf(c) ? ` [~${pagesOf(c)} pagini din acest document]` : ''}`).join('\n');
    const res = await askJSON(
      `Ești profesor universitar de medicină și organizezi materia de examen la ${SUBJ_BY[d.subject].label}. Mai jos e un fragment dintr-un document de curs, împărțit în blocuri numerotate [§n].\n` +
      'Împarte fragmentul în capitole de studiu, în ordinea din material, după această regulă:\n' +
      '• Dacă documentul este o CARTE/un tratat cu capitole proprii (Capitolul I, II…), un capitol de aici = un capitol al cărții, oricât de lung ar fi; subcapitolele NU devin capitole separate (pune-le în "topics"). Folosește titlul capitolului din carte.\n' +
      `• Altfel (lucrări practice, cursuri separate, notițe), grupează unitățile consecutive și înrudite în capitole de aproximativ ${want} de pagini (~${blocksPerChapter} blocuri); nu face un capitol pentru fiecare lucrare practică. Titlul rezumă tema grupului.\n` +
      'Nu inventa numerotări de capitole care nu există în document. Intervalele sunt inclusive; ignoră cuprinsul și bibliografia. Titluri, rezumate și subteme în limba română; "topics" = 5-15 subteme concrete.\n' +
      'Dacă o parte din fragment continuă un capitol de mai jos (început într-un fragment anterior; pentru grupuri, doar dacă nu a atins mărimea dorită), pune cheia lui în "existing"; altfel "existing" = "".\n' +
      `\nCAPITOLE EXISTENTE:\n${existing || '(niciunul)'}\n\nRăspunde doar cu JSON: {"chapters":[{"title":"…","existing":"cheie sau \\"\\"","summary":"1-2 fraze","topics":["…"],"fromBlock":n,"toBlock":n}]}\n\n` +
      `<document nume="${d.name}">\n` + ids.map((i) => `[§${i}] ${blocks[i]}`).join('\n') + '\n</document>',
      { signal: job.signal, tier: 'complex', onChars: (n) => job.status(`Împart „${d.name}” (${gi + 1}/${groups.length})… ${n} caractere primite`) });
    for (const c of res.chapters || []) {
      const from = Math.max(ids[0], Math.min(+c.fromBlock, +c.toBlock)), to = Math.min(ids[ids.length - 1], Math.max(+c.fromBlock, +c.toBlock));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
      const range = { docId: d.id, fromBlock: from, toBlock: to };
      const ex = myChapters(d.subject).find((x) => x.id === c.existing);
      if (ex) await pPut('chapters', { ...ex, ranges: [...(ex.ranges || []), range], topics: [...new Set([...(ex.topics || []), ...(c.topics || [])])] });
      else {
        const sections = {}; for (const t of (c.topics || []).slice(0, 15)) sections[uid('s')] = t;
        const nc = { id: uid('ch'), subject: d.subject, title: String(c.title || 'Capitol'), summary: String(c.summary || ''), topics: c.topics || [], sections, ranges: [range], order: Date.now() + created.length, bankQ: [], bankCards: [], bankCases: [] };
        await pPut('chapters', nc); created.push(nc.id);
      }
    }
  }
  await pPut('docs', { ...P.docs.find((x) => x.id === d.id), segmented: true });
  return created;
}

// 2. Alege din bancă doar ce corespunde capitolului meu
async function matchBank(job, c) {
  const kinds = [
    ['bankQ', BANK_Q.filter((x) => x.sj === c.subject), (x) => `${x.q} | ${x.o.join(' | ')}`, 'grile'],
    ['bankCards', BASE_CARDS.filter((x) => x.sj === c.subject), (x) => `${x.front} → ${x.back}`, 'carduri'],
    ['bankCases', BASE_CASES.filter((x) => x.sj === c.subject), (x) => `${x.q} → ${x.o[x.a]}`, 'cazuri'],
  ];
  const head = `${chapterHeader(c)}\nRezumat: ${c.summary || ''}`, found = {};
  for (const [key, list, text, label] of kinds) {
    found[key] = [];
    for (let i = 0; i < list.length; i += 120) {
      if (job.signal.aborted) throw new Error('Oprit.');
      const part = list.slice(i, i + 120);
      job.status(`${c.title}: caut ${label} în bancă (${Math.min(i + 120, list.length)}/${list.length})…`);
      const res = await askJSON(`${head}\n\nMai jos sunt elemente dintr-o bancă de ${label}. Alege DOAR pe cele care testează materia acestui capitol (subiectul lor e tratat în capitol). Fii strict: în caz de îndoială, nu le alege.\n\n` +
        part.map((x, k) => `${k + 1}. ${text(x)}`.slice(0, 380)).join('\n') + '\n\nRăspunde doar cu JSON: {"match":[numerele elementelor alese]}', { signal: job.signal, tier: 'quick' });
      for (const n of res.match || []) { const x = part[+n - 1]; if (x) found[key].push(x.id); }
    }
  }
  const now = P.chapters.find((x) => x.id === c.id) || c;
  await pPut('chapters', { ...now, bankQ: [...new Set([...(now.bankQ || []), ...found.bankQ])], bankCards: [...new Set([...(now.bankCards || []), ...found.bankCards])], bankCases: [...new Set([...(now.bankCases || []), ...found.bankCases])], matchedAt: Date.now() });
  return `${found.bankQ.length} grile, ${found.bankCards.length} carduri, ${found.bankCases.length} cazuri din bancă`;
}

// 3. Grilele mele (fișiere încărcate de persoană) → extrase și puse la capitolele mele
async function extractMyGrile(job, d) {
  const blocks = await docBlocks(d.id), chunks = chunkBlocks(blocks, 20000, 1), tail = blocks.join('\n').slice(-10000);
  const mine = myChapters(d.subject);
  const menu = mine.map((c, i) => `${i + 1}. ${c.title} — ${topicsOf(c).slice(0, 10).join('; ')}`).join('\n');
  const seen = new Set(GQ.map((x) => normStem(x.q))); let added = 0;
  for (let i = P.docs.find((x) => x.id === d.id)?.doneChunks || 0; i < chunks.length; i++) {
    if (job.signal.aborted) throw new Error('Oprit.');
    job.status(`Citesc grilele din „${d.name}” (partea ${i + 1}/${chunks.length})…`); job.progress(i / chunks.length);
    const res = await askJSON('Extragi grile (întrebări cu răspuns multiplu) dintr-un document de examen de medicină, în română. ' + EXTRACT_RULES +
      ' "chapter" = numărul capitolului din listă căruia îi aparține grila, 0 dacă niciunul.\n' +
      `MATERIA: ${SUBJ_BY[d.subject].label}\nCAPITOLE:\n${menu || '(niciunul încă — pune 0)'}\n\n` + (tail && i < chunks.length - 1 ? `FINALUL DOCUMENTULUI (poate conține cheia):\n${tail}\n\n` : '') +
      `FRAGMENTUL ${i + 1}/${chunks.length}:\n${chunks[i]}\n\nRăspunde doar cu JSON: {"questions":[{"stem":"…","options":["…"],"correct":[0],"explanation":"…","topic":"…","chapter":n,"answerSource":"cheie"|"dedus"}]}`, { signal: job.signal });
    const byCh = {};
    for (const raw of res.questions || []) {
      const q = sanitizeQ(raw); if (!q || seen.has(normStem(q.q))) continue; seen.add(normStem(q.q));
      (byCh[mine[(+raw.chapter || 0) - 1]?.id || ''] ||= []).push({ id: uid('m'), ...q, n: raw.answerSource === 'dedus' ? 'Documentul nu dădea cheia acestei grile; cheia a fost stabilită de AI. Verific-o cu cursul.' : '', m: false });
    }
    let n = 0;
    for (const [ch, items] of Object.entries(byCh)) { await pPut('items', { id: uid('p'), kind: 'grile', subject: d.subject, ch, src: d.id, items, createdAt: Date.now() }); n += items.length; }
    added += n;
    const cur = P.docs.find((x) => x.id === d.id);
    await pPut('docs', { ...cur, doneChunks: i + 1, nChunks: chunks.length, extractedCount: (cur.extractedCount || 0) + n });
  }
  await pPut('docs', { ...P.docs.find((x) => x.id === d.id), extractedAt: Date.now() });
  return `„${d.name}”: ${added} grile`;
}

// 4. Generare la cerere, din documentul meu
const Q_JSON = '{"questions":[{"type":"CS" sau "CM","stem":"enunț","options":["A","B","C","D","E" – exact 5 variante, fără litere],"correct":[indici 0-4],"explanation":"1-3 fraze","topic":"subtema"}]}';
async function genGrile(job, c, total) {
  let made = 0, part = 0, fails = 0;
  while (made < total && fails < 2) {
    if (job.signal.aborted) throw new Error('Oprit.');
    const n = Math.min(15, total - made), have = GQ.filter((x) => x.ch === c.id);
    job.status(`${c.title}: scriu grile (${made}/${total})…`); job.progress(made / total);
    const mat = await chapterMaterial(c, part++);
    const res = await askJSON('Ești profesor universitar de medicină și scrii grile pentru examen, în română, în stilul grilelor oficiale: 5 variante (A-E), CS (exact 1 răspuns corect) sau CM (2-4 corecte). ' +
      'Grilele se bazează STRICT pe materialul de mai jos (documentul încărcat de student); testează noțiuni importante; distractori plauzibili; fără „toate/niciuna de mai sus”; ~40% CS, ~60% CM. "explanation" justifică răspunsul cu referire la material. Nu repeta grilele existente.\n\n' +
      `${chapterHeader(c)}\n\nMATERIAL:\n${mat.text}\n\nGRILE EXISTENTE (nu le repeta):\n${have.slice(-150).map((x) => '- ' + x.q.slice(0, 140)).join('\n') || '(niciuna)'}\n\nScrie exact ${n} grile NOI. Răspunde doar cu JSON: ${Q_JSON}`,
      { signal: job.signal, onChars: (k) => job.status(`${c.title}: scriu grile (${made}/${total})… ${k} caractere`) });
    const seen = new Set(have.map((x) => normStem(x.q))), items = [];
    for (const raw of res.questions || []) { const q = sanitizeQ(raw); if (!q || seen.has(normStem(q.q))) continue; seen.add(normStem(q.q)); items.push({ id: uid('a'), ...q, n: '', m: false }); }
    if (!items.length) { fails++; continue; }
    await pPut('items', { id: uid('p'), kind: 'grile', subject: c.subject, ch: c.id, src: 'ai', items, createdAt: Date.now() }); made += items.length;
  }
  return `${made} grile noi`;
}
async function genCards(job, c, total) {
  let made = 0, part = 0, fails = 0;
  while (made < total && fails < 2) {
    if (job.signal.aborted) throw new Error('Oprit.');
    const n = Math.min(30, total - made), have = CARDS.filter((x) => x.ch === c.id);
    job.status(`${c.title}: scriu carduri (${made}/${total})…`); job.progress(made / total);
    const mat = await chapterMaterial(c, part++);
    const res = await askJSON('Scrii flashcard-uri pentru repetiție spațiată, în română. Reguli: o întrebare, un singur răspuns; carduri pe DISCRIMINATORI (ce deosebește noțiunile care se confundă); pragurile numerice primesc card propriu; fața = întrebare scurtă, spatele = răspuns concis (2-5 rânduri separate prin \\n). "section" = subtema. Strict din material.\n\n' +
      `${chapterHeader(c)}\n\nMATERIAL:\n${mat.text}\n\nCARDURI EXISTENTE (nu le repeta):\n${have.slice(-150).map((x) => '- ' + x.front.slice(0, 110)).join('\n') || '(niciunul)'}\n\nScrie exact ${n} carduri NOI. Răspunde doar cu JSON: {"cards":[{"section":"subtema","front":"întrebare","back":"răspuns"}]}`, { signal: job.signal });
    const seen = new Set(have.map((x) => normStem(x.front)));
    const items = (res.cards || []).filter((x) => x.front && x.back && !seen.has(normStem(x.front)) && seen.add(normStem(x.front))).map((x) => ({ id: uid('k'), front: String(x.front).trim(), back: String(x.back).trim(), sec: String(x.section || '') }));
    if (!items.length) { fails++; continue; }
    await pPut('items', { id: uid('p'), kind: 'cards', subject: c.subject, ch: c.id, items, createdAt: Date.now() }); made += items.length;
  }
  return `${made} carduri noi`;
}
async function genCases(job, c, total) {
  let made = 0, part = 0, fails = 0;
  while (made < total && fails < 2) {
    if (job.signal.aborted) throw new Error('Oprit.');
    const n = Math.min(10, total - made), have = CASES.filter((x) => x.ch === c.id);
    job.status(`${c.title}: scriu cazuri (${made}/${total})…`); job.progress(made / total);
    const mat = await chapterMaterial(c, part++);
    const res = await askJSON('Scrii cazuri clinice scurte pentru antrenament, în română. Fiecare caz: o vignetă de 1-3 fraze (vârstă, context, semne concrete, valori), "o" = 4 variante plauzibile care se confundă, "a" = indicele corect (0-3), "w" = raționamentul în 1-3 fraze. Strict din material.\n\n' +
      `${chapterHeader(c)}\n\nMATERIAL:\n${mat.text}\n\nCAZURI EXISTENTE (nu le repeta):\n${have.map((x) => '- ' + x.q.slice(0, 100)).join('\n') || '(niciunul)'}\n\nScrie ${n} cazuri NOI. Răspunde doar cu JSON: {"cases":[{"q":"…","o":["…","…","…","…"],"a":0,"w":"…"}]}`, { signal: job.signal });
    const items = (res.cases || []).filter((x) => x.q && Array.isArray(x.o) && x.o.length >= 2 && x.a >= 0 && x.a < x.o.length).map((x) => ({ id: uid('z'), q: String(x.q), o: x.o.map(String), a: +x.a, w: String(x.w || '') }));
    if (!items.length) { fails++; continue; }
    await pPut('items', { id: uid('p'), kind: 'cases', subject: c.subject, ch: c.id, items, createdAt: Date.now() }); made += items.length;
  }
  return `${made} cazuri noi`;
}
const latest = (ch, type) => P.outputs.filter((o) => o.ch === ch && o.type === type).sort((a, b) => b.createdAt - a.createdAt)[0];
async function saveOutput(ch, type, content) {
  for (const o of P.outputs.filter((o) => o.ch === ch && o.type === type)) await pDel('outputs', o.id);
  await pPut('outputs', { id: uid('o'), ch, type, content, createdAt: Date.now() });
}
async function writeSummary(job, c, onText) {
  const mat = await chapterMaterial(c, 0), qs = GQ.filter((x) => x.ch === c.id);
  const wrong = qs.filter((x) => gstat(x.id) && gstat(x.id)[2] === 0), sample = (wrong.length ? wrong : qs).slice(0, 40);
  const text = await askText('Ești profesor universitar de medicină. Scrie o SINTEZĂ COMPLETĂ PENTRU EXAMEN, în română, în Markdown: densă, structurată, fără umplutură, care permite recapitularea capitolului fără a reciti cursul. ' +
    'Secțiuni (adaptează, omite ce nu se aplică): ## Pe scurt · ## Noțiuni-cheie și definiții · ## Clasificări · ## Mecanisme · ## Clinic, diagnostic, tratament · ## Tabele comparative · ## Cifre și valori de reținut · ## Mnemotehnici · ## Capcane frecvente la grile · ## Autoevaluare (10 întrebări cu răspuns). ' +
    'Folosește **bold** pentru termenii frecvenți la grile. Bazează-te pe material; ce adaugi din afara lui marchează cu „(completare)”. Scrie direct sinteza.\n\n' +
    `${chapterHeader(c)}\n\nMATERIAL${mat.parts > 1 ? ' (prima parte a capitolului)' : ''}:\n${mat.text}\n\n` + (sample.length ? `GRILE DIN CAPITOL:\n${sample.map(qText).join('\n\n').slice(0, 40000)}` : ''),
    { signal: job.signal, tier: 'complex', onText });
  await saveOutput(c.id, 'summary', text);
  return text;
}
async function writePodcast(job, c, minutes) {
  job.status(`${c.title}: scriu episodul…`);
  const mat = await chapterMaterial(c, 0);
  const res = await askJSON('Scrii scenariul unui podcast educațional scurt, în română, pentru studenți la medicină. Doi prezentatori: Ana (explică) și Mihai (întreabă, leagă, recapitulează). Doar ce TREBUIE ținut minte din capitol: idei principale, clasificări, cifre-cheie, diferențe care se confundă la grile, mnemotehnici. Încheie cu „top 5 de reținut”. Textul va fi citit de o voce sintetică: fără Markdown, replici de 1-4 fraze.\n\n' +
    `${chapterHeader(c)}\n\nMATERIAL:\n${mat.text}\n\nLungime: aproximativ ${minutes} minute (~${Math.round(minutes * 145)} de cuvinte). Răspunde doar cu JSON: {"title":"…","lines":[{"speaker":"Ana","text":"…"},{"speaker":"Mihai","text":"…"}]}`,
    { signal: job.signal, onChars: (k) => job.status(`${c.title}: scriu episodul… ${k} caractere`) });
  const content = { title: String(res.title || c.title), lines: (res.lines || []).filter((l) => l.text).map((l) => ({ speaker: l.speaker === 'Mihai' ? 'Mihai' : 'Ana', text: String(l.text) })) };
  if (!content.lines.length) throw new Error('Episodul a venit gol. Încearcă din nou.');
  await saveOutput(c.id, 'podcast', content);
  return content;
}
// Verifică cheile grilelor alese (din bancă sau ale mele) față de cursul meu: cursul are prioritate.
async function verifyKeys(job, c) {
  const todo = GQ.filter((x) => x.ch === c.id && x.src !== 'ai' && !(c.verified || {})[x.id]);
  if (!todo.length) return 'nicio cheie de verificat';
  const mat = await chapterMaterial(c, 0), fixes = { ...(c.keyFix || {}) }, verified = { ...(c.verified || {}) }; let changed = 0;
  for (let i = 0; i < todo.length; i += 30) {
    if (job.signal.aborted) throw new Error('Oprit.');
    const part = todo.slice(i, i + 30);
    job.status(`Verific cheile față de curs (${Math.min(i + 30, todo.length)}/${todo.length})…`); job.progress(i / todo.length);
    const res = await askJSON('Verifici cheile unor grile față de MATERIALUL DE CURS al studentului, care are prioritate. Pentru fiecare grilă: ok=true dacă cheia e corectă conform cursului; altfel ok=false, "correct" = indicii corecți (0=A … 4=E), "note" = explicație scurtă („Cheia din sursă: B; conform cursului corect este C, deoarece …”). Dacă materialul nu acoperă grila: ok=true, note="".\n\n' +
      `${chapterHeader(c)}\n\nMATERIAL:\n${mat.text}\n\nGRILE:\n` + part.map(qText).join('\n\n') + '\n\nRăspunde doar cu JSON: {"results":[{"q":n,"ok":true,"correct":[0],"note":""}]}', { signal: job.signal, tier: 'complex' });
    const by = Object.fromEntries((res.results || []).map((r) => [r.q, r]));
    part.forEach((x, k) => { verified[x.id] = 1; const r = by[k + 1]; if (!r || r.ok) return; const corr = [...new Set((r.correct || []).map(Number))].filter((n) => n >= 0 && n < x.o.length).sort(); if (corr.length && corr.join() !== [...x.k].sort().join()) { fixes[x.id] = { k: corr, n: String(r.note || '') }; changed++; } });
  }
  await pPut('chapters', { ...P.chapters.find((x) => x.id === c.id), keyFix: fixes, verified });
  return `${todo.length} chei verificate față de cursul tău, ${changed} corectate`;
}

/* =====================================================================
   Documentele mele (UI)
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
$('#paste-add').onclick = () => {
  if (needAI()) return;
  const text = $('#paste-text').value.trim(); if (!text) return toast('Lipește întâi un text.');
  const name = $('#paste-name').value.trim() || `Text lipit ${new Date().toLocaleString('ro-RO')}`, kind = upKind, sj = CUR;
  $('#paste-text').value = ''; $('#paste-name').value = '';
  runJob(`Salvez „${name}”`, async (job) => processDoc(job, await saveDoc(name, kind, sj, text, {})), 'upload');
};
async function saveDoc(name, kind, subject, text, extra) {
  const id = uid('d'), blocks = splitBlocks(text);
  await PS.putBlocks(id, blocks); blockCache.set(id, blocks);
  const d = { id, name, kind, subject, chars: text.length, nBlocks: blocks.length, addedAt: Date.now(), ...extra };
  await pPut('docs', d);
  return d;
}
// După încărcare: cursul se împarte pe capitole și se aleg din bancă doar elementele care îi corespund;
// fișierele de grile proprii se citesc. Generarea rămâne la cerere.
async function processDoc(job, d) {
  if (d.kind === 'material') {
    const cur = P.docs.find((x) => x.id === d.id) || d;
    const created = cur.segmented ? myChapters(d.subject).filter((c) => !c.matchedAt && (c.ranges || []).some((r) => r.docId === d.id)).map((c) => c.id) : await splitDoc(job, cur);
    for (const id of created) { busy.add(id); refreshSoon(); try { await matchBank(job, P.chapters.find((x) => x.id === id)); } finally { busy.delete(id); } }
    return `${created.length} capitole, cu ce se potrivește din bancă`;
  }
  return extractMyGrile(job, d);
}
function addFiles(files, kind) {
  const sj = CUR;
  for (const file of files) runJob(`Citesc „${file.name}”`, async (job) => {
    const r = await readFile(file, job);
    const d = await saveDoc(file.name, kind, sj, r.text, { ...(r.transcribed ? { transcribed: true } : {}), ...(r.pages ? { pages: r.pages } : {}) });
    return `Adăugat: ${fmtN(r.text.length)} caractere · ` + await processDoc(job, d);
  }, 'upload');
}

function renderSources() {
  $('#src-access').innerHTML = SNAP ? `<div class="notice info">Versiune de partajare, cu conținutul din ${esc(new Date(SNAP.date).toLocaleDateString('ro-RO'))}. Poți învăța tot ce e aici; pentru documentele tale deschide aplicația în Claude.</div>`
    : !R.ready ? '<div class="notice info">Mă conectez la Claude…</div>'
    : !aiReady() ? '<div class="notice">Deschide pagina în Claude, autentificat, ca să încarci documente și să folosești funcțiile AI.</div>'
    : `<div class="notice info">Documentele tale și tot ce generezi sunt private: doar tu le vezi${PS.mode === 'db' ? '' : ' (salvate în acest browser)'}. Munca AI consumă din utilizarea ta Claude.</div>`;
  $('#upload-box').hidden = !aiReady();
  const ai = aiReady();
  const docs = P.docs.filter((d) => d.subject === CUR);
  const row = (d) => `<div class="srow"><div><div class="nm">${d.kind === 'material' ? '📘' : '📝'} ${esc(d.name)}</div>
    <div class="hint">${fmtN(d.chars || 0)} caractere${d.pages ? ` · ${d.pages} pagini` : ''}${d.transcribed ? ' · transcris de Claude' : ''} · ${d.kind === 'material' ? (d.segmented ? 'împărțit pe capitole' : '<b>neîmpărțit încă</b>') : (d.extractedAt ? `${d.extractedCount ?? 0} grile` : d.doneChunks ? `în citire: ${d.doneChunks}/${d.nChunks}` : '<b>necitit încă</b>')}</div></div>
    ${ai ? `<div class="acts">${(d.kind === 'material' ? !d.segmented : !d.extractedAt) ? `<button class="btn small primary" data-resume="${d.id}">Continuă</button>` : ''}<button class="btn small danger" data-deldoc="${d.id}">Șterge</button></div>` : ''}</div>`;
  $('#src-list').innerHTML = docs.length ? `<div class="box">${docs.map(row).join('')}</div>` : (ai ? `<p class="hint">Încă nu ai documente la ${esc(SUBJ_BY[CUR].label)}. Începe cu cursul.</p>` : '');
  $('#ch-list').innerHTML = (CH_LIST.length ? '<h3>Capitolele mele</h3>' : '') + CH_LIST.map((c) => {
    const q = GQ.filter((x) => x.ch === c.id), qb = q.filter((x) => x.bank).length, qa = q.filter((x) => x.src === 'ai').length;
    const k = CARDS.filter((x) => x.ch === c.id).length, z = CASES.filter((x) => x.ch === c.id).length;
    return `<div class="chap">
      <div class="row"><h4>${esc(c.title)}</h4><span class="sp"></span>${ai ? `<button class="btn small" data-ren="${c.id}">Redenumește</button><button class="btn small danger" data-delch="${c.id}">Șterge</button>` : ''}</div>
      ${c.summary ? `<div class="hint">${esc(c.summary)}</div>` : ''}
      ${topicsOf(c).length ? `<div class="topics">${topicsOf(c).slice(0, 15).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="nums"><div><b>${q.length}</b>grile (${qb} din bancă · ${qa} generate · ${q.length - qb - qa} ale mele)</div><div><b>${k}</b>carduri</div><div><b>${z}</b>cazuri</div></div>
      ${ai ? `<div class="acts">${busy.has(c.id) ? '<span class="hint">În lucru…</span>' : `
        <button class="btn small primary" data-match="${c.id}">${c.matchedAt ? 'Caută din nou în bancă' : 'Caută în bancă'}</button><span class="sep"></span>
        <select data-n="${c.id}" aria-label="Câte">${[10, 20, 50].map((n) => `<option>${n}</option>`).join('')}</select>
        <button class="btn small" data-gen="grile" data-ch="${c.id}">+ Grile</button><button class="btn small" data-gen="cards" data-ch="${c.id}">+ Carduri</button><button class="btn small" data-gen="cases" data-ch="${c.id}">+ Cazuri</button><span class="sep"></span>
        <button class="btn small" data-go="summaries" data-ch="${c.id}">Sinteză</button><button class="btn small" data-go="podcast" data-ch="${c.id}">Podcast</button>
        ${q.some((x) => x.src !== 'ai' && !(c.verified || {})[x.id]) ? `<button class="btn small" data-verify="${c.id}">Verifică cheile</button>` : ''}`}</div>` : ''}
    </div>`;
  }).join('');
}
$('#src-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || needAI()) return;
  const d = P.docs.find((x) => x.id === (b.dataset.deldoc || b.dataset.resume)); if (!d) return;
  if (b.dataset.resume) return runJob(`Continui „${d.name}”`, (job) => processDoc(job, d));
  const chs = P.chapters.filter((c) => (c.ranges || []).some((r) => r.docId === d.id));
  if (!await ask(`Ștergi „${d.name}”?${chs.length ? ` Se șterg și cele ${chs.length} capitole făcute din el, cu tot ce ai generat la ele.` : ''}`, { ok: 'Șterge' })) return;
  for (const c of chs) await deleteChapter(c.id);
  for (const p of P.items.filter((p) => p.src === d.id)) await pDel('items', p.id);
  await PS.delBlocks(d.id); blockCache.delete(d.id);
  await pDel('docs', d.id); refreshAll();
});
async function deleteChapter(id) {
  for (const p of P.items.filter((p) => p.ch === id)) { if (p.kind === 'grile' && p.src !== 'ai') await pPut('items', { ...p, ch: '' }); else await pDel('items', p.id); }
  for (const o of P.outputs.filter((o) => o.ch === id)) await pDel('outputs', o.id);
  await pDel('chapters', id);
}
$('#ch-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.ch || b.dataset.match || b.dataset.ren || b.dataset.delch || b.dataset.verify; const c = CH[id]; if (!c) return;
  if (b.dataset.go) { $(b.dataset.go === 'summaries' ? '#sum-ch' : '#pod-ch').value = id; showTab(b.dataset.go); return; }
  if (needAI()) return;
  if (b.dataset.ren) { const t = await ask('Numele nou al capitolului:', { input: c.title, ok: 'Redenumește' }); if (t) { await pPut('chapters', { ...c, title: t }); refreshAll(); } return; }
  if (b.dataset.delch) { if (await ask(`Ștergi capitolul „${c.title}”, cu tot ce ai generat la el?`, { ok: 'Șterge' })) { await deleteChapter(id); refreshAll(); } return; }
  const work = (title, fn) => { busy.add(id); refreshAll(); runJob(title, fn).finally(() => { busy.delete(id); refreshAll(); }); };
  if (b.dataset.match) work(`Caut în bancă: ${c.title}`, (job) => matchBank(job, c));
  if (b.dataset.verify) work(`Verific cheile: ${c.title}`, (job) => verifyKeys(job, c));
  if (b.dataset.gen) {
    const n = +$(`select[data-n="${id}"]`).value || 10;
    const fn = { grile: genGrile, cards: genCards, cases: genCases }[b.dataset.gen];
    work(`${{ grile: 'Grile', cards: 'Carduri', cases: 'Cazuri' }[b.dataset.gen]}: ${c.title}`, (job) => fn(job, c, n));
  }
});
onShow.sources = renderSources;

/* =====================================================================
   Sinteze
   ===================================================================== */
let sumStreaming = null;
async function saveFile(name, data) {
  if (R.dl) { try { await R.dl.save({ filename: name, data }); } catch (e) { if (e?.code !== 'declined' && e?.code !== 'cancelled') toast('Fișierul nu a putut fi salvat.'); } return; }
  if (window.claude && !SNAP) { toast('Salvarea fișierelor nu e disponibilă aici.'); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain;charset=utf-8' })); a.download = name.replace(/[\\/:*?"<>|]/g, '_'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function renderSummary() {
  const ch = $('#sum-ch').value, o = latest(ch, 'summary');
  $('#sum-gen').textContent = o ? 'Rescrie sinteza' : 'Scrie sinteza';
  $('#sum-gen').hidden = $('#sum-all').hidden = !aiReady();
  $('#sum-status').textContent = CH_LIST.length ? `${CH_LIST.filter((c) => latest(c.id, 'summary')).length}/${CH_LIST.length} capitole au sinteză` : '';
  $('#sum-tools').hidden = !o; $('#sum-print').hidden = true;
  if (o) $('#sum-date').textContent = 'Scrisă la ' + new Date(o.createdAt).toLocaleString('ro-RO');
  if (sumStreaming !== ch) $('#sum-body').innerHTML = o ? md(o.content) : `<p class="hint">${ch ? 'Încă nu e o sinteză pentru acest capitol.' + (aiReady() ? ' Apasă Scrie sinteza.' : '') : 'Încarcă întâi cursul în tabul Documente.'}</p>`;
}
$('#sum-ch').onchange = renderSummary;
function writeSummaries(ids) {
  if (needAI()) return;
  if (!ids.length) return toast('Toate capitolele au deja sinteză.');
  runJob(ids.length > 1 ? `Sinteze (${ids.length} capitole)` : `Sinteză: ${CH[ids[0]].title}`, async (job) => {
    for (let i = 0; i < ids.length; i++) {
      const c = CH[ids[i]]; if (!c) continue;
      job.progress(i / ids.length); job.status(`${c.title}: Claude se gândește…`); sumStreaming = c.id;
      if ($('#sum-ch').value === c.id) $('#sum-body').innerHTML = '<p class="hint">Claude se gândește…</p>';
      try { await writeSummary(job, c, (t) => { job.status(`${c.title}: ${fmtN(t.length)} caractere`); if ($('#sum-ch').value === c.id && !$('#tab-summaries').hidden) $('#sum-body').innerHTML = md(t); }); } finally { sumStreaming = null; }
    }
    return 'Sintezele sunt gata.';
  });
}
$('#sum-gen').onclick = () => { if (CH[$('#sum-ch').value]) writeSummaries([$('#sum-ch').value]); else toast('Încarcă întâi cursul, ca să existe capitole.'); };
$('#sum-all').onclick = () => writeSummaries(CH_LIST.filter((c) => !latest(c.id, 'summary')).map((c) => c.id));
$('#sum-dl').onclick = () => { const o = latest($('#sum-ch').value, 'summary'); if (o) saveFile(`Sinteza - ${chTitle(o.ch)}.md`, `# ${chTitle(o.ch)}\n\n${o.content}`); };
onShow.summaries = renderSummary;

/* =====================================================================
   Podcast (voci Claude; altfel vocea browserului)
   ===================================================================== */
const pod = { playing: false, paused: false, idx: 0, rate: 1, offTts: [] };
function renderPodcast() {
  const ch = $('#pod-ch').value, o = latest(ch, 'podcast');
  $('#pod-gen').textContent = o ? 'Rescrie episodul' : 'Scrie episodul';
  $('#pod-gen').hidden = !aiReady();
  if (!o) { $('#pod-box').innerHTML = `<p class="hint">${ch ? 'Încă nu e un episod pentru acest capitol.' + (aiReady() ? ' Apasă Scrie episodul.' : '') : 'Încarcă întâi cursul în tabul Documente.'}</p>`; return; }
  const canSpeak = !!R.tts || 'speechSynthesis' in window;
  $('#pod-box').innerHTML = `<div class="box">
    <div class="controls"><b style="flex:1">🎙️ ${esc(o.content.title)}</b><button class="btn small" id="pod-dl">Salvează scenariul</button></div>
    ${canSpeak ? `<div class="controls"><button class="btn primary" id="pod-play">${pod.playing ? '⏸ Pauză' : '▶ Redă'}</button><button class="btn" id="pod-stop">⏹ Oprește</button>
      <label class="inline">Viteză <input type="range" id="pod-rate" min="0.7" max="1.5" step="0.1" value="${pod.rate}"></label><span class="hint">${R.tts ? 'Voci Claude' : 'Vocea browserului'} · apasă pe o replică pentru a începe de acolo</span></div>` : '<p class="hint">Citirea cu voce nu e disponibilă aici.</p>'}
    <div id="pod-lines">${o.content.lines.map((l, i) => `<div class="pod-line ${esc(l.speaker)}" data-i="${i}"><b>${esc(l.speaker)}</b>${esc(l.text)}</div>`).join('')}</div></div>`;
  $('#pod-dl').onclick = () => saveFile(`Podcast - ${chTitle(ch)}.txt`, `${o.content.title}\n\n` + o.content.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n\n'));
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
function highlight(i) { $$('.pod-line').forEach((x) => x.classList.toggle('now', +x.dataset.i === i)); if (i >= 0) $(`.pod-line[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
function play(lines, start) {
  stopPod(); pod.playing = true; pod.paused = false; pod.idx = start;
  const btn = $('#pod-play'); if (btn) btn.textContent = '⏸ Pauză';
  if (R.tts) {
    const voice = { Ana: 'airy', Mihai: 'rounded' };
    pod.offTts = [R.tts.onLine(({ line }) => { pod.idx = start + line; highlight(pod.idx); }), R.tts.onState(({ state }) => { if (state === 'idle') { pod.playing = false; pod.paused = false; const b = $('#pod-play'); if (b) b.textContent = '▶ Redă'; } })];
    R.tts.setRate?.(pod.rate);
    R.tts.speak(lines.slice(start, start + 100).map((l) => ({ text: l.text.slice(0, 1900), voice: voice[l.speaker] || 'buttery', language: 'ro' })), { rate: pod.rate }).catch((e) => { if (e?.code === 'not_granted') toast('Citirea cu voce e oprită pentru această pagină (meniul Permissions).'); });
    return;
  }
  const token = (pod.token = Symbol()), voices = speechSynthesis.getVoices().filter((v) => /^ro/i.test(v.lang));
  const speak = (i) => {
    if (pod.token !== token) return;
    if (i >= lines.length) { pod.playing = false; pod.idx = 0; const b = $('#pod-play'); if (b) b.textContent = '▶ Redă'; return; }
    pod.idx = i; highlight(i);
    const u = new SpeechSynthesisUtterance(lines[i].text), v = voices[lines[i].speaker === 'Ana' ? 0 : Math.min(1, voices.length - 1)];
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ro-RO';
    u.rate = pod.rate; if (voices.length < 2) u.pitch = lines[i].speaker === 'Ana' ? 1.15 : 0.85;
    u.onend = () => speak(i + 1); u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') speak(i + 1); };
    speechSynthesis.speak(u);
  };
  speak(start);
}
function stopPod() { pod.token = null; pod.playing = false; pod.paused = false; pod.offTts.forEach((f) => f()); pod.offTts = []; if (R.tts) R.tts.stop().catch(() => {}); else if ('speechSynthesis' in window) speechSynthesis.cancel(); }
$('#pod-ch').onchange = () => { stopPod(); pod.idx = 0; renderPodcast(); };
$('#pod-min').value = String(getSettings().podcastMinutes || 5);
$('#pod-min').onchange = (e) => saveSettings({ ...getSettings(), podcastMinutes: +e.target.value });
$('#pod-gen').onclick = () => {
  const c = CH[$('#pod-ch').value]; if (!c) return toast('Încarcă întâi cursul, ca să existe capitole.');
  if (needAI()) return; stopPod();
  runJob(`Podcast: ${c.title}`, async (job) => `Episodul e gata: ${(await writePodcast(job, c, +$('#pod-min').value)).lines.length} replici.`);
};
onShow.podcast = renderPodcast;

/* =====================================================================
   Banca comună: citirea fișierelor de grile (doar proprietarul)
   ===================================================================== */
let bankReading = false;
const bankSubj = (s) => subjOf(s.subject) || (s.subject === 'Mixt' ? 'mixt' : null);
// Citește un fișier al băncii, bucată cu bucată (se reia de unde a rămas). Sursele „Mixt” (poze cu grile din mai multe
// materii) primesc materia grilă cu grilă; textul din poze vine din OCR și poate avea greșeli de recunoaștere.
async function readBankSource(job, src, label, seen) {
  const snap = await R.db.collection(`sources/${src.id}/chunks`).get();
  const blocks = snap.docs.map((d) => d.data()).sort((a, b) => a.n - b.n).flatMap((d) => d.blocks || []);
  const chunks = chunkBlocks(blocks, 20000, 1), tail = src.ocr ? '' : blocks.join('\n').slice(-10000);
  const mixed = src.subject === 'Mixt', meta = { ...src }; delete meta.id;
  let count = src.extractedCount || 0, added = 0;
  for (let i = src.doneChunks || 0; i < chunks.length; i++) {
    if (job.signal.aborted) throw new Error('Oprit.');
    job.status(`${label}„${src.name}” (partea ${i + 1}/${chunks.length})…`);
    const res = await askJSON('Extragi grile (întrebări cu răspuns multiplu) dintr-un document de examen de medicină, în română. ' + EXTRACT_RULES +
      (src.ocr ? ' Textul provine din recunoașterea optică (OCR) a unor poze: corectează greșelile evidente de recunoaștere în enunț și variante, dar nu inventa conținut; dacă răspunsul corect nu e marcat clar în text, deduce-l („dedus”).' : '') +
      (mixed ? `\nGrilele sunt din materii diferite: pentru fiecare, "subject" = una dintre: ${SUBJECTS.map((x) => x.label).join(', ')}; altfel "altă materie".` : `\nMATERIA: ${src.subject}`) + '\n\n' +
      (tail && i < chunks.length - 1 ? `FINALUL DOCUMENTULUI (poate conține cheia):\n${tail}\n\n` : '') +
      `FRAGMENTUL ${i + 1}/${chunks.length}:\n${chunks[i]}\n\nRăspunde doar cu JSON: {"questions":[{"stem":"…","options":["…"],"correct":[0],"explanation":"…","topic":"…",${mixed ? '"subject":"…",' : ''}"answerSource":"cheie"|"dedus"}]}`, { signal: job.signal });
    const bySubj = {};
    for (const raw of res.questions || []) {
      const q = sanitizeQ(raw); if (!q || seen.has(normStem(q.q))) continue;
      const sj = mixed ? subjOf(raw.subject) : bankSubj(src); if (!sj) continue;
      seen.add(normStem(q.q));
      (bySubj[sj] ||= []).push({ id: uid('u'), ...q, n: raw.answerSource === 'dedus' ? 'Sursa nu dădea cheia acestei grile; cheia a fost stabilită de AI. Verific-o cu cursul.' : '', m: false });
    }
    for (const [sj, items] of Object.entries(bySubj)) { await R.db.collection('grile').doc(uid('gp')).set({ ch: '', src: src.id, subj: SUBJ_BY[sj].label, items, createdAt: Date.now() }); count += items.length; added += items.length; }
    await R.db.collection('sources').doc(src.id).set({ ...meta, doneChunks: i + 1, nChunks: chunks.length, extractedCount: count });
  }
  await R.db.collection('sources').doc(src.id).set({ ...meta, doneChunks: chunks.length, nChunks: chunks.length, extractedCount: count, extractedAt: Date.now() });
  return added;
}
async function readBank() {
  if (bankReading || !R.isOwner || !aiReady()) return;
  const todo = BANK.sources.filter((s) => !s.extractedAt && bankSubj(s));
  if (!todo.length) return;
  bankReading = true;
  await runJob('Citesc banca de grile', async (job) => {
    const seen = new Set(BANK_Q.map((x) => normStem(x.q)));
    let added = 0, next = 0, done = 0;
    // două fișiere în paralel
    const worker = async () => {
      while (next < todo.length) {
        const n = next++, src = BANK.sources.find((s) => s.id === todo[n].id) || todo[n];
        const a = await readBankSource(job, src, `[${n + 1}/${todo.length}] `, seen); added += a;
        done++; job.progress(done / todo.length);
      }
    };
    await Promise.all([worker(), worker()]);
    return `${added} grile noi în bancă`;
  });
  bankReading = false;
}
function renderBankAdmin() {
  $('#bank-admin').hidden = !(R.isOwner && R.db && aiReady());
  if ($('#bank-admin').hidden) return;
  const pend = BANK.sources.filter((s) => !s.extractedAt && bankSubj(s));
  $('#bank-status').innerHTML = SUBJECTS.map((s) => `${esc(s.short)}: <b>${fmtN(BANK_Q.filter((x) => x.sj === s.id).length)}</b>`).join(' · ') + ` grile în bancă.${pend.length ? ` Mai sunt de citit ${pend.length} fișiere${bankReading ? ' (citesc acum — ține pagina deschisă)' : ''}.` : ''}`;
  $('#bank-continue').hidden = !pend.length || bankReading;
}
$('#bank-continue').onclick = () => readBank();
$('#bank-upload').onclick = () => { if (!needAI()) $('#bank-file').click(); };
$('#bank-file').onchange = (e) => {
  const files = [...e.target.files]; e.target.value = ''; const sj = CUR;
  Promise.all(files.map((file) => runJob(`Bancă: „${file.name}”`, async (job) => {
    const r = await readFile(file, job), id = uid('src'), blocks = splitBlocks(r.text);
    for (let i = 0, n = 0; i < blocks.length; i += 150, n++) await R.db.collection(`sources/${id}/chunks`).doc('c' + String(n).padStart(4, '0')).set({ n, blocks: blocks.slice(i, i + 150) });
    await R.db.collection('sources').doc(id).set({ name: `${SUBJ_BY[sj].label} · ${file.name}`, kind: 'grile', subject: SUBJ_BY[sj].label, pool: true, chars: r.text.length, nBlocks: blocks.length, addedAt: Date.now() });
    return 'Adăugat în bancă.';
  }, 'upload'))).then(() => setTimeout(readBank, 1500));
};

/* =====================================================================
   Setări, backup, LiveSend
   ===================================================================== */
function renderSettings() {
  $('#st-pages').value = getSettings().pagesPerChapter;
  $('#st-ai').textContent = !R.ready ? 'Mă conectez la Claude…' : aiReady() ? 'Claude e conectat. Munca AI (împărțirea cursului, căutarea în bancă, generarea) consumă din utilizarea ta Claude; Claude te întreabă o dată înainte de prima cerere.' : SNAP ? 'Versiune de partajare: fără funcțiile AI.' : 'Deschide pagina în Claude, autentificat, ca să folosești funcțiile AI.';
  $('#st-store').textContent = SNAP ? 'Conținutul vine din fișier.' : PS.mode === 'db' ? 'Datele tale sunt salvate în contul tău, private.' : PS.mode === 'idb' ? 'Datele tale sunt salvate în acest browser, private.' : 'Datele tale nu pot fi salvate aici și se pierd la închidere.';
  $('#st-counts').textContent = `Ai ${P.docs.length} documente, ${P.chapters.length} capitole, ${P.items.reduce((n, p) => n + (p.items?.length || 0), 0)} elemente generate sau extrase și ${P.outputs.length} sinteze/podcasturi (la toate materiile).`;
  for (const id of ['#st-wipe', '#st-imp', '#st-share', '#st-share-hint']) $(id).hidden = !!SNAP;
  renderBankAdmin();
}
$('#st-save').onclick = () => { saveSettings({ ...getSettings(), pagesPerChapter: Math.min(300, Math.max(10, +$('#st-pages').value || 50)) }); toast('Setări salvate.'); };
$('#st-exp').onclick = async () => {
  const docs = []; for (const d of P.docs) docs.push({ ...d, blocks: await docBlocks(d.id).catch(() => []) });
  saveFile(`recall-datele-mele-${today()}.json`, JSON.stringify({ app: 'semiologie-recall-plus', version: 3, p: { ...P, docs }, progress: store }));
};
$('#st-imp').onclick = () => $('#st-file').click();
$('#st-file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text()); if (!data.p) throw new Error('nu este un backup al acestei aplicații');
    if (!await ask('Adaugi documentele, capitolele și tot ce e în acest backup la datele tale?', { ok: 'Importă' })) return;
    runJob('Import backup', async () => {
      for (const d of data.p.docs || []) { const { blocks = [], ...meta } = d; await PS.putBlocks(meta.id, blocks); blockCache.set(meta.id, blocks); await pPut('docs', meta); }
      for (const k of ['chapters', 'items', 'outputs']) for (const x of data.p[k] || []) await pPut(k, x);
      if (data.progress?.s) { store = data.progress; if (!store.g) store.g = {}; scheduleSave(); }
      return 'Backup importat.';
    });
  } catch (err) { toast('Nu s-a putut importa: ' + err.message); }
};
$('#st-wipe').onclick = async () => {
  if (!await ask('Ștergi toate documentele tale, capitolele și tot ce ai generat, la toate materiile? Progresul la repetiție rămâne.', { ok: 'Șterge tot' })) return;
  runJob('Șterg datele mele', async () => {
    for (const d of [...P.docs]) { await PS.delBlocks(d.id); await pDel('docs', d.id); }
    for (const k of ['chapters', 'items', 'outputs']) for (const x of [...P[k]]) await pDel(k, x.id);
    blockCache.clear(); return 'Șters.';
  });
};
// Un fișier HTML cu capitolele mele și tot ce am ales/generat, de învățat fără Claude.
function shareHtml() {
  const style = [...document.querySelectorAll('style')].find((x) => x.textContent.includes('--f-display'))?.textContent || '';
  const fonts = document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]')?.href || '';
  const libs = [...document.querySelectorAll('script[src]')].filter((x) => /marked|purify/.test(x.src)).map((x) => `<script src="${x.src}"><\/script>`).join('');
  const used = new Set(P.chapters.flatMap((c) => c.bankQ || []));
  const bank = BANK_Q.filter((x) => used.has(x.id) && !BASE_IDS.has(x.id));
  const docs = P.docs.map(({ id, name, kind, subject, chars, pages }) => ({ id, name, kind, subject, chars, pages, segmented: true, extractedAt: 1 }));
  const snap = { date: new Date().toISOString(), p: { docs, chapters: P.chapters, items: P.items, outputs: P.outputs }, bank };
  const json = JSON.stringify(snap).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semiologie Recall</title>' +
    (fonts ? `<link rel="stylesheet" href="${fonts}">` : '') + `<style>[hidden]{display:none!important}body{margin:0}\n${style}</style></head><body>\n${PRISTINE}\n${libs}` +
    `<script>window.SNAPSHOT=${json};<\/script><script id="base-data">${$('#base-data').textContent}<\/script><script id="app-code">${$('#app-code').textContent}<\/script></body></html>`;
}
$('#st-share').onclick = () => { if (!P.chapters.length) return toast('Încarcă întâi cursul: fișierul conține capitolele tale.'); saveFile(`recall-${today()}.html`, shareHtml()); };
onShow.settings = renderSettings;

/* =====================================================================
   Versiunea de partajare (LiveSend): datele vin din fișier, doar citire
   ===================================================================== */
if (SNAP) { for (const k of Object.keys(P)) P[k] = SNAP.p[k] || []; rebuildBank((SNAP.bank || []).map((x) => ({ ...x, bank: true }))); }

/* =====================================================================
   Reîmprospătare și bara de materii
   ===================================================================== */
function renderSubjects() {
  $('#subj-name').textContent = SUBJ_BY[CUR].label;
  $('#subtitle').textContent = CH_LIST.length ? `${fmtN(CH_LIST.length)} capitole · ${fmtN(GQ.length)} grile · ${fmtN(CARDS.length)} carduri · ${fmtN(CASES.length)} cazuri` : 'Încarcă documentele tale, iar aplicația lucrează pe ele.';
  $('#subjects').innerHTML = SUBJECTS.map((x) => `<button role="tab" data-subj="${x.id}" aria-selected="${x.id === CUR}">${esc(x.short)}<small>${fmtN(myChapters(x.id).length)}</small></button>`).join('');
}
$('#subjects').addEventListener('click', (e) => {
  const b = e.target.closest('[data-subj]'); if (!b || b.dataset.subj === CUR) return;
  CUR = b.dataset.subj; ls.set('semio-subject', CUR);
  stopPod(); pod.idx = 0; started = false; cur = null; queue = []; gMode = null; $('#gq').innerHTML = ''; caseDone = 0;
  for (const id of ['#sec-filter', '#case-ch', '#sum-ch', '#pod-ch', '#g-ch', '#g-src']) $(id).value = '';
  refreshAll();
});
function refreshAll() {
  rebuild();
  renderSubjects();
  chOptions(secSel, { all: true }); fillGFilters(); chOptions($('#case-ch'), { all: true });
  for (const id of ['#sum-ch', '#pod-ch']) chOptions($(id));
  if (!gMode) gRenderStats(); else $('#g-count').textContent = gPool().length + ' grile găsite';
  limitIn.value = store.meta.newLimit; refreshStats(); if (!started) renderCard();
  if (!caseDone) renderCases();
  const visible = $$('nav.tabs button').find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab;
  if (visible === 'podcast') { if (!pod.playing) renderPodcast(); } else if (visible && onShow[visible]) onShow[visible]();
}

refreshAll();
{ const t = ls.get('semio-tab', 'sources'); showTab($(`nav.tabs button[data-tab="${t}"]`) ? t : 'sources'); }
initRuntime();
})();
