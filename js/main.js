// Semiologie Recall + surse, capitole, grile completate cu AI, sinteze și podcast.
// Logica de bază (repetiție spațiată, grile, cazuri, recall, explicații, deck) este cea a aplicației originale;
// conținutul original (js/base-data.js) se combină la rulare cu ce adaugă utilizatorul (IndexedDB).
import * as BASE from './base-data.js';
import { db, uid } from './db.js';
import { extractText, splitBlocks, fileKind } from './parse.js';
import { getSettings, saveSettings, MODELS } from './ai.js';
import * as P from './pipelines.js';
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }
const md = (s) => DOMPurify.sanitize(marked.parse(s || ''));
const fmtN = (n) => n.toLocaleString('ro-RO');
const BASE_SRC = new Set(Object.keys(BASE.SOURCES));

/* =====================================================================
   Date: conținutul original + ce a adăugat utilizatorul
   ===================================================================== */
const U = { sources: [], chapters: [], grile: [], cards: [], outputs: [] };
let SECTIONS, SECTION_CH, CARDS, CASES, RECALL, CONTRASTS, EXPLAIN, CHAPTERS, SOURCES, GQ, GQ_BY, byId, CH_ORDER;

const chMeta = (id) => U.chapters.find((c) => c.id === id);

function rebuild() {
  CHAPTERS = {};
  const userCh = U.chapters.filter((c) => !BASE.CHAPTERS[c.id]).sort((a, b) => a.order - b.order);
  // Ordinea: capitolele originale I–III, apoi capitolele noi, apoi „Alte capitole" (X) la final.
  CH_ORDER = [...Object.keys(BASE.CHAPTERS).filter((k) => k !== 'X'), ...userCh.map((c) => c.id), ...(BASE.CHAPTERS.X ? ['X'] : [])];
  for (const id of CH_ORDER) CHAPTERS[id] = chMeta(id)?.title || BASE.CHAPTERS[id];

  SECTIONS = { ...BASE.SECTIONS };
  SECTION_CH = Object.fromEntries(Object.keys(BASE.SECTIONS).map((k) => [k, 'I']));
  for (const c of U.chapters) for (const [k, t] of Object.entries(c.sections || {})) { SECTIONS[k] = [t, CHAPTERS[c.id] || '']; SECTION_CH[k] = c.id; }

  CARDS = [...BASE.CARDS, ...U.cards.filter((c) => SECTIONS[c.sec]).map((c) => [c.id, c.sec, c.front, c.back])];
  byId = Object.fromEntries(CARDS.map((c) => [c[0], c]));

  const outs = (type) => U.outputs.filter((o) => o.type === type && CHAPTERS[o.ch]);
  CASES = [...BASE.CASES.map((c) => ({ ...c, ch: 'I' })), ...outs('cases').flatMap((o) => o.content.map((c) => ({ ...c, ch: o.ch })))];
  RECALL = [...BASE.RECALL.map((r) => ({ ...r, ch: 'I' })), ...outs('recall').flatMap((o) => o.content.recall.map((r) => ({ ...r, ch: o.ch })))];
  CONTRASTS = [...BASE.CONTRASTS.map((t) => ({ ...t, ch: 'I' })), ...outs('recall').flatMap((o) => o.content.contrasts.map((t) => ({ ...t, ch: o.ch })))];
  EXPLAIN = Object.fromEntries(Object.entries(BASE.EXPLAIN).map(([k, v]) => [k, v.slice()]));
  for (const o of outs('explain')) for (const it of o.content) if (SECTIONS[it.sec]) (EXPLAIN[it.sec] ||= []).push([esc(it.title), md(it.text)]);

  SOURCES = { ...BASE.SOURCES, ai: 'Written by AI from your course' };
  for (const s of U.sources) if (s.kind === 'grile') SOURCES[s.id] = s.name;
  const base = BASE.GRILE.map((r) => ({ id: r[0], ch: r[1], src: r[2], q: r[3], o: r[4], k: r[5], n: r[6], m: !!r[7] }));
  GQ = [...base, ...U.grile.map((x) => ({ ...x, ch: CHAPTERS[x.ch] ? x.ch : '' }))];
  GQ_BY = Object.fromEntries(GQ.map((x) => [x.id, x]));
}

async function loadUser() {
  for (const s of Object.keys(U)) U[s] = await db.all(s);
  rebuild();
}

/* ---------- state & persistence (progres: ca în aplicația originală) ---------- */
const LS_KEY = 'semio-srs-v1';
let store = { s: {}, g: {}, meta: { newLimit: 25, newDay: '', newCount: 0 }, updated: 0 };
function lsRead() { try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function lsWrite() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }
const local = lsRead(); if (local && local.s) store = local; if (!store.g) store.g = {};
function scheduleSave() { store.updated = Date.now(); lsWrite(); }

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
  let c = store.s[id] || { i: 0, e: 2.5, r: 0, d: now, l: 0 };
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
// filtrul poate fi o secțiune („A") sau un capitol întreg („ch:II")
const inFilter = (c, f) => !f || (f.startsWith('ch:') ? SECTION_CH[c[1]] === f.slice(3) : c[1] === f);
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
function sectionsOf(ch) { return Object.keys(SECTIONS).filter((k) => SECTION_CH[k] === ch); }
function fillSecSel() {
  const cur = secSel.value;
  secSel.innerHTML = '<option value="">All sections</option>' + CH_ORDER.map((ch) => {
    const secs = sectionsOf(ch).filter((k) => CARDS.some((c) => c[1] === k));
    if (!secs.length) return '';
    return `<optgroup label="${esc(CHAPTERS[ch])}"><option value="ch:${ch}">All of ${esc(CHAPTERS[ch])}</option>${secs.map((k) => `<option value="${k}">${esc(SECTIONS[k][0])} (${esc(SECTIONS[k][1])})</option>`).join('')}</optgroup>`;
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
function fmt(d) { return d < 1 ? '10m' : d + 'd'; }
function renderCard() {
  const box = $('#session');
  if (!cur && !started) {
    const c = counts(secSel.value);
    box.innerHTML = `<div class="card done"><div class="q">${c.due + c.newLeft} cards ready</div><p class="hint">${c.due} due for review · ${c.newLeft} new. Press Start session.</p></div>`;
    return;
  }
  if (!cur) {
    box.innerHTML = reviewed
      ? `<div class="card done"><div class="q">Session done: ${reviewed} reviews</div><p class="hint">Come back tomorrow. Spacing out the reviews is what makes them stick.</p></div>`
      : '<div class="card done"><div class="q">Nothing due right now</div><p class="hint">Raise the new-card limit, pick a section, or switch to Cases for mixed practice.</p></div>';
    refreshStats(); return;
  }
  const c = byId[cur], s = store.s[cur], p = previewIntervals(s);
  const st = status(cur);
  box.innerHTML = `<div class="card">
    <div class="meta"><span>${esc(SECTIONS[c[1]][0])} · ${esc(SECTIONS[c[1]][1])}</span><span><span class="pill p-${st}">${st === 'new' ? 'NEW' : st === 'mat' ? 'MATURE' : 'LEARNING'}</span> · ${queue.length} left</span></div>
    <div class="q">${esc(c[2])}</div>
    ${shown ? `<div class="a">${esc(c[3])}</div>
      ${EXPLAIN[c[1]]?.length ? '<button class="why-link" id="why">Why? Read the explanation for this section →</button>' : ''}
      <div class="grades">
        <button class="g-again" data-g="0">Again<small>10m · 1</small></button>
        <button class="g-hard" data-g="1">Hard<small>${fmt(p.hard)} · 2</small></button>
        <button class="g-good" data-g="2">Good<small>${fmt(p.good)} · 3</small></button>
        <button class="g-easy" data-g="3">Easy<small>${fmt(p.easy)} · 4</small></button>
      </div>` : '<button class="btn primary" id="show">Show answer</button><p class="hint">Answer out loud or on paper first.</p>'}
  </div>`;
  const sb = $('#show'); if (sb) sb.onclick = () => { shown = true; renderCard(); };
  const wl = $('#why'); if (wl) wl.onclick = () => openExplain(c[1]);
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
  if ($('#tab-review').hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
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

/* ---------- chapter pickers (shared) ---------- */
function chOptions(sel, { all = false, unassigned = false } = {}) {
  const v = sel.value;
  sel.innerHTML = (all ? `<option value="">All chapters</option>` : '') +
    CH_ORDER.map((k) => `<option value="${k}">${esc(CHAPTERS[k])}</option>`).join('') +
    (unassigned && GQ.some((x) => !x.ch) ? '<option value="__none">— Not sorted into a chapter yet</option>' : '');
  if ([...sel.options].some((o) => o.value === v)) sel.value = v;
}

/* ---------- cases ---------- */
let caseOrder = [], caseRight = 0, caseDone = 0;
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const caseList = () => CASES.filter((c) => !$('#case-ch').value || c.ch === $('#case-ch').value);
function renderCases() {
  const list = caseList();
  caseRight = 0; caseDone = 0; caseOrder = shuffle(list.map((_, i) => i));
  $('#cases').innerHTML = caseOrder.map((ci, n) => { const c = list[ci]; return `<div class="case" data-c="${ci}">
    <b>${n + 1}.</b> ${esc(c.q)}
    <div class="opts">${c.o.map((o, k) => `<button data-k="${k}">${esc(o)}</button>`).join('')}</div>
    <div class="why" hidden>${esc(c.w)}</div></div>`; }).join('') || '<p class="hint">No cases for this chapter yet.</p>';
  $('#cases').querySelectorAll('.case').forEach((el) => {
    el.querySelectorAll('.opts button').forEach((btn) => (btn.onclick = () => {
      if (el.dataset.done) return; el.dataset.done = 1;
      const c = list[+el.dataset.c], k = +btn.dataset.k;
      el.querySelectorAll('.opts button')[c.a].classList.add('right');
      if (k !== c.a) btn.classList.add('wrong'); else caseRight++;
      caseDone++; el.querySelector('.why').hidden = false; updScore();
    }));
  });
  $('#case-gen').disabled = !$('#case-ch').value;
  updScore();
}
function updScore() { $('#case-score').textContent = caseDone ? `Score: ${caseRight}/${caseDone}` : `${caseList().length} cases`; }
$('#case-shuffle').onclick = renderCases;
$('#case-ch').onchange = renderCases;

/* ---------- recall & contrasts ---------- */
function renderRecall() {
  const ch = $('#recall-ch').value;
  const rec = RECALL.filter((r) => !ch || r.ch === ch);
  $('#recall').innerHTML = rec.map((r, i) => `<details class="recall"><summary>${esc(r.t)}</summary>
  <p class="prompt">${esc(r.p)}</p>
  <textarea id="blurt-${i}" aria-label="Your recall for ${esc(r.t)}" placeholder="Book closed. Write everything you remember…"></textarea>
  <details style="margin-top:8px"><summary class="hint">Show checklist and tick what you got (${r.i.length} items)</summary>
  <div class="checks">${r.i.map((it, k) => `<label><input type="checkbox" id="chk-${i}-${k}"> ${esc(it)}</label>`).join('')}</div></details>
</details>`).join('') || '<p class="hint">No recall sheets for this chapter yet.</p>';
  $('#contrasts').innerHTML = CONTRASTS.filter((t) => !ch || t.ch === ch).map((t) => `<h3>${esc(t.t)}</h3><div class="tablewrap"><table><thead><tr>${t.h.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.r.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<td><b>${esc(c)}</b></td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
  $('#recall-gen').disabled = !ch;
}
$('#recall-ch').onchange = renderRecall;

/* ---------- deck ---------- */
function renderDeck() {
  const q = ($('#deck-search').value || '').toLowerCase();
  $('#deck').innerHTML = CH_ORDER.flatMap(sectionsOf).map((k) => {
    const v = SECTIONS[k];
    const cs = CARDS.filter((c) => c[1] === k && (!q || (c[2] + ' ' + c[3]).toLowerCase().includes(q)));
    if (!cs.length) return '';
    return `<div class="deckgroup"><h3>${esc(v[0])} <small>${esc(v[1])} · ${cs.length} cards</small></h3>${cs.map((c) => { const st = status(c[0]); return `<div class="dc"><div class="dq"><span class="pill p-${st}">${st === 'new' ? 'NEW' : st === 'mat' ? 'MATURE' : 'LEARNING'}</span> ${esc(c[2])}</div><div class="da">${esc(c[3])}</div></div>`; }).join('')}</div>`;
  }).join('') || '<p class="hint">No cards match.</p>';
}
$('#deck-search').addEventListener('input', renderDeck);
onShow.deck = renderDeck;

/* ---------- explanations ---------- */
const exSel = $('#ex-filter');
function fillExSel() {
  const v = exSel.value;
  exSel.innerHTML = '<option value="">All sections</option>' + CH_ORDER.map((ch) => {
    const secs = sectionsOf(ch).filter((k) => EXPLAIN[k]?.length);
    return secs.length ? `<optgroup label="${esc(CHAPTERS[ch])}">${secs.map((k) => `<option value="${k}">${esc(SECTIONS[k][0])} (${esc(SECTIONS[k][1])})</option>`).join('')}</optgroup>` : '';
  }).join('');
  if ([...exSel.options].some((o) => o.value === v)) exSel.value = v;
}
function renderExplain() {
  const f = exSel.value;
  $('#explain').innerHTML = CH_ORDER.flatMap(sectionsOf).filter((k) => EXPLAIN[k]?.length && (!f || k === f)).map((k) => `<article class="ex" id="ex-${k}">
    <div class="eyebrow">${esc(SECTIONS[k][1])}</div><h3>${esc(SECTIONS[k][0])}</h3>
    ${EXPLAIN[k].map(([h, t]) => `<h4>${h}</h4>${/^\s*<(p|ul|ol|h\d|table)/.test(t) ? t : `<p>${t}</p>`}`).join('')}
  </article>`).join('');
}
exSel.addEventListener('change', renderExplain);
function openExplain(sec) {
  exSel.value = sec; renderExplain();
  showTab('explain');
  window.scrollTo({ top: 0 });
}

/* ---------- exam questions (grile) ---------- */
function gstat(id) { return (store.g && store.g[id]) || null; }
function gRecord(id, ok) {
  store.g = store.g || {};
  const s = store.g[id] || [0, 0, 0];
  s[0]++; if (ok) s[1]++; s[2] = ok ? 1 : 0;
  store.g[id] = s; scheduleSave();
}
const gFilt = { ch: $('#g-ch'), src: $('#g-src'), type: $('#g-type'), wrong: $('#g-wrong'), fixed: $('#g-fixed') };
function fillGFilters() {
  const ch = gFilt.ch.value || (gFilt.ch.options.length ? '' : 'I');
  chOptions(gFilt.ch, { all: true, unassigned: true });
  gFilt.ch.value = [...gFilt.ch.options].some((o) => o.value === ch) ? ch : '';
  const src = gFilt.src.value;
  gFilt.src.innerHTML = '<option value="">All sources</option>' + Object.entries(SOURCES).filter(([k]) => GQ.some((x) => x.src === k)).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  if ([...gFilt.src.options].some((o) => o.value === src)) gFilt.src.value = src;
}
function gPool() {
  return GQ.filter((x) =>
    (!gFilt.ch.value || (gFilt.ch.value === '__none' ? !x.ch : x.ch === gFilt.ch.value)) &&
    (!gFilt.src.value || x.src === gFilt.src.value) &&
    (!gFilt.type.value || (gFilt.type.value === 's' ? x.k.length === 1 : x.k.length > 1)) &&
    (!gFilt.wrong.checked || (gstat(x.id) && gstat(x.id)[2] === 0)) &&
    (!gFilt.fixed.checked || x.m || (x.n && x.src !== 'new' && x.src !== 'ai')));
}
function gRenderStats() {
  const target = getSettings().target;
  $('#g-stats').innerHTML = CH_ORDER.map((k) => {
    const all = GQ.filter((x) => x.ch === k);
    const done = all.filter((x) => gstat(x.id));
    const right = done.filter((x) => gstat(x.id)[2] === 1).length;
    const pct = done.length ? Math.round(100 * right / done.length) : 0;
    return `<div class="gstat"><span>${esc(CHAPTERS[k])}</span><b>${done.length}/${all.length}</b><div class="bar"><i style="width:${done.length ? pct : 0}%"></i></div><small>${done.length ? pct + '% right on last try' : 'not started'}${all.length < target ? ` · ${target - all.length} short of ${target}` : ''}</small></div>`;
  }).join('');
  $('#g-count').textContent = gPool().length + ' questions match';
}
Object.values(gFilt).forEach((el) => el.addEventListener('change', gRenderStats));

let gMode = null, gList = [], gPos = 0, gSel = new Set(), gChecked = false, gAns = {};
const gShuffle = shuffle;
function gStart(mode) {
  const pool = gPool();
  if (!pool.length) { $('#gq').innerHTML = '<div class="card done"><div class="q">No questions match these filters</div><p class="hint">Widen the chapter or source, or untick "only my mistakes".</p></div>'; return; }
  gMode = mode; gPos = 0; gAns = {};
  gList = gShuffle(pool).slice(0, mode === 'exam' ? Math.min(+$('#g-n').value || 30, pool.length) : pool.length).map((x) => x.id);
  gSel = new Set(); gChecked = false; gRender();
}
function letters(arr) { return arr.map((i) => 'abcde'[i]).join(', '); }
function gNoteHtml(x) {
  let note = x.n;
  if (!note && x.src === 'y21') note = 'The source had no answer key; this key is set from the 2022 course.';
  if (!note && x.ch === 'X' && BASE_SRC.has(x.src)) note = 'Key as given in the material. This chapter is in a later volume, so it was not checked against your course.';
  const badge = x.m ? '<span class="pill p-learn">KEY CORRECTED</span> ' : '';
  const expl = x.e ? `<div class="why gnote">${esc(x.e)}</div>` : '';
  return (note ? `<div class="why gnote">${badge}${esc(note)}</div>` : (x.m ? `<div class="why gnote">${badge}</div>` : '')) + expl;
}
function gRender() {
  const box = $('#gq');
  if (gMode === 'exam' && gPos >= gList.length) return gExamResult();
  if (gMode === 'practice' && gPos >= gList.length) { box.innerHTML = `<div class="card done"><div class="q">You went through all ${gList.length} questions</div><p class="hint">Tick "only my mistakes" and start again to repeat the ones you missed.</p></div>`; gRenderStats(); return; }
  const x = GQ_BY[gList[gPos]];
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
    verdict = `<div class="gverdict ${ok ? 'ok' : part ? 'part' : 'bad'}">${ok ? 'Correct' : part ? 'Partly right' : 'Wrong'} · answer: <b>${letters(x.k)}</b></div>${gNoteHtml(x)}`;
  }
  box.innerHTML = `<div class="card">
    <div class="meta"><span>${esc(CHAPTERS[x.ch] || 'Not sorted yet')} · ${esc(SOURCES[x.src] || '')}</span><span>${gPos + 1} / ${gList.length}</span></div>
    <div><span class="pill ${multi ? 'p-new' : 'p-mat'}">${multi ? 'COMPLEMENT MULTIPLU · 2–5 answers' : 'COMPLEMENT SIMPLU · 1 answer'}</span>${x.src === 'ai' ? ' <span class="pill p-ai">AI-WRITTEN</span>' : ''}</div>
    <div class="q">${esc(x.q)}</div>
    <div class="gopts">${opts}</div>
    ${verdict}
    <div class="controls" style="margin:0">
      ${gMode === 'practice' ? (show ? '<button class="btn primary" id="g-next">Next →</button>' : '<button class="btn primary" id="g-check">Check</button>')
        : `<button class="btn" id="g-prev" ${gPos ? '' : 'disabled'}>← Back</button><button class="btn primary" id="g-next">${gPos === gList.length - 1 ? 'Finish exam' : 'Next →'}</button><span class="hint">${Object.keys(gAns).length} answered</span>`}
      <button class="btn" id="g-stop">Stop</button>
    </div>
    <p class="hint" style="margin:0">Keys: 1–5 select options, Enter checks or moves on.</p>
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
  const rows = gList.map((id) => {
    const x = GQ_BY[id]; const a = new Set(gAns[id] || []); const ok = sameSet(a, x.k);
    if (ok) right++;
    gRecord(id, ok);
    return { x, a, ok };
  });
  const pct = Math.round(100 * right / gList.length);
  const wrong = rows.filter((r) => !r.ok);
  $('#gq').innerHTML = `<div class="card">
    <div class="q">Result: ${right} / ${gList.length} correct (${pct}%)</div>
    <p class="hint">A question counts only if you picked exactly the right set of answers. That's how most grile exams score complement multiplu.</p>
    ${wrong.length ? `<h3>Review the ${wrong.length} you missed</h3>` + wrong.map((r) => `<div class="case"><b>${esc(r.x.q)}</b>
      <div class="opts">${r.x.o.map((o, i) => `<div class="gopt ${r.x.k.includes(i) ? (r.a.has(i) ? 'right' : 'missed') : (r.a.has(i) ? 'wrong' : '')}"><span class="gl">${'abcde'[i]}</span><span>${esc(o)}</span></div>`).join('')}</div>
      <div class="gverdict bad">Your answer: <b>${r.a.size ? letters([...r.a].sort()) : '—'}</b> · correct: <b>${letters(r.x.k)}</b></div>${gNoteHtml(r.x)}</div>`).join('') : '<p>No mistakes. Try a bigger exam or another chapter.</p>'}
    <div class="controls"><button class="btn primary" id="g-again">New exam</button></div>
  </div>`;
  $('#g-again').onclick = () => gStart('exam');
  gMode = null; gRenderStats();
}
$('#g-practice').onclick = () => gStart('practice');
$('#g-exam').onclick = () => gStart('exam');
document.addEventListener('keydown', (e) => {
  if ($('#tab-grile').hidden || !gMode || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (['1', '2', '3', '4', '5'].includes(e.key)) { const i = +e.key - 1; const x = GQ_BY[gList[gPos]]; if (x && i < x.o.length) gToggle(i); }
  else if (e.key === 'Enter') { e.preventDefault(); if (gMode === 'practice') { gChecked ? gNext() : gCheck(); } else gNext(); }
});

/* =====================================================================
   NOU: job-uri, notificări
   ===================================================================== */
function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
const jobs = [];
function renderJobs() {
  $('#jobs').hidden = !jobs.length;
  const running = jobs.filter((j) => j.state === 'run').length;
  $('#jobs-count').textContent = running ? `${running} running` : '';
  $('#jobs-list').innerHTML = jobs.slice().reverse().map((j) => `<div class="job ${j.state}">
    <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${esc(j.title)}</b>${j.state === 'run' ? `<button class="btn small" data-abort="${j.id}">Cancel</button>` : ''}</div>
    <div class="st">${esc(j.text)}</div>${j.state === 'run' && j.frac != null ? `<div class="bar"><i style="width:${Math.round(j.frac * 100)}%"></i></div>` : ''}</div>`).join('');
}
$('#jobs').addEventListener('click', (e) => { const id = e.target.dataset.abort; if (id) jobs.find((j) => j.id === id)?.ctrl.abort(); });
$('#jobs-min').onclick = () => $('#jobs').classList.toggle('min');
$('#jobs-close').onclick = () => { for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state !== 'run') jobs.splice(i, 1); renderJobs(); };
async function runJob(title, fn, kind = 'ai') {
  const job = { id: uid('j'), title, kind, state: 'run', text: 'Starting…', frac: null, ctrl: new AbortController() };
  jobs.push(job); renderJobs();
  const api = { signal: job.ctrl.signal, status: (t) => { job.text = t; renderJobs(); }, progress: (f) => { job.frac = f; renderJobs(); } };
  try {
    job.text = (await fn(api)) || 'Done.'; job.state = 'done';
  } catch (err) {
    console.error(err);
    job.state = 'err';
    job.text = job.ctrl.signal.aborted ? 'Cancelled.' : 'Error: ' + (err?.error?.error?.message || err.message || err);
  }
  renderJobs();
  refreshAll();
  if (job.state === 'done') setTimeout(() => { const k = jobs.indexOf(job); if (k >= 0) { jobs.splice(k, 1); renderJobs(); } }, 8000);
  return job.state === 'done';
}
function needKey() {
  if (getSettings().apiKey) return false;
  toast('Add your Claude API key in Settings first.');
  showTab('settings');
  return true;
}

/* =====================================================================
   NOU: capitole pentru AI
   ===================================================================== */
const sourcesById = () => Object.fromEntries(U.sources.map((s) => [s.id, s]));
const chGrile = (ch) => GQ.filter((x) => x.ch === ch);
const chCards = (ch) => CARDS.filter((c) => SECTION_CH[c[1]] === ch);
function sectionTitles(ch) { return sectionsOf(ch).map((k) => SECTIONS[k][0]); }
// Obiectul de capitol pe care îl primesc fluxurile AI. Fără material de curs, programa = grilele și cardurile existente.
function aiChapter(ch) {
  const m = chMeta(ch) || {};
  const topics = sectionTitles(ch).length ? sectionTitles(ch) : (m.topics || []);
  const refText = chGrile(ch).slice(0, 250).map((x) => `- ${x.q} → ${x.k.map((i) => x.o[i]).join('; ')}`).join('\n') + '\n' +
    chCards(ch).slice(0, 250).map((c) => `- ${c[2]} → ${c[3].replace(/\n/g, ' ')}`).join('\n');
  return { id: ch, title: CHAPTERS[ch], topics, ranges: m.ranges || [], refText };
}
const hasMaterial = (ch) => (chMeta(ch)?.ranges || []).length > 0;
const toPipe = (x) => ({ id: x.id, stem: x.q, options: x.o, correct: x.k, type: x.k.length > 1 ? 'CM' : 'CS', topic: x.t || '', note: x.n, explanation: x.e || '', stats: gstat(x.id) ? { seen: gstat(x.id)[0], right: gstat(x.id)[1] } : null });

async function ensureChapterRecord(ch) {
  let m = chMeta(ch);
  if (!m) { m = { id: ch, title: BASE.CHAPTERS[ch], summary: '', topics: [], ranges: [], sections: {}, order: 0 }; U.chapters.push(m); await db.put('chapters', m); }
  return m;
}
// Secțiunile de carduri ale unui capitol: cele existente, sau create din subteme.
async function ensureSections(ch, names = []) {
  const m = await ensureChapterRecord(ch);
  m.sections ||= {};
  const all = () => sectionsOf(ch).map((k) => [k, SECTIONS[k][0]]).concat(Object.entries(m.sections).filter(([k]) => !SECTIONS[k]));
  const wanted = names.length ? names : (all().length ? [] : (m.topics?.length ? m.topics : ['General']));
  for (const n of wanted) {
    if (all().some(([, t]) => P.normStem(t) === P.normStem(n))) continue;
    m.sections[uid('s_')] = n;
  }
  await db.put('chapters', m);
  rebuild();
}
function sectionKeyFor(ch, name) {
  const secs = sectionsOf(ch);
  const n = P.normStem(name);
  return secs.find((k) => P.normStem(SECTIONS[k][0]) === n) || secs.find((k) => P.normStem(SECTIONS[k][0]).includes(n) || n.includes(P.normStem(SECTIONS[k][0]))) || null;
}

/* =====================================================================
   NOU: Surse & capitole
   ===================================================================== */
let upKind = 'material';
$$('#up-kind button').forEach((b) => (b.onclick = () => { upKind = b.dataset.k; $$('#up-kind button').forEach((x) => x.classList.toggle('on', x === b)); }));
const drop = $('#drop'), fileIn = $('#file');
drop.onclick = () => fileIn.click();
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files], upKind); };
fileIn.onchange = () => { addFiles([...fileIn.files], upKind); fileIn.value = ''; };
$('#paste-add').onclick = async () => {
  const text = $('#paste-text').value.trim();
  if (!text) return toast('Paste some text first.');
  await saveSource($('#paste-name').value.trim() || `Pasted text ${new Date().toLocaleString('ro-RO')}`, upKind, text);
  $('#paste-text').value = ''; $('#paste-name').value = '';
  refreshAll(); autoProcess();
};

async function saveSource(name, kind, text, extra = {}) {
  const src = { id: uid('src_'), name, kind, text, blocks: splitBlocks(text), addedAt: Date.now(), ...extra };
  await db.put('sources', src);
  U.sources.push(src);
  rebuild();
  return src;
}
function addFiles(files, kind) {
  for (const file of files) {
    runJob(`Reading “${file.name}”`, async (job) => {
      const fk = fileKind(file);
      let text = '', pages = 1;
      if (fk !== 'image') {
        job.status('Extracting text…');
        const r = await extractText(file, (f) => job.progress(f));
        text = r.text.trim(); pages = r.pages || 1;
      }
      const scanned = fk === 'image' || (fk === 'pdf' && text.length < pages * 150);
      if (scanned) {
        if (!getSettings().apiKey) throw new Error('This looks scanned and needs AI transcription. Add your API key in Settings.');
        if (file.size > 30 * 1024 * 1024) throw new Error('Scanned file too large to transcribe (max ~30 MB). Split it into parts.');
        job.progress(null); job.status('Scanned document: transcribing with AI…');
        text = (await P.transcribeFile(file, { signal: job.signal, onText: (t) => job.status(`Transcribing… ${fmtN(t.length)} characters`) })).trim();
      }
      if (!text) throw new Error('No text found in this file.');
      await saveSource(file.name, kind, text, scanned ? { transcribed: true } : {});
      return `Added: ${fmtN(text.length)} characters${scanned ? ' (transcribed by AI)' : ''}.`;
    }, 'upload').then(() => autoProcess());
  }
}

// După încărcări: segmentează materialul nou, apoi sortează băncile de grile noi în capitole.
let processing = false;
async function autoProcess() {
  if (processing || jobs.some((j) => j.kind === 'upload' && j.state === 'run')) return;
  const newMat = U.sources.filter((s) => s.kind === 'material' && !s.segmented);
  const newBanks = U.sources.filter((s) => s.kind === 'grile' && !s.extractedAt);
  if (!newMat.length && !newBanks.length) return;
  if (!getSettings().apiKey) { toast('Sources saved. Add your API key in Settings to split them into chapters and sort the questions.', 6000); return; }
  processing = true;
  await runJob('Processing new sources', async (job) => {
    let msg = [];
    if (newMat.length) msg.push(await segmentNew(job, newMat));
    for (const src of U.sources.filter((s) => s.kind === 'grile' && !s.extractedAt)) msg.push(await extractBank(job, src));
    const n = await assignOrphans(job);
    if (n) msg.push(`${n} questions sorted into chapters`);
    return msg.join(' · ');
  });
  processing = false;
}

async function segmentNew(job, mats) {
  const existing = CH_ORDER.map((id) => ({ id, title: CHAPTERS[id] }));
  const found = await P.segmentSources(mats, { signal: job.signal, onStatus: job.status, hint: $('#seg-hint').value, existing });
  let created = 0, attached = 0;
  for (const c of found) {
    if (c.existing) {
      const m = await ensureChapterRecord(c.id);
      m.ranges = [...(m.ranges || []), ...c.ranges];
      m.topics = [...new Set([...(m.topics || []), ...c.topics])];
      if (!m.summary) m.summary = c.summary;
      await db.put('chapters', m);
      attached++;
    } else {
      const m = { id: c.id, title: c.title, summary: c.summary, topics: c.topics, ranges: c.ranges, sections: {}, order: U.chapters.length + created };
      for (const t of c.topics) m.sections[uid('s_')] = t;
      U.chapters.push(m); await db.put('chapters', m);
      created++;
    }
  }
  for (const s of mats) { s.segmented = true; await db.put('sources', s); }
  rebuild();
  return `${created} new chapters, material added to ${attached} existing`;
}

async function extractBank(job, src) {
  const chapters = CH_ORDER.map((id) => ({ id, title: CHAPTERS[id], topics: aiChapter(id).topics }));
  const seen = new Set(GQ.map((x) => P.normStem(x.q)));
  let added = 0;
  await P.extractQuestions(src, chapters, {
    signal: job.signal, onStatus: job.status,
    onBatch: async (qs) => {
      const fresh = [];
      for (const q of qs) {
        const k = P.normStem(q.stem);
        if (seen.has(k)) continue; seen.add(k);
        fresh.push({ id: uid('u'), ch: q.chapterId || '', src: src.id, q: q.stem, o: q.options, k: q.correct, t: q.topic, e: q.explanation,
          n: q.answerSource === 'dedus' ? 'This source gave no answer key for this question; the key was set by the AI. Check it against the course.' : '', m: false });
      }
      await db.putMany('grile', fresh);
      U.grile.push(...fresh); added += fresh.length;
      rebuild();
    },
  });
  src.extractedAt = Date.now(); src.extractedCount = added;
  await db.put('sources', src);
  return `“${src.name}”: ${added} new questions (duplicates skipped)`;
}

async function assignOrphans(job) {
  const orphans = U.grile.filter((x) => !CHAPTERS[x.ch]);
  if (!orphans.length) return 0;
  const chapters = CH_ORDER.map((id) => ({ id, title: CHAPTERS[id], topics: aiChapter(id).topics }));
  const map = await P.assignItems(orphans, (x) => `${x.q} | ${x.o.join(' | ')}`, chapters, { signal: job.signal, onStatus: job.status, label: 'questions' });
  let n = 0;
  for (const x of orphans) if (map.get(x.id)) { x.ch = map.get(x.id); n++; }
  await db.putMany('grile', orphans);
  rebuild();
  return n;
}

$('#seg').onclick = () => {
  if (needKey()) return;
  const mats = U.sources.filter((s) => s.kind === 'material' && !s.segmented);
  if (!mats.length) return toast('No new course material to split. Upload some first.');
  runJob('Splitting material into chapters', (job) => segmentNew(job, mats));
};
$('#assign-orphans').onclick = () => { if (!needKey()) runJob('Sorting questions into chapters', async (job) => `${await assignOrphans(job)} questions sorted.`); };
$('#fill-all').onclick = () => fillChapters(CH_ORDER);

function fillChapters(ids) {
  if (needKey()) return;
  const { target, batch } = getSettings();
  runJob(ids.length > 1 ? `Filling ${ids.length} chapters to ${target} questions` : `Writing questions: ${CHAPTERS[ids[0]]}`, async (job) => {
    let made = 0;
    for (let ci = 0; ci < ids.length; ci++) made += await fillOne(job, ids[ci], target, batch, ids.length > 1 ? `[${ci + 1}/${ids.length}] ` : '');
    return `${made} new questions written.`;
  });
}
async function fillOne(job, ch, target, batch, prefix = '') {
  let made = 0, fails = 0;
  while (chGrile(ch).length < target && fails < 2) {
    const have = chGrile(ch);
    const n = Math.min(batch, target - have.length);
    const pre = `${prefix}${CHAPTERS[ch]}: ${have.length}/${target}`;
    job.status(`${pre} — writing ${n}…`); job.progress(have.length / target);
    const fresh = await P.generateQuestions(aiChapter(ch), sourcesById(), have.map(toPipe), n, { signal: job.signal, onStatus: (t) => job.status(`${pre} — writing ${n} ${t}`) });
    if (!fresh.length) fails++;
    const rows = fresh.map((q) => ({ id: uid('u'), ch, src: 'ai', q: q.stem, o: q.options, k: q.correct, t: q.topic, e: q.explanation, n: '', m: false }));
    await db.putMany('grile', rows);
    U.grile.push(...rows); made += rows.length;
    rebuild();
    if (!$('#tab-sources').hidden) renderSources();
  }
  return made;
}

async function verifyKeys(job, ch) {
  const qs = U.grile.filter((x) => x.ch === ch && x.src !== 'ai' && !x.verifiedAt);
  if (!qs.length || !hasMaterial(ch)) return 'nothing to check';
  const res = await P.verifyKeys(aiChapter(ch), sourcesById(), qs.map(toPipe), { signal: job.signal, onStatus: job.status });
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  let changed = 0;
  for (const x of qs) {
    const r = by[x.id]; if (!r) continue;
    x.verifiedAt = Date.now();
    if (r.changed) { x.k = r.correct; x.n = r.note; x.m = true; changed++; }
    else if (x.n && /set by the AI/.test(x.n)) x.n = 'This source gave no answer key; the key was set by the AI and matches the course.';
  }
  await db.putMany('grile', qs);
  rebuild();
  return `${qs.length} keys checked against the course, ${changed} corrected`;
}

async function writeCards(job, ch, target) {
  await ensureSections(ch);
  let made = 0, fails = 0;
  while (chCards(ch).length < target && fails < 2) {
    const have = chCards(ch);
    const n = Math.min(40, target - have.length);
    job.status(`${CHAPTERS[ch]}: ${have.length}/${target} cards — writing ${n}…`); job.progress(have.length / target);
    const fresh = await P.generateCards(aiChapter(ch), sourcesById(), have.map((c) => ({ front: c[2], back: c[3] })), n, { signal: job.signal });
    if (!fresh.length) fails++;
    const missing = [...new Set(fresh.map((c) => c.section).filter((s) => !sectionKeyFor(ch, s)))];
    if (missing.length) await ensureSections(ch, missing);
    const rows = fresh.map((c) => ({ id: uid('uc'), sec: sectionKeyFor(ch, c.section) || sectionsOf(ch)[0], front: c.front, back: c.back, ch }));
    await db.putMany('cards', rows);
    U.cards.push(...rows); made += rows.length;
    rebuild();
  }
  return `${made} cards`;
}
async function saveOutput(ch, type, content) {
  const o = { id: uid('o'), ch, type, content, createdAt: Date.now() };
  await db.put('outputs', o); U.outputs.push(o); rebuild();
  return o;
}
const latest = (ch, type) => U.outputs.filter((o) => o.ch === ch && o.type === type).sort((a, b) => b.createdAt - a.createdAt)[0];
async function writeCases(job, ch) {
  job.status(`${CHAPTERS[ch]}: writing cases…`);
  const existing = CASES.filter((c) => c.ch === ch);
  const cases = await P.generateCases(aiChapter(ch), sourcesById(), existing, 10, { signal: job.signal, onStatus: (t) => job.status(`${CHAPTERS[ch]}: cases ${t}`) });
  await saveOutput(ch, 'cases', cases);
  return `${cases.length} cases`;
}
async function writeRecall(job, ch) {
  job.status(`${CHAPTERS[ch]}: writing recall sheets…`);
  const content = await P.generateRecall(aiChapter(ch), sourcesById(), { signal: job.signal, onStatus: (t) => job.status(`${CHAPTERS[ch]}: recall ${t}`) });
  await saveOutput(ch, 'recall', content);
  return `${content.recall.length} recall sheets, ${content.contrasts.length} contrast tables`;
}
async function writeExplain(job, ch) {
  await ensureSections(ch);
  job.status(`${CHAPTERS[ch]}: writing explanations…`);
  const items = await P.generateExplanations(aiChapter(ch), sourcesById(), { signal: job.signal, onStatus: (t) => job.status(`${CHAPTERS[ch]}: explanations ${t}`) });
  const missing = [...new Set(items.map((it) => it.section).filter((s) => !sectionKeyFor(ch, s)))];
  if (missing.length) await ensureSections(ch, missing);
  await saveOutput(ch, 'explain', items.map((it) => ({ sec: sectionKeyFor(ch, it.section) || sectionsOf(ch)[0], title: it.title, text: it.text })));
  return `${items.length} explanations`;
}
async function writeSummary(job, ch, onText) {
  const content = await P.synthesis(aiChapter(ch), sourcesById(), GQ.filter((x) => x.ch === ch).map(toPipe), { signal: job.signal, onText });
  await saveOutput(ch, 'summary', content);
  return content;
}
async function writePodcast(job, ch, minutes) {
  const content = await P.podcast(aiChapter(ch), sourcesById(), minutes, { signal: job.signal, onStatus: job.status });
  await saveOutput(ch, 'podcast', content);
  return content;
}

function prepareChapter(ch) {
  if (needKey()) return;
  const s = getSettings();
  if (!confirm(`Prepare everything for “${CHAPTERS[ch]}”?\n\nCheck keys against the course, fill to ${s.target} questions and ${s.cardTarget} cards, then write cases, recall sheets, explanations, an exam summary and a podcast for anything missing. This takes a few minutes and uses API credits.`)) return;
  runJob(`Preparing: ${CHAPTERS[ch]}`, async (job) => {
    const done = [];
    if (hasMaterial(ch)) done.push(await verifyKeys(job, ch));
    done.push(`${await fillOne(job, ch, s.target, s.batch)} questions`);
    done.push(await writeCards(job, ch, s.cardTarget));
    job.progress(null);
    if (!latest(ch, 'cases') && ch !== 'I') done.push(await writeCases(job, ch));
    if (!latest(ch, 'recall') && ch !== 'I') done.push(await writeRecall(job, ch));
    if (!latest(ch, 'explain') && ch !== 'I') done.push(await writeExplain(job, ch));
    if (!latest(ch, 'summary')) { job.status('Writing the exam summary…'); await writeSummary(job, ch); done.push('summary'); }
    if (!latest(ch, 'podcast')) { job.status('Writing the podcast…'); await writePodcast(job, ch, s.podcastMinutes); done.push('podcast'); }
    return `${CHAPTERS[ch]} is ready: ${done.join(', ')}.`;
  });
}

function renderSources() {
  const { target, cardTarget } = getSettings();
  $('#target-label').textContent = target;
  const mats = U.sources.filter((s) => s.kind === 'material'), banks = U.sources.filter((s) => s.kind === 'grile');
  const row = (s) => `<div class="srow"><div><div class="nm">${s.kind === 'material' ? '📘' : '📝'} ${esc(s.name)}</div>
      <div class="hint">${fmtN(s.text.length)} characters${s.transcribed ? ' · transcribed by AI' : ''} · ${s.kind === 'material' ? (s.segmented ? 'split into chapters' : '<b>not split yet</b>') : (s.extractedAt ? `${s.extractedCount ?? 0} questions added` : '<b>not sorted yet</b>')}</div></div>
      <div class="acts">${s.kind === 'grile' && s.extractedAt ? '' : ''}<button class="btn small" data-flip="${s.id}" title="Switch between course material and question bank">⇄</button><button class="btn small danger" data-delsrc="${s.id}">Delete</button></div></div>`;
  $('#src-list').innerHTML = (mats.length || banks.length) ? `<div class="box">${[...mats, ...banks].map(row).join('')}</div>` : '';
  const orphans = GQ.filter((x) => !x.ch).length;
  $('#assign-orphans').hidden = !orphans;
  $('#assign-orphans').textContent = `Sort ${orphans} unassigned questions into chapters`;
  $('#fill-all').textContent = `Fill every chapter to ${target} questions`;
  $('#ch-list').innerHTML = CH_ORDER.map((ch) => {
    const m = chMeta(ch) || {};
    const qs = chGrile(ch), base = qs.filter((x) => BASE_SRC.has(x.src)).length, ai = qs.filter((x) => x.src === 'ai').length;
    const chars = (m.ranges || []).length ? P.chapterText(aiChapter(ch), sourcesById()).length : 0;
    const pct = Math.min(100, Math.round((qs.length / target) * 100));
    const isBase = !!BASE.CHAPTERS[ch];
    const topics = sectionTitles(ch).length ? sectionTitles(ch) : (m.topics || []);
    return `<div class="chap">
      <div class="row"><h4>${esc(CHAPTERS[ch])}</h4><span class="sp"></span>
        <button class="btn small primary" data-prep="${ch}" data-ai>⚡ Prepare everything</button>
        <button class="btn small" data-fill="${ch}" data-ai ${qs.length >= target ? 'disabled' : ''}>Fill to ${target}</button>
        ${hasMaterial(ch) && U.grile.some((x) => x.ch === ch && x.src !== 'ai' && !x.verifiedAt) ? `<button class="btn small" data-verify="${ch}" data-ai>Check keys</button>` : ''}
        <button class="btn small" data-ren="${ch}">Rename</button>${isBase ? '' : `<button class="btn small danger" data-delch="${ch}">Delete</button>`}</div>
      ${m.summary ? `<div class="hint">${esc(m.summary)}</div>` : ''}
      ${topics.length ? `<div class="topics">${topics.slice(0, 20).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="nums"><div><b>${qs.length}/${target}</b>questions (${base} original · ${qs.length - base - ai} from your banks · ${ai} AI)</div>
        <div><b>${chCards(ch).length}</b>cards (target ${cardTarget})</div>
        <div><b>${chars ? fmtN(chars) : '—'}</b>${chars ? 'characters of course material' : 'no course material uploaded'}</div></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join('');
}
$('#src-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const s = U.sources.find((x) => x.id === (b.dataset.delsrc || b.dataset.flip)); if (!s) return;
  if (b.dataset.delsrc) {
    if (!confirm(`Delete “${s.name}”? Questions already taken from it stay in the bank.`)) return;
    await db.del('sources', s.id); U.sources = U.sources.filter((x) => x !== s);
  } else {
    s.kind = s.kind === 'material' ? 'grile' : 'material'; s.segmented = false; s.extractedAt = null;
    await db.put('sources', s);
    autoProcess();
  }
  rebuild(); refreshAll();
});
$('#ch-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const ch = b.dataset.prep || b.dataset.fill || b.dataset.verify || b.dataset.ren || b.dataset.delch;
  if (b.dataset.prep) prepareChapter(ch);
  if (b.dataset.fill) fillChapters([ch]);
  if (b.dataset.verify && !needKey()) runJob(`Checking keys: ${CHAPTERS[ch]}`, (job) => verifyKeys(job, ch));
  if (b.dataset.ren) {
    const t = prompt('New chapter name:', CHAPTERS[ch]);
    if (t?.trim()) { const m = await ensureChapterRecord(ch); m.title = t.trim(); await db.put('chapters', m); rebuild(); refreshAll(); }
  }
  if (b.dataset.delch) {
    if (!confirm(`Delete chapter “${CHAPTERS[ch]}”? Its questions stay in the bank as unsorted; its cards and generated material are removed.`)) return;
    const qs = U.grile.filter((x) => x.ch === ch); qs.forEach((x) => (x.ch = '')); await db.putMany('grile', qs);
    const cs = U.cards.filter((c) => c.ch === ch); await db.delMany('cards', cs.map((c) => c.id)); U.cards = U.cards.filter((c) => c.ch !== ch);
    const os = U.outputs.filter((o) => o.ch === ch); await db.delMany('outputs', os.map((o) => o.id)); U.outputs = U.outputs.filter((o) => o.ch !== ch);
    await db.del('chapters', ch); U.chapters = U.chapters.filter((c) => c.id !== ch);
    rebuild(); refreshAll();
  }
});
onShow.sources = renderSources;

/* ---------- generare din tab-urile originale ---------- */
$('#case-gen').onclick = () => { const ch = $('#case-ch').value; if (ch && !needKey()) runJob(`Cases: ${CHAPTERS[ch]}`, (job) => writeCases(job, ch)); };
$('#recall-gen').onclick = () => { const ch = $('#recall-ch').value; if (ch && !needKey()) runJob(`Recall & contrasts: ${CHAPTERS[ch]}`, (job) => writeRecall(job, ch)); };
$('#ex-gen').onclick = () => { const ch = $('#ex-ch').value; if (ch && !needKey()) runJob(`Explanations: ${CHAPTERS[ch]}`, (job) => writeExplain(job, ch)); };
$('#cards-gen').onclick = () => { const ch = $('#cards-ch').value; if (ch && !needKey()) runJob(`Cards: ${CHAPTERS[ch]}`, (job) => writeCards(job, ch, Math.max(getSettings().cardTarget, chCards(ch).length + 20))); };
$('#cards-ch').onchange = () => { const ch = $('#cards-ch').value; $('#cards-info').textContent = `${chCards(ch).length} cards in this chapter`; };

/* =====================================================================
   NOU: Sinteze de examen
   ===================================================================== */
function renderSummary() {
  const ch = $('#sum-ch').value;
  const o = latest(ch, 'summary');
  $('#sum-gen').textContent = o ? 'Rewrite summary' : 'Write summary';
  $('#sum-status').textContent = CH_ORDER.map((k) => (latest(k, 'summary') ? '✓' : '·')).join(' ') + `  (${CH_ORDER.filter((k) => latest(k, 'summary')).length}/${CH_ORDER.length} chapters)`;
  $('#sum-tools').hidden = !o;
  if (o) $('#sum-date').textContent = 'Written ' + new Date(o.createdAt).toLocaleString('ro-RO');
  if (!sumStreaming) $('#sum-body').innerHTML = o ? md(o.content) : '<p class="hint">No summary for this chapter yet.</p>';
}
let sumStreaming = null;
$('#sum-ch').onchange = renderSummary;
function writeSummaries(chs) {
  if (needKey()) return;
  if (!chs.length) return toast('Every chapter already has a summary.');
  runJob(chs.length > 1 ? `Exam summaries (${chs.length} chapters)` : `Exam summary: ${CHAPTERS[chs[0]]}`, async (job) => {
    for (let i = 0; i < chs.length; i++) {
      const ch = chs[i];
      job.progress(i / chs.length); job.status(`${CHAPTERS[ch]}: writing…`);
      sumStreaming = ch;
      try {
        await writeSummary(job, ch, (t) => {
          job.status(`${CHAPTERS[ch]}: ${fmtN(t.length)} characters`);
          if ($('#sum-ch').value === ch && !$('#tab-summaries').hidden) $('#sum-body').innerHTML = md(t);
        });
      } finally { sumStreaming = null; }
    }
    return 'Summaries ready.';
  });
}
$('#sum-gen').onclick = () => writeSummaries([$('#sum-ch').value]);
$('#sum-all').onclick = () => writeSummaries(CH_ORDER.filter((k) => !latest(k, 'summary')));
$('#sum-dl').onclick = () => { const o = latest($('#sum-ch').value, 'summary'); if (o) download(`Summary - ${CHAPTERS[o.ch]}.md`, o.content, 'text/markdown'); };
$('#sum-print').onclick = () => {
  const o = latest($('#sum-ch').value, 'summary'); if (!o) return;
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(CHAPTERS[o.ch])}</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:800px;margin:30px auto;padding:0 20px;color:#111}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}h2{border-bottom:1px solid #ccc}</style></head><body><h1>${esc(CHAPTERS[o.ch])}</h1>${md(o.content)}</body></html>`);
  w.document.close(); w.onload = () => w.print();
};
onShow.summaries = renderSummary;

/* =====================================================================
   NOU: Podcast
   ===================================================================== */
const pod = { playing: false, idx: 0, token: null, rate: 1, voices: {} };
function renderPodcast() {
  const ch = $('#pod-ch').value;
  const o = latest(ch, 'podcast');
  $('#pod-gen').textContent = o ? 'Rewrite episode' : 'Write episode';
  if (!o) { $('#pod-box').innerHTML = '<p class="hint">No episode for this chapter yet.</p>'; return; }
  const all = speechSynthesis.getVoices();
  const ro = all.filter((v) => /^ro/i.test(v.lang));
  const list = ro.length ? ro : all;
  const opt = (sel) => list.map((v) => `<option value="${esc(v.name)}" ${v.name === sel ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('');
  $('#pod-box').innerHTML = `<div class="box">
    <div class="controls"><b style="flex:1">🎙️ ${esc(o.content.title)}</b><button class="btn small" id="pod-dl">Download script</button></div>
    ${all.length && !ro.length ? '<p class="hint">No Romanian voice is installed in this browser, so another voice is used. On Windows: Settings → Time &amp; language → Speech → add Română. Chrome and Edge usually offer an online Romanian voice.</p>' : ''}
    <div class="controls"><label class="inline">Ana <select id="pod-va">${opt(pod.voices.Ana || list[0]?.name)}</select></label><label class="inline">Mihai <select id="pod-vm">${opt(pod.voices.Mihai || list[1]?.name || list[0]?.name)}</select></label></div>
    <div class="controls"><button class="btn primary" id="pod-play">▶ Play</button><button class="btn" id="pod-pause">⏸ Pause</button><button class="btn" id="pod-stop">⏹ Stop</button>
      <label class="inline">Speed <input type="range" id="pod-rate" min="0.7" max="1.6" step="0.1" value="${pod.rate}"></label></div>
    <div id="pod-lines">${o.content.lines.map((l, i) => `<div class="pod-line ${esc(l.speaker)}" data-i="${i}"><b>${esc(l.speaker)}</b>${esc(l.text)}</div>`).join('')}</div></div>`;
  $('#pod-va').onchange = (e) => (pod.voices.Ana = e.target.value);
  $('#pod-vm').onchange = (e) => (pod.voices.Mihai = e.target.value);
  $('#pod-rate').oninput = (e) => (pod.rate = +e.target.value);
  $('#pod-dl').onclick = () => download(`Podcast - ${CHAPTERS[ch]}.txt`, `${o.content.title}\n\n` + o.content.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n\n'), 'text/plain');
  $('#pod-play').onclick = () => { if (speechSynthesis.paused) speechSynthesis.resume(); else play(o.content.lines, pod.idx); };
  $('#pod-pause').onclick = () => speechSynthesis.pause();
  $('#pod-stop').onclick = () => { stopPod(); pod.idx = 0; $$('.pod-line').forEach((x) => x.classList.remove('now')); };
  $$('.pod-line').forEach((el) => (el.onclick = () => play(o.content.lines, +el.dataset.i)));
  if (pod.playing) $(`.pod-line[data-i="${pod.idx}"]`)?.classList.add('now');
}
function play(lines, start) {
  speechSynthesis.cancel();
  pod.playing = true;
  const token = (pod.token = Symbol());
  const speak = (i) => {
    if (pod.token !== token) return;
    if (i >= lines.length) { pod.playing = false; pod.idx = 0; return; }
    pod.idx = i;
    $$('.pod-line').forEach((x) => x.classList.toggle('now', +x.dataset.i === i));
    $(`.pod-line[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const l = lines[i];
    const u = new SpeechSynthesisUtterance(l.text);
    const name = l.speaker === 'Ana' ? $('#pod-va')?.value : $('#pod-vm')?.value;
    const v = speechSynthesis.getVoices().find((x) => x.name === name);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ro-RO';
    u.rate = pod.rate;
    if ($('#pod-va')?.value === $('#pod-vm')?.value) u.pitch = l.speaker === 'Ana' ? 1.15 : 0.85;
    u.onend = () => speak(i + 1);
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') speak(i + 1); };
    speechSynthesis.speak(u);
  };
  speak(start);
}
function stopPod() { pod.token = null; pod.playing = false; speechSynthesis.cancel(); }
$('#pod-ch').onchange = () => { stopPod(); pod.idx = 0; renderPodcast(); };
$('#pod-min').value = String(getSettings().podcastMinutes || 5);
$('#pod-min').onchange = (e) => saveSettings({ ...getSettings(), podcastMinutes: +e.target.value });
$('#pod-gen').onclick = () => {
  const ch = $('#pod-ch').value;
  if (needKey()) return;
  stopPod();
  runJob(`Podcast: ${CHAPTERS[ch]}`, async (job) => { const c = await writePodcast(job, ch, +$('#pod-min').value); return `Episode ready: ${c.lines.length} lines.`; });
};
speechSynthesis.onvoiceschanged = () => { if (!$('#tab-podcast').hidden && !pod.playing) renderPodcast(); };
onShow.podcast = renderPodcast;

/* =====================================================================
   NOU: Setări & backup
   ===================================================================== */
function renderSettings() {
  const s = getSettings();
  $('#st-key').value = s.apiKey;
  $('#st-model').innerHTML = MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  $('#st-target').value = s.target; $('#st-batch').value = s.batch; $('#st-ctarget').value = s.cardTarget;
  $('#st-counts').textContent = `You have added ${U.sources.length} sources, ${U.chapters.filter((c) => !BASE.CHAPTERS[c.id]).length} chapters, ${U.grile.length} questions, ${U.cards.length} cards and ${U.outputs.length} generated sets. With the original content: ${GQ.length} questions and ${CARDS.length} cards in total.`;
}
$('#st-save').onclick = () => {
  const s = getSettings();
  saveSettings({ ...s, apiKey: $('#st-key').value.trim(), model: $('#st-model').value,
    target: Math.max(10, +$('#st-target').value || 100), batch: Math.min(40, Math.max(5, +$('#st-batch').value || 15)), cardTarget: Math.max(10, +$('#st-ctarget').value || 60) });
  toast('Settings saved.');
  refreshAll();
  autoProcess();
};
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  a.download = name.replace(/[\\/:*?"<>|]/g, '_'); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#st-exp').onclick = () => download(`semiologie-recall-backup-${today()}.json`, JSON.stringify({ app: 'semiologie-recall-plus', version: 1, user: U, progress: store }), 'application/json');
$('#st-imp').onclick = () => $('#st-file').click();
$('#st-file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data.user || !data.progress) throw new Error('not a backup from this app');
    if (!confirm('Importing replaces everything you added and your review progress. Continue?')) return;
    for (const k of Object.keys(U)) { await db.clear(k); await db.putMany(k, data.user[k] || []); }
    store = data.progress; if (!store.g) store.g = {}; lsWrite();
    await loadUser(); refreshAll(); toast('Backup imported.');
  } catch (err) { toast('Could not import: ' + err.message); }
  e.target.value = '';
};
$('#st-wipe').onclick = async () => {
  if (!confirm('Delete every source, chapter, question, card, summary and podcast you added? The original content and your review progress stay.')) return;
  for (const k of Object.keys(U)) await db.clear(k);
  await loadUser(); refreshAll();
};
onShow.settings = renderSettings;

/* =====================================================================
   Reîmprospătare generală
   ===================================================================== */
function refreshAll() {
  rebuild();
  const nCh = CH_ORDER.length;
  $('#subtitle').textContent = `A spaced-repetition deck (${CARDS.length} cards), mixed clinical cases, recall sheets and mechanism explanations, plus ${GQ.length} exam questions (grile) across ${nCh} chapters, with keys checked against the course. Add material and question banks in Sources & chapters.`;
  fillSecSel(); fillExSel(); fillGFilters();
  for (const id of ['#case-ch', '#recall-ch']) chOptions($(id), { all: true });
  for (const id of ['#ex-ch', '#cards-ch', '#sum-ch', '#pod-ch']) chOptions($(id));
  $('#cards-info').textContent = `${chCards($('#cards-ch').value).length} cards in this chapter`;
  $('#case-gen').disabled = !$('#case-ch').value; $('#recall-gen').disabled = !$('#recall-ch').value;
  gRenderStats();
  limitIn.value = store.meta.newLimit; refreshStats(); if (!started) renderCard();
  if (!caseDone) renderCases();
  renderRecall(); renderExplain();
  $('#card-count').textContent = CARDS.length;
  const visible = $$('nav.tabs button').find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab;
  if (visible && visible !== 'podcast' && onShow[visible]) onShow[visible]();
  if (visible === 'podcast' && !pod.playing) renderPodcast();
}

await loadUser();
gFilt.ch.innerHTML = '<option value="I">I</option>'; // capitolul implicit, ca în original
refreshAll();
gFilt.ch.value = 'I'; gRenderStats();
try { const t = localStorage.getItem('semio-tab'); if (t && $(`nav.tabs button[data-tab="${t}"]`)) showTab(t); } catch (e) { /* ignore */ }
