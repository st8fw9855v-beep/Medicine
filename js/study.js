// Vederile de învățare activă: repetiție spațiată, cazuri clinice, recall & contraste, explicații, metodă.
import { db, uid } from './db.js';
import { getSettings } from './ai.js';
import * as P from './pipelines.js';
import { S, $, $$, esc, md, fmt, sourcesById, chapterById, toast, runJob, render, needKey, needKeyToast, views } from './core.js';
import DOMPurify from '../vendor/purify.es.mjs';

const DAY = 864e5;
const META_KEY = 'medstudy.srs';
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Capitolul „de referință" pentru generare: dacă nu există material de curs, folosim grilele/cardurile ca programă.
export function withRef(ch) {
  const qs = S.questions.filter((q) => q.chapterId === ch.id).slice(0, 200);
  const cs = S.cards.filter((c) => c.chapterId === ch.id).slice(0, 200);
  const refText = qs.map((q) => `- ${q.stem} → ${q.correct.map((k) => q.options[k]).join('; ')}`).join('\n') + '\n' + cs.map((c) => `- ${c.front} → ${c.back}`).join('\n');
  return { ...ch, refText };
}

// Opțiuni de „domeniu": capitolele + conținutul importat fără capitol.
function scopeSelect(id, type, selected, { all = true } = {}) {
  const imports = [...new Set(S.outputs.filter((o) => o.type === type && !o.chapterId && o.importLabel).map((o) => o.importLabel))];
  return `<select id="${id}">
    ${all ? `<option value="__all" ${selected === '__all' ? 'selected' : ''}>Toate capitolele (amestecat)</option>` : ''}
    ${S.chapters.map((c, i) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${i + 1}. ${esc(c.title)}</option>`).join('')}
    ${imports.map((l) => `<option value="imp:${esc(l)}" ${selected === 'imp:' + l ? 'selected' : ''}>Import: ${esc(l)}</option>`).join('')}
  </select>`;
}
function outputsFor(type, scope) {
  return S.outputs.filter((o) => o.type === type && (scope === '__all' || o.chapterId === scope || (scope.startsWith('imp:') && !o.chapterId && o.importLabel === scope.slice(4))));
}
async function saveOutput(chapterId, type, content) {
  const o = { id: uid('o_'), chapterId, type, content, createdAt: Date.now() };
  await db.put('outputs', o);
  S.outputs.push(o);
  return o;
}

// ======================= REPETIȚIE SPAȚIATĂ =======================
function meta() {
  let m;
  try { m = JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { m = {}; }
  const today = new Date().toISOString().slice(0, 10);
  if (m.day !== today) { m.day = today; m.newCount = 0; }
  return m;
}
function saveMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ } }
function dueAt(days) { const d = new Date(); d.setHours(4, 0, 0, 0); return d.getTime() + days * DAY; }
const cardStatus = (c) => (!c.srs ? 'new' : c.srs.i >= 21 ? 'mat' : 'learn');
function intervals(s) {
  const r = s ? s.r : 0, i = s ? s.i : 0, e = s ? s.e : 2.5;
  return {
    hard: r === 0 ? 1 : Math.max(1, Math.round(i * 1.2)),
    good: r === 0 ? 1 : r === 1 ? 3 : Math.round(i * e),
    easy: r === 0 ? 3 : Math.round(Math.max(i, 1) * e * 1.3),
  };
}
const fmtDays = (d) => (d < 30 ? `${d}z` : d < 365 ? `${Math.round(d / 30)}l` : `${(d / 365).toFixed(1)}a`);

async function gradeCard(card, g) {
  const now = Date.now();
  const isNew = !card.srs;
  const s = card.srs ? { ...card.srs } : { i: 0, e: 2.5, r: 0, d: now, l: 0 };
  const p = intervals(card.srs);
  if (g === 0) { s.r = 0; s.i = 0; s.e = Math.max(1.3, s.e - 0.2); s.l = (s.l || 0) + 1; s.d = now + 10 * 60e3; }
  else if (g === 1) { s.i = p.hard; s.e = Math.max(1.3, s.e - 0.15); s.r++; s.d = dueAt(s.i); }
  else if (g === 2) { s.i = p.good; s.r++; s.d = dueAt(s.i); }
  else { s.i = p.easy; s.e += 0.15; s.r++; s.d = dueAt(s.i); }
  card.srs = s;
  await db.put('cards', card);
  if (isNew) { const m = meta(); m.newCount = (m.newCount || 0) + 1; saveMeta(m); }
}

function cardsInScope(scope) {
  return scope === '__all' ? S.cards : scope === '__none' ? S.cards.filter((c) => !c.chapterId || !chapterById(c.chapterId)) : S.cards.filter((c) => c.chapterId === scope);
}
function srsCounts(scope) {
  const now = Date.now();
  const list = cardsInScope(scope);
  let due = 0, nw = 0, learn = 0, mat = 0;
  for (const c of list) { if (!c.srs) nw++; else { if (c.srs.d <= now) due++; c.srs.i >= 21 ? mat++ : learn++; } }
  const newLeft = Math.max(0, Math.min(nw, getSettings().newPerDay - (meta().newCount || 0)));
  return { due, nw, newLeft, learn, mat, list };
}
function buildQueue(scope) {
  const { newLeft, list } = srsCounts(scope);
  const now = Date.now();
  const due = list.filter((c) => c.srs && c.srs.d <= now).sort((a, b) => a.srs.d - b.srs.d);
  const fresh = list.filter((c) => !c.srs).slice(0, newLeft);
  const q = []; let i = 0, j = 0;
  while (i < due.length || j < fresh.length) { if (i < due.length) q.push(due[i++]); if (i < due.length) q.push(due[i++]); if (j < fresh.length) q.push(fresh[j++]); }
  return q;
}

function viewReview(v) {
  const st = (S.ui.srs ||= { scope: '__all', started: false });
  const target = getSettings().cardTarget;
  const unassigned = S.cards.filter((c) => !c.chapterId || !chapterById(c.chapterId)).length;
  const c = srsCounts(st.scope);
  v.innerHTML = `<h2>Repetiție spațiată</h2>
    <p class="lead">Carduri cu o singură întrebare fiecare, programate la intervale tot mai mari (≈1 → 3 → 7 → 16 → 35+ zile). Răspunde cu voce tare sau pe hârtie <b>înainte</b> de a întoarce cardul: dacă doar îl recunoști pe ecran, nu se pune.</p>
    <div class="card"><div class="row">
      <div style="flex:1;min-width:220px"><select id="sr-scope"><option value="__all">Toate capitolele</option>${S.chapters.map((ch, i) => `<option value="${ch.id}" ${st.scope === ch.id ? 'selected' : ''}>${i + 1}. ${esc(ch.title)}</option>`).join('')}${unassigned ? `<option value="__none" ${st.scope === '__none' ? 'selected' : ''}>— Fără capitol (${unassigned})</option>` : ''}</select></div>
      <button id="sr-start" ${c.due + c.newLeft ? '' : 'disabled'}>Începe sesiunea</button></div>
      <div class="stats">
        <div><b>${c.due}</b><span>de repetat acum</span></div><div><b>${c.newLeft}</b><span>noi azi</span></div>
        <div><b>${c.learn}</b><span>în învățare</span></div><div><b>${c.mat}</b><span>consolidate ≥21z</span></div><div><b>${c.list.length}</b><span>total carduri</span></div>
      </div>
      <p class="small muted">Taste: <kbd>Spațiu</kbd> arată răspunsul, apoi <kbd>1</kbd>–<kbd>4</kbd> îl notează. Limita de carduri noi/zi se schimbă din Setări (acum ${getSettings().newPerDay}).</p>
    </div>
    <div id="sr-session"></div>
    <div class="card">
      <div class="row" style="margin-bottom:8px"><strong>Carduri pe capitole</strong><span class="spacer"></span><button class="small" id="sr-gen-all" ${S.chapters.length ? '' : 'disabled'}>Generează carduri pentru toate capitolele (ținta ${target})</button></div>
      ${S.chapters.length ? `<table class="list"><tr><th>Capitol</th><th>Carduri</th><th></th></tr>${S.chapters.map((ch, i) => {
        const n = S.cards.filter((x) => x.chapterId === ch.id).length;
        return `<tr><td>${i + 1}. ${esc(ch.title)}</td><td>${n}/${target}</td><td style="text-align:right"><button class="small" data-gencards="${ch.id}" ${n >= target ? 'disabled' : ''}>Completează</button></td></tr>`;
      }).join('')}</table>` : '<div class="empty">Segmentează întâi materia sau importă un deck.</div>'}
    </div>
    <div class="card"><details><summary><strong>Toate cardurile</strong> (caută / răsfoiește)</summary>
      <input type="text" id="sr-search" placeholder="Caută în carduri…" style="margin:10px 0"/><div id="sr-deck"></div></details></div>`;
  $('#sr-scope').onchange = (e) => { st.scope = e.target.value; st.started = false; render(); };
  $('#sr-start').onclick = () => { st.started = true; st.queue = buildQueue(st.scope); st.reviewed = 0; st.cur = st.queue.shift() || null; st.shown = false; srsRender(); };
  $('#sr-gen-all').onclick = () => genCards(S.chapters.map((x) => x.id));
  const deck = () => {
    const q = P.normStem($('#sr-search').value);
    const list = cardsInScope(st.scope).filter((x) => !q || P.normStem(x.front + ' ' + x.back).includes(q)).slice(0, 300);
    $('#sr-deck').innerHTML = list.map((x) => `<div class="dc"><div><span class="pill p-${cardStatus(x)}">${{ new: 'NOU', learn: 'ÎNVĂȚARE', mat: 'CONSOLIDAT' }[cardStatus(x)]}</span> <b>${esc(x.front)}</b> <span class="muted small">· ${esc(x.section || '')}</span></div><div class="small" style="white-space:pre-line">${esc(x.back)}</div></div>`).join('') || '<div class="empty">Niciun card.</div>';
  };
  $('#sr-search').oninput = deck;
  v.querySelector('details').addEventListener('toggle', deck, { once: true });
  v.onclick = (e) => { const b = e.target.closest('[data-gencards]'); if (b) genCards([b.dataset.gencards]); };
  srsRender();
}

function srsRender() {
  const st = S.ui.srs;
  const box = $('#sr-session');
  if (!box) return;
  if (!st.started) { box.innerHTML = ''; return; }
  if (!st.cur) {
    box.innerHTML = `<div class="card flash done"><div class="fq">${st.reviewed ? `Sesiune încheiată: ${st.reviewed} repetări` : 'Nimic de repetat acum'}</div>
      <p class="muted">${st.reviewed ? 'Revino mâine. Pauzele dintre repetări sunt cele care fixează informația.' : 'Mărește limita de carduri noi, alege alt capitol sau fă cazuri clinice amestecate.'}</p>
      <button class="ghost" id="sr-close">Închide</button></div>`;
    $('#sr-close').onclick = () => { st.started = false; render(); };
    return;
  }
  const c = st.cur, p = intervals(c.srs), s = cardStatus(c);
  box.innerHTML = `<div class="card flash">
    <div class="row small muted"><span>${esc(chapterById(c.chapterId)?.title || '')}${c.section ? ' · ' + esc(c.section) : ''}</span><span class="spacer"></span>
      <span class="pill p-${s}">${{ new: 'NOU', learn: 'ÎNVĂȚARE', mat: 'CONSOLIDAT' }[s]}</span><span>${st.queue.length} rămase</span><button class="ghost small" id="sr-stop">Oprește</button></div>
    <div class="fq">${esc(c.front)}</div>
    ${st.shown ? `<div class="fa">${esc(c.back)}</div>
      <button class="link" id="sr-why">De ce? Citește explicația pentru această secțiune →</button>
      <div class="grades">
        <button class="g0" data-g="0">Din nou<small>10 min · 1</small></button>
        <button class="g1" data-g="1">Greu<small>${fmtDays(p.hard)} · 2</small></button>
        <button class="g2" data-g="2">Bine<small>${fmtDays(p.good)} · 3</small></button>
        <button class="g3" data-g="3">Ușor<small>${fmtDays(p.easy)} · 4</small></button>
      </div>` : `<button id="sr-show">Arată răspunsul</button><p class="small muted">Spune sau scrie răspunsul întâi.</p>`}
  </div>`;
  $('#sr-stop').onclick = () => { st.started = false; render(); };
  const sh = $('#sr-show'); if (sh) sh.onclick = () => { st.shown = true; srsRender(); };
  const why = $('#sr-why'); if (why) why.onclick = () => openExplain(c.chapterId, c.section, c.sourceName);
  $$('[data-g]', box).forEach((b) => (b.onclick = () => doGrade(+b.dataset.g)));
}
async function doGrade(g) {
  const st = S.ui.srs;
  if (!st?.cur || !st.shown) return;
  const c = st.cur;
  await gradeCard(c, g);
  st.reviewed++;
  if (g === 0) st.queue.splice(Math.min(3, st.queue.length), 0, c);
  st.cur = st.queue.shift() || null;
  st.shown = false;
  srsRender();
}
document.addEventListener('keydown', (e) => {
  const st = S.ui.srs;
  if (S.tab !== 'repetitie' || !st?.started || !st.cur || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Space' && !st.shown) { e.preventDefault(); st.shown = true; srsRender(); }
  else if (st.shown && ['1', '2', '3', '4'].includes(e.key)) doGrade(+e.key - 1);
});

function genCards(ids) {
  if (needKeyToast()) return;
  const target = getSettings().cardTarget;
  runJob(ids.length > 1 ? `Carduri pentru ${ids.length} capitole` : `Carduri: ${chapterById(ids[0]).title}`, async (job) => {
    let made = 0;
    for (let ci = 0; ci < ids.length; ci++) {
      const ch = chapterById(ids[ci]);
      let fails = 0;
      while (S.cards.filter((c) => c.chapterId === ch.id).length < target && fails < 2) {
        const have = S.cards.filter((c) => c.chapterId === ch.id);
        const n = Math.min(40, target - have.length);
        const pre = `${ids.length > 1 ? `[${ci + 1}/${ids.length}] ` : ''}${ch.title}: ${have.length}/${target}`;
        job.status(`${pre} — scriu ${n} carduri…`);
        job.progress(have.length / target);
        const fresh = await P.generateCards(withRef(ch), sourcesById(), have, n, { signal: job.signal, onStatus: (t) => job.status(`${pre} — scriu ${n} carduri ${t}`) });
        if (!fresh.length) fails++;
        await db.putMany('cards', fresh);
        S.cards.push(...fresh);
        made += fresh.length;
      }
    }
    return `Am creat ${made} carduri noi.`;
  });
}

// ======================= CAZURI CLINICE =======================
function viewCases(v) {
  const st = (S.ui.cases ||= { scope: '__all' });
  st.pick ||= {};
  needKey(v);
  const list = outputsFor('cazuri', st.scope).flatMap((o) => o.content.map((c, k) => ({ ...c, key: `${o.id}:${k}` })));
  if (!st.order || st.orderScope !== st.scope || st.order.length !== list.length) { st.order = shuffle(list.map((x) => x.key)); st.orderScope = st.scope; st.ans = {}; }
  const byKey = Object.fromEntries(list.map((x) => [x.key, x]));
  const done = Object.keys(st.ans).length, right = Object.values(st.ans).filter(Boolean).length;
  v.insertAdjacentHTML('beforeend', `<h2>Cazuri clinice amestecate</h2>
    <p class="lead">Cazurile sar între teme: trebuie să alegi ce concept se aplică, exact ce testează examenul și secția. Amestecă, nu bloca.</p>
    <div class="card"><div class="row">
      <div style="flex:1;min-width:220px">${scopeSelect('cs-scope', 'cazuri', st.scope)}</div>
      <button class="ghost" id="cs-shuffle">Amestecă din nou</button>
      <button id="cs-gen" ${st.scope.startsWith('imp:') || !S.chapters.length ? 'disabled' : ''}>${st.scope === '__all' ? 'Generează 10 cazuri / capitol' : '+10 cazuri'}</button>
      <span class="muted small">${done ? `Scor: ${right}/${done}` : `${list.length} cazuri`}</span></div></div>
    ${st.order.map((k, n) => { const c = byKey[k]; if (!c) return ''; const a = st.ans[k];
      return `<div class="case card" data-key="${k}"><b>${n + 1}.</b> ${esc(c.q)}
        <div class="opts">${c.o.map((o, i) => `<button data-i="${i}" class="${a !== undefined ? (i === c.a ? 'right' : (st.pick[k] === i ? 'wrong' : '')) : ''}" ${a !== undefined ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
        ${a !== undefined ? `<div class="why">${esc(c.w)}</div>` : ''}</div>`; }).join('') || '<div class="card empty">Niciun caz încă. Generează cazuri sau importă o pagină de studiu.</div>'}`);
  $('#cs-scope').onchange = (e) => { st.scope = e.target.value; render(); };
  $('#cs-shuffle').onclick = () => { st.order = null; render(); };
  $('#cs-gen').onclick = () => {
    if (needKeyToast()) return;
    const ids = st.scope === '__all' ? S.chapters.map((c) => c.id) : [st.scope];
    runJob(`Cazuri clinice (${ids.length} capitole)`, async (job) => {
      let n = 0;
      for (let i = 0; i < ids.length; i++) {
        const ch = chapterById(ids[i]);
        job.progress(i / ids.length);
        job.status(`${ch.title}: scriu cazuri…`);
        const existing = outputsFor('cazuri', ch.id).flatMap((o) => o.content);
        const cases = await P.generateCases(withRef(ch), sourcesById(), existing, 10, { signal: job.signal, onStatus: (t) => job.status(`${ch.title}: ${t}`) });
        await saveOutput(ch.id, 'cazuri', cases);
        n += cases.length;
      }
      st.order = null;
      return `${n} cazuri noi.`;
    });
  };
  $$('.case', v).forEach((el) => $$('.opts button', el).forEach((b) => (b.onclick = () => {
    const k = el.dataset.key, c = byKey[k];
    st.pick[k] = +b.dataset.i;
    st.ans[k] = +b.dataset.i === c.a;
    const y = window.scrollY; render(); window.scrollTo(0, y);
  })));
}

// ======================= RECALL & CONTRASTE =======================
function viewRecall(v) {
  const st = (S.ui.recall ||= { scope: S.chapters[0]?.id || '__all', text: {}, chk: {} });
  needKey(v);
  const outs = outputsFor('recall', st.scope);
  const recall = outs.flatMap((o) => o.content.recall.map((r, i) => ({ ...r, key: `${o.id}:${i}` })));
  const contrasts = outs.flatMap((o) => o.content.contrasts);
  v.insertAdjacentHTML('beforeend', `<h2>Recall liber & tabele de contrast</h2>
    <p class="lead">Cu cartea închisă, scrie tot ce îți amintești despre temă („blurting"). Apoi bifează din checklist ce ai prins: ce lipsește e exact ce ai de studiat.</p>
    <div class="card"><div class="row"><div style="flex:1;min-width:220px">${scopeSelect('rc-scope', 'recall', st.scope)}</div>
      <button id="rc-gen" ${st.scope === '__all' || st.scope.startsWith('imp:') ? 'disabled title="Alege un capitol"' : ''}>${outs.length ? 'Regenerează' : 'Generează fișele'}</button></div></div>
    ${recall.map((r) => { const chk = st.chk[r.key] || []; return `<details class="card recall" data-key="${r.key}"><summary><strong>${esc(r.t)}</strong> ${chk.length ? `<span class="badge">${chk.length}/${r.i.length}</span>` : ''}</summary>
      <p class="muted">${esc(r.p)}</p>
      <textarea placeholder="Cartea închisă. Scrie tot ce îți amintești…">${esc(st.text[r.key] || '')}</textarea>
      <details style="margin-top:8px"><summary class="small muted">Arată checklist-ul și bifează ce ai prins (${r.i.length} elemente)</summary>
      <div class="checks">${r.i.map((it, k) => `<label><input type="checkbox" data-k="${k}" ${chk.includes(k) ? 'checked' : ''}/> ${esc(it)}</label>`).join('')}</div></details></details>`; }).join('')}
    ${contrasts.length ? `<h2 style="margin-top:24px">Tabele de contrast</h2><p class="lead">Completează-le întâi din memorie, pe hârtie, apoi verifică aici.</p>` : ''}
    ${contrasts.map((t) => `<div class="card"><h3 style="margin-top:0">${esc(t.t)}</h3><div class="tablewrap"><table class="contrast"><thead><tr>${t.h.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.r.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<td><b>${esc(c)}</b></td>`)).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('')}
    ${!recall.length && !contrasts.length ? '<div class="card empty">Nicio fișă pentru această selecție.</div>' : ''}`);
  $('#rc-scope').onchange = (e) => { st.scope = e.target.value; render(); };
  $$('details.recall', v).forEach((d) => {
    const k = d.dataset.key;
    $('textarea', d).oninput = (e) => (st.text[k] = e.target.value);
    $$('input[type=checkbox]', d).forEach((cb) => (cb.onchange = () => { st.chk[k] = $$('input[type=checkbox]', d).filter((x) => x.checked).map((x) => +x.dataset.k); }));
  });
  $('#rc-gen').onclick = () => {
    if (needKeyToast()) return;
    const ch = chapterById(st.scope);
    runJob(`Recall & contraste: ${ch.title}`, async (job) => {
      const content = await P.generateRecall(withRef(ch), sourcesById(), { signal: job.signal, onStatus: job.status });
      const old = outputsFor('recall', ch.id);
      await db.delMany('outputs', old.map((o) => o.id));
      S.outputs = S.outputs.filter((o) => !old.includes(o));
      await saveOutput(ch.id, 'recall', content);
      return `${content.recall.length} fișe, ${content.contrasts.length} tabele.`;
    });
  };
}

// ======================= EXPLICAȚII =======================
export function openExplain(chapterId, section, importLabel) {
  const scope = chapterId && chapterById(chapterId) && outputsFor('explicatii', chapterId).length ? chapterId
    : (importLabel && outputsFor('explicatii', 'imp:' + importLabel).length ? 'imp:' + importLabel : chapterId || '__all');
  S.ui.explain = { scope, focus: section };
  $('#tabs [data-tab=explicatii]').click();
}
function viewExplain(v) {
  const st = (S.ui.explain ||= { scope: S.chapters[0]?.id || '__all' });
  needKey(v);
  const items = outputsFor('explicatii', st.scope).flatMap((o) => o.content);
  const groups = {};
  for (const it of items) (groups[it.section || ''] ||= []).push(it);
  v.insertAdjacentHTML('beforeend', `<h2>Explicații: de ce?</h2>
    <p class="lead">Mecanismul din spatele fiecărui semn. Un fapt legat de cauza lui se uită mult mai greu. Citește explicația secțiunii după ce îi termini cardurile.</p>
    <div class="card"><div class="row"><div style="flex:1;min-width:220px">${scopeSelect('ex-scope', 'explicatii', st.scope)}</div>
      <button id="ex-gen" ${st.scope === '__all' || st.scope.startsWith('imp:') ? 'disabled title="Alege un capitol"' : ''}>${items.length ? 'Regenerează' : 'Generează explicațiile'}</button></div></div>
    ${Object.entries(groups).map(([sec, arr]) => `<article class="card ex" data-sec="${esc(sec)}"><h3 style="margin-top:0">${esc(sec)}</h3>
      ${arr.map((it) => `<h4>${esc(it.title)}</h4><div class="md">${it.html ? DOMPurify.sanitize(`<p>${it.text}</p>`) : md(it.text)}</div>`).join('')}</article>`).join('') || '<div class="card empty">Nicio explicație pentru această selecție.</div>'}`);
  $('#ex-scope').onchange = (e) => { st.scope = e.target.value; st.focus = null; render(); };
  $('#ex-gen').onclick = () => {
    if (needKeyToast()) return;
    const ch = chapterById(st.scope);
    runJob(`Explicații: ${ch.title}`, async (job) => {
      const items = await P.generateExplanations(withRef(ch), sourcesById(), { signal: job.signal, onStatus: job.status });
      const old = outputsFor('explicatii', ch.id);
      await db.delMany('outputs', old.map((o) => o.id));
      S.outputs = S.outputs.filter((o) => !old.includes(o));
      await saveOutput(ch.id, 'explicatii', items);
      return `${items.length} explicații.`;
    });
  };
  if (st.focus) {
    const el = $$('.ex', v).find((a) => a.dataset.sec === st.focus) || $$('.ex', v).find((a) => P.normStem(a.dataset.sec).includes(P.normStem(st.focus).slice(0, 20)));
    if (el) { el.classList.add('focus'); setTimeout(() => el.scrollIntoView({ block: 'start' }), 50); }
    st.focus = null;
  }
}

// ======================= METODĂ =======================
function viewMethod(v) {
  v.innerHTML = `<h2>Cum să rămână informația</h2>
  <p class="lead">Cercetarea despre învățarea durabilă ajunge mereu la două tehnici: <b>extragerea din memorie</b> (retrieval practice) și <b>repetiția spațiată</b>. Recititul și sublinierea par productive, dar rețin puțin pe termen lung.</p>
  <div class="card"><h3 style="margin-top:0">Bucla de studiu pentru fiecare subcapitol</h3>
  <ol class="steps">
    <li><b>Pre-test (2 min).</b> Înainte să citești, uită-te la titlu și scrie ce crezi că e acolo. Chiar dacă greșești, reții mai bine după.</li>
    <li><b>Citește o bucată cu o întrebare (5–8 pagini).</b> Pentru fiecare semn întreabă-te: ce m-ar face să-l suspectez și ce seamănă cu el? Nu sublinia.</li>
    <li><b>Închide cartea și scrie tot (5–10 min).</b> Folosește tabul <i>Recall</i>, apoi bifează ce ai prins. Ce lipsește studiezi în continuare.</li>
    <li><b>Transformă golurile în carduri (5 min).</b> Un fapt pe card. Folosește tabul <i>Repetiție</i>.</li>
    <li><b>Explică mecanismul.</b> Leagă fiecare semn de cauza lui. Folosește tabul <i>Explicații</i>.</li>
    <li><b>Repetă după program (20–30 min/zi).</b> Repetările scadente se fac înaintea materiei noi.</li>
    <li><b>Amestecă, nu bloca (de 2–3 ori/săpt.).</b> Fă <i>Cazuri</i> amestecate din capitole diferite. Să alegi conceptul potrivit e exact ce testează examenul.</li>
    <li><b>Desenează, fă, predă (săptămânal).</b> Desenează curbele și schemele din memorie, exersează manevrele pe un coleg și explică un subcapitol cu voce tare, fără notițe.</li>
  </ol></div>
  <div class="grid2">
  <div class="card"><h3 style="margin-top:0">Cum folosești grilele</h3><ul>
    <li>După cardurile unei secțiuni, exersează capitolul în <i>Test</i> → „Exersare” (feedback după fiecare grilă). Citește notele: ele arată unde cheile vechi contrazic cursul.</li>
    <li>O dată pe săptămână, fă o <b>simulare de examen</b> de 30–50 de grile din toate capitolele parcurse. Apoi reia „Doar greșelile mele” până lista se golește.</li>
    <li>Când o cheie din culegere contrazice cursul, învață varianta din curs. Butonul <i>Verifică cheile</i> din Banca de grile le marchează automat.</li></ul></div>
  <div class="card"><h3 style="margin-top:0">Reguli pentru carduri</h3><ul>
    <li>O întrebare, un răspuns. „Cauzele febrei continue?” e un card bun; „Toate tipurile de febră?” nu e.</li>
    <li>Construiește carduri pe <b>discriminatori</b>: diferența dintre semne asemănătoare.</li>
    <li>Pragurile numerice primesc card propriu.</li>
    <li>Mnemotehnici doar pentru liste arbitrare; pentru restul, mecanismul.</li>
    <li>Un card picat de 4+ ori trebuie rescris mai mic sau cu „de ce”-ul adăugat.</li></ul></div></div>
  <div class="card"><h3 style="margin-top:0">Ritmul</h3><ul>
    <li>Introdu 25–30 de carduri noi pe zi (40–50 dacă examenul e aproape).</li>
    <li>Programează ultima bucată nouă cu cel puțin 10 zile înaintea examenului, ca fiecare card să mai primească 2–3 repetări.</li>
    <li>Înainte de examen nu trece pe recitit. Fă repetări și cazuri, iar noaptea dinainte dormi: memoria se consolidează în somn.</li></ul></div>`;
}

Object.assign(views, { repetitie: viewReview, cazuri: viewCases, recall: viewRecall, explicatii: viewExplain, metoda: viewMethod, __srsRender: srsRender });
