import { db, uid } from './db.js';
import { extractText, splitBlocks, fileKind } from './parse.js';
import { getSettings, saveSettings, MODELS, estimateTokens } from './ai.js';
import * as P from './pipelines.js';
import { S, $, $$, esc, md, fmt, load, sourcesById, chapterById, qOf, latestOutput, toast, runJob, render, chapterSelect, needKey, needKeyToast, download, printHtml, views } from './core.js';
import * as Study from './study.js';
import { looksLikeStudyPage, parseStudyPage } from './importers.js';

const L = P.LETTERS;

// =============== SURSE ===============
function viewSources(v) {
  const kind = S.ui.uploadKind || 'material';
  const mats = S.sources.filter((s) => s.kind === 'material');
  const gr = S.sources.filter((s) => s.kind === 'grile');
  v.innerHTML = `
    <h2>Surse</h2>
    <p class="lead">Încarcă materiale de curs (tratate, cursuri, notițe) și culegeri de grile. Formate: PDF (inclusiv scanat), DOCX, TXT/MD, HTML, imagini (poze cu pagini). Paginile HTML de studiu cu grile și carduri (de ex. „Semiologie Recall”) se importă direct, fără AI, cu note, chei corectate, carduri, cazuri și explicații.</p>
    <div class="grid2">
      <div class="card">
        <div class="row" style="margin-bottom:12px"><strong>Tip sursă:</strong>
          <div class="seg"><button data-k="material" class="${kind === 'material' ? 'on' : ''}">📘 Material de curs</button><button data-k="grile" class="${kind === 'grile' ? 'on' : ''}">📝 Grile</button></div>
        </div>
        <div class="drop" id="drop">Trage fișierele aici sau <u>apasă pentru a alege</u><br><span class="small">poți selecta mai multe deodată</span></div>
        <input type="file" id="file" multiple hidden accept=".pdf,.docx,.txt,.md,.html,.htm,.csv,.png,.jpg,.jpeg,.webp" />
      </div>
      <div class="card">
        <label class="field"><span>Sau lipește text</span><input type="text" id="paste-name" placeholder="Nume sursă (ex: Curs 3 – Cardiologie)"/></label>
        <textarea id="paste-text" placeholder="Lipește aici textul materialului sau al grilelor…"></textarea>
        <div class="row" style="margin-top:8px"><span class="spacer"></span><button id="paste-add">Adaugă ca ${kind === 'material' ? 'material' : 'grile'}</button></div>
      </div>
    </div>
    ${sourceTable('📘 Materiale de curs', mats, 'material')}
    ${sourceTable('📝 Surse de grile', gr, 'grile')}
  `;
  $$('.seg button', v).forEach((b) => (b.onclick = () => { S.ui.uploadKind = b.dataset.k; render(); }));
  const drop = $('#drop'), input = $('#file');
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files], kind); };
  input.onchange = () => { addFiles([...input.files], kind); input.value = ''; };
  $('#paste-add').onclick = async () => {
    const text = $('#paste-text').value.trim();
    if (!text) return toast('Lipește întâi un text.');
    await saveSource($('#paste-name').value.trim() || `Text lipit ${new Date().toLocaleString('ro-RO')}`, kind, text);
    toast('Sursă adăugată.');
    render();
  };
  v.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.del) {
      const s = S.sources.find((x) => x.id === b.dataset.del);
      if (!confirm(`Ștergi sursa „${s.name}"?${s.kind === 'grile' ? ' Grilele importate din ea rămân în bancă.' : ''}`)) return;
      await db.del('sources', s.id);
      S.sources = S.sources.filter((x) => x.id !== s.id);
      render();
    }
    if (b.dataset.extract) extractFrom([S.sources.find((x) => x.id === b.dataset.extract)]);
    if (b.dataset.extractAll) extractFrom(S.sources.filter((x) => x.kind === 'grile'));
    if (b.dataset.toggle) {
      const s = S.sources.find((x) => x.id === b.dataset.toggle);
      s.kind = s.kind === 'material' ? 'grile' : 'material';
      await db.put('sources', s);
      render();
    }
  };
}

function sourceTable(title, list, kind) {
  if (!list.length) return `<div class="card"><strong>${title}</strong><div class="empty">Nicio sursă încă.</div></div>`;
  const total = list.reduce((s, x) => s + x.text.length, 0);
  return `<div class="card">
    <div class="row"><strong>${title}</strong><span class="muted small">${list.length} surse · ${fmt(total)} caractere · ~${fmt(estimateTokens(total))} tokeni</span><span class="spacer"></span>
    ${kind === 'grile' ? `<button class="small" data-extract-all="1" ${S.chapters.length ? '' : 'disabled title="Segmentează întâi materia pe capitole"'}>Extrage grilele din toate</button>` : ''}</div>
    <table class="list"><tr><th>Nume</th><th>Mărime</th><th></th></tr>
    ${list.map((s) => `<tr><td><details><summary>${esc(s.name)}</summary><pre class="small" style="white-space:pre-wrap;max-height:240px;overflow:auto">${esc(s.text.slice(0, 3000))}${s.text.length > 3000 ? '\n…' : ''}</pre></details>
      ${s.kind === 'grile' ? (s.extractedAt ? `<span class="badge">grile extrase: ${s.extractedCount ?? 0}</span>` : '<span class="badge gray">neextrase</span>') : ''}
      ${s.transcribed ? '<span class="badge warn">transcris cu AI</span>' : ''}</td>
      <td class="small muted">${fmt(s.text.length)} car.<br>${s.blocks.length} blocuri</td>
      <td style="white-space:nowrap;text-align:right">
        ${s.kind === 'grile' ? `<button class="small" data-extract="${s.id}" ${S.chapters.length ? '' : 'disabled'}>Extrage grile</button>` : ''}
        <button class="ghost small" data-toggle="${s.id}" title="Mută la cealaltă categorie">⇄</button>
        <button class="danger small" data-del="${s.id}">Șterge</button></td></tr>`).join('')}
    </table>
    ${kind === 'grile' && !S.chapters.length ? '<p class="small muted">Pentru a repartiza grilele pe capitole, segmentează întâi materia (tabul „Capitole").</p>' : ''}
  </div>`;
}

async function saveSource(name, kind, text, extra = {}) {
  const src = { id: uid('src_'), name, kind, text, blocks: splitBlocks(text), addedAt: Date.now(), ...extra };
  await db.put('sources', src);
  S.sources.push(src);
  return src;
}

async function addFiles(files, kind) {
  for (const file of files) {
    runJob(`Încarc „${file.name}"`, async (job) => {
      const fk = fileKind(file);
      let text = '';
      let pages = 1;
      if (fk === 'html') {
        const raw = await file.text();
        if (looksLikeStudyPage(raw)) return importStudyPage(raw, file.name, job);
      }
      if (fk !== 'image') {
        job.status('Extrag textul…');
        const r = await extractText(file, (f) => job.progress(f));
        text = r.text.trim();
        pages = r.pages || 1;
      }
      // Document scanat sau imagine → transcriere cu Claude.
      const scanned = fk === 'image' || (fk === 'pdf' && text.length < pages * 150);
      if (scanned) {
        if (!getSettings().apiKey) throw new Error('Fișierul pare scanat și necesită transcriere AI — adaugă cheia API în Setări.');
        if (file.size > 30 * 1024 * 1024) throw new Error('Fișier scanat prea mare pentru transcriere (max ~30 MB). Împarte-l în părți.');
        job.progress(null);
        job.status('Document scanat — transcriu cu AI…');
        text = (await P.transcribeFile(file, { signal: job.signal, onText: (t) => job.status(`Transcriu cu AI… ${fmt(t.length)} caractere`) })).trim();
      }
      if (!text) throw new Error('Nu am găsit text în fișier.');
      await saveSource(file.name, kind, text, scanned ? { transcribed: true } : {});
      return `Adăugat: ${fmt(text.length)} caractere${scanned ? ' (transcris cu AI)' : ''}.`;
    });
  }
}

// Import direct (fără AI) dintr-o pagină de studiu cu grile/carduri (ex. „Semiologie Recall").
async function importStudyPage(html, fileName, job) {
  job.status('Citesc grilele, cardurile și fișele din pagină…');
  const r = parseStudyPage(html, fileName);
  const seenQ = new Set(S.questions.map((q) => q.importKey || P.normStem(q.stem)));
  const qs = r.questions.filter((q) => !seenQ.has(q.importKey) && !seenQ.has(P.normStem(q.stem)));
  const seenC = new Set(S.cards.map((c) => c.importKey || P.normStem(c.front)));
  const cs = r.cards.filter((c) => !seenC.has(c.importKey) && !seenC.has(P.normStem(c.front)));
  const oldExtras = S.outputs.filter((o) => !o.chapterId && o.importLabel === r.title);
  await db.delMany('outputs', oldExtras.map((o) => o.id));
  S.outputs = S.outputs.filter((o) => !oldExtras.includes(o)).concat(r.extras);
  await db.putMany('outputs', r.extras);
  await db.putMany('questions', qs);
  await db.putMany('cards', cs);
  S.questions.push(...qs);
  S.cards.push(...cs);
  const src = await saveSource(r.title, 'grile', `[Pagină de studiu importată structurat: ${r.questions.length} grile, ${r.cards.length} carduri]`, { structured: true, extractedAt: Date.now(), extractedCount: qs.length });
  // Dacă există deja capitole și cheie API, asociem automat grilele și cardurile noi.
  if (S.chapters.length && getSettings().apiKey) await assignUnassigned(job);
  return `Import „${src.name}": ${qs.length} grile, ${cs.length} carduri, ${r.extras.length} seturi (cazuri/recall/explicații).`;
}

// Asociază la capitole grilele și cardurile fără capitol (sau cu un capitol care nu mai există).
async function assignUnassigned(job) {
  const orphanQ = S.questions.filter((q) => !q.chapterId || !chapterById(q.chapterId));
  const orphanC = S.cards.filter((c) => !c.chapterId || !chapterById(c.chapterId));
  if (orphanQ.length) {
    const map = await P.assignItems(orphanQ, (q) => `${q.importChapter ? `[${q.importChapter}] ` : ''}${q.stem} | ${q.options.join(' | ')}`, S.chapters, { signal: job.signal, onStatus: job.status, label: 'grilele' });
    for (const q of orphanQ) if (map.has(q.id)) q.chapterId = map.get(q.id);
    await db.putMany('questions', orphanQ);
  }
  if (orphanC.length) {
    const map = await P.assignItems(orphanC, (c) => `${c.section ? `[${c.section}] ` : ''}${c.front} → ${c.back}`, S.chapters, { signal: job.signal, onStatus: job.status, label: 'cardurile' });
    for (const c of orphanC) if (map.has(c.id)) c.chapterId = map.get(c.id);
    await db.putMany('cards', orphanC);
  }
  return orphanQ.filter((q) => q.chapterId).length + orphanC.filter((c) => c.chapterId).length;
}

function extractFrom(list) {
  if (needKeyToast()) return;
  runJob(`Extrag grile (${list.length} surse)`, async (job) => {
    let total = 0;
    for (const src of list.filter((x) => !x.structured)) {
      const seen = new Set(S.questions.map((q) => P.normStem(q.stem)));
      const n = await P.extractQuestions(src, S.chapters, {
        signal: job.signal,
        onStatus: job.status,
        onBatch: async (qs) => {
          const fresh = qs.filter((q) => { const k = P.normStem(q.stem); if (seen.has(k)) return false; seen.add(k); return true; });
          await db.putMany('questions', fresh);
          S.questions.push(...fresh);
          total += fresh.length;
        },
      });
      src.extractedAt = Date.now();
      src.extractedCount = n;
      await db.put('sources', src);
    }
    return `Am importat ${total} grile noi (duplicatele au fost ignorate).`;
  });
}

// =============== CAPITOLE ===============
function viewChapters(v) {
  const mats = S.sources.filter((s) => s.kind === 'material');
  const target = getSettings().target;
  const unassigned = S.questions.filter((q) => !q.chapterId || !chapterById(q.chapterId)).length;
  const unassignedC = S.cards.filter((c) => !c.chapterId || !chapterById(c.chapterId)).length;
  const importLabels = [...new Set(S.questions.filter((q) => (!q.chapterId || !chapterById(q.chapterId)) && q.importChapter).map((q) => q.importChapter))];
  v.innerHTML = `
    <h2>Capitole</h2>
    <p class="lead">AI-ul citește toate materialele de curs și împarte materia pe capitole. Fiecare capitol e legat de pasajele din surse pe care se bazează grilele, sintezele și podcasturile.</p>
    <div class="card">
      <label class="field"><span>Indicații pentru segmentare (opțional)</span>
      <input type="text" id="seg-hint" placeholder="ex: urmează structura cursurilor 1–14; separă patologia de semiologie…" value="${esc(S.ui.segHint || '')}"/></label>
      <div class="row">
        <button id="seg" ${mats.length ? '' : 'disabled'}>${S.chapters.length ? 'Resegmentează materia' : 'Segmentează materia pe capitole'}</button>
        <span class="muted small">${mats.length} materiale de curs${mats.length ? '' : ' — adaugă întâi surse în tabul „Surse"'}</span>
        <span class="spacer"></span>
        ${(unassigned || unassignedC) && S.chapters.length ? `<button class="ghost" id="reassign">Asociază ${unassigned} grile și ${unassignedC} carduri fără capitol</button>` : ''}
      </div>
      ${importLabels.length && !mats.length ? `<p class="small muted" style="margin-top:12px">Ai grile importate cu capitole proprii (${importLabels.map(esc).join(', ')}). Poți crea capitolele direct din ele, fără material de curs; AI-ul va folosi atunci grilele și cardurile drept programă. Când încarci cursul, segmentează și totul se reasociază.</p>
        <button class="ghost" id="from-import">Creează ${importLabels.length} capitole din import</button>` : ''}
    </div>
    ${S.chapters.length ? S.chapters.map((c, i) => {
      const qs = qOf(c.id);
      const chars = P.chapterText(c, sourcesById()).length;
      const pct = Math.min(100, (qs.length / target) * 100);
      return `<div class="chapter">
        <div class="row"><h3>${i + 1}. ${esc(c.title)}</h3><span class="spacer"></span>
          <button class="small" data-prep="${c.id}" title="Verifică cheile, completează grilele și cardurile, apoi generează cazuri, recall, explicații, sinteză și podcast">⚡ Pregătește tot</button>
          <button class="ghost small" data-ren="${c.id}">Redenumește</button>
          ${i < S.chapters.length - 1 ? `<button class="ghost small" data-merge="${c.id}" title="Unește cu capitolul următor">⤓ Unește</button>` : ''}
          <button class="danger small" data-delch="${c.id}">Șterge</button></div>
        <div class="muted small">${esc(c.summary)}</div>
        <div class="topics">${(c.topics || []).map((t) => `<span class="badge gray">${esc(t)}</span>`).join('')}</div>
        <div class="row small muted" style="margin-top:8px"><span>${chars ? `${fmt(chars)} caractere din ${c.ranges.length} interval(e)` : 'fără material de curs'}</span><span class="spacer"></span><span>${S.cards.filter((x) => x.chapterId === c.id).length} carduri · ${qs.length}/${target} grile</span></div>
        <div class="progress ${pct >= 100 ? 'full' : ''}"><div style="width:${pct}%"></div></div>
        <details style="margin-top:8px"><summary class="small">Vezi textul capitolului</summary><pre class="small" style="white-space:pre-wrap;max-height:300px;overflow:auto">${esc(P.chapterText(c, sourcesById(), 6000))}…</pre></details>
      </div>`;
    }).join('') : '<div class="card empty">Niciun capitol încă.</div>'}
  `;
  $('#seg-hint').oninput = (e) => (S.ui.segHint = e.target.value);
  $('#seg').onclick = () => {
    if (needKeyToast()) return;
    if (S.chapters.length && !confirm('Resegmentarea înlocuiește capitolele actuale. Grilele vor fi reasociate automat la noile capitole. Continui?')) return;
    runJob('Segmentez materia', async (job) => {
      const chapters = await P.segmentSources(mats, { signal: job.signal, onStatus: job.status, hint: S.ui.segHint });
      if (!chapters.length) throw new Error('Nu am obținut niciun capitol.');
      const old = S.chapters;
      await db.delMany('chapters', old.map((c) => c.id));
      await db.putMany('chapters', chapters);
      S.chapters = chapters;
      // Conținutul generat pe capitolele vechi nu mai corespunde → îl eliminăm (importurile rămân).
      const stale = S.outputs.filter((o) => o.chapterId);
      await db.delMany('outputs', stale.map((o) => o.id));
      S.outputs = S.outputs.filter((o) => !o.chapterId);
      const n = await assignUnassigned(job);
      return `${chapters.length} capitole create${n ? `, ${n} grile/carduri asociate` : ''}.`;
    });
  };
  const re = $('#reassign');
  if (re) re.onclick = () => {
    if (needKeyToast()) return;
    runJob('Asociez la capitole', async (job) => `${await assignUnassigned(job)} elemente asociate.`);
  };
  const fi = $('#from-import');
  if (fi) fi.onclick = async () => {
    const created = importLabels.map((t, i) => ({ id: uid('ch_'), order: S.chapters.length + i, title: t, summary: 'Capitol creat din grilele importate (fără material de curs).', topics: [], ranges: [] }));
    for (const q of S.questions) { const ch = created.find((c) => c.title === q.importChapter); if (ch && (!q.chapterId || !chapterById(q.chapterId))) q.chapterId = ch.id; }
    await db.putMany('chapters', created);
    await db.putMany('questions', S.questions);
    S.chapters.push(...created);
    toast(`${created.length} capitole create.${S.cards.some((c) => !c.chapterId) ? ' Cardurile rămân la „Fără capitol" până le asociezi cu AI.' : ''}`, 6000);
    render();
  };
  v.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.prep) prepareChapter(b.dataset.prep);
    if (b.dataset.ren) {
      const c = chapterById(b.dataset.ren);
      const t = prompt('Titlu nou:', c.title);
      if (t) { c.title = t.trim(); await db.put('chapters', c); render(); }
    }
    if (b.dataset.merge) {
      const i = S.chapters.findIndex((c) => c.id === b.dataset.merge);
      const a = S.chapters[i], nx = S.chapters[i + 1];
      if (!confirm(`Unești „${a.title}" cu „${nx.title}"?`)) return;
      a.ranges = [...a.ranges, ...nx.ranges];
      a.topics = [...new Set([...(a.topics || []), ...(nx.topics || [])])];
      a.summary = `${a.summary} ${nx.summary}`;
      const moved = S.questions.filter((q) => q.chapterId === nx.id).map((q) => ((q.chapterId = a.id), q));
      await db.putMany('questions', moved);
      const movedC = S.cards.filter((c) => c.chapterId === nx.id).map((c) => ((c.chapterId = a.id), c));
      await db.putMany('cards', movedC);
      const movedO = S.outputs.filter((o) => o.chapterId === nx.id).map((o) => ((o.chapterId = a.id), o));
      await db.putMany('outputs', movedO);
      await db.put('chapters', a);
      await db.del('chapters', nx.id);
      S.chapters.splice(i + 1, 1);
      render();
    }
    if (b.dataset.delch) {
      const c = chapterById(b.dataset.delch);
      const qs = qOf(c.id);
      if (!confirm(`Ștergi capitolul „${c.title}"?${qs.length ? ` Cele ${qs.length} grile rămân în bancă, fără capitol.` : ''}`)) return;
      for (const q of qs) q.chapterId = null;
      await db.putMany('questions', qs);
      const cs = S.cards.filter((x) => x.chapterId === c.id);
      for (const x of cs) x.chapterId = null;
      await db.putMany('cards', cs);
      await db.del('chapters', c.id);
      S.chapters = S.chapters.filter((x) => x.id !== c.id);
      S.chapters.forEach((x, k) => (x.order = k));
      await db.putMany('chapters', S.chapters);
      render();
    }
  };
}

// =============== BANCA DE GRILE ===============
function viewBank(v) {
  const target = getSettings().target;
  const f = (S.ui.bank ||= { chapter: S.chapters[0]?.id || '__none', origin: 'all', q: '', page: 0 });
  let list = f.chapter === '__none' ? S.questions.filter((q) => !q.chapterId || !chapterById(q.chapterId)) : qOf(f.chapter);
  if (f.origin === 'noted') list = list.filter((q) => q.note || q.keyCorrected);
  else if (f.origin !== 'all') list = list.filter((q) => q.origin === f.origin);
  if (f.q) { const k = P.normStem(f.q); list = list.filter((q) => P.normStem(q.stem + ' ' + q.options.join(' ')).includes(k)); }
  const PAGE = 40;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  f.page = Math.min(f.page, pages - 1);
  const unassigned = S.questions.filter((q) => !q.chapterId || !chapterById(q.chapterId)).length;

  v.innerHTML = `
    <h2>Banca de grile</h2>
    <p class="lead">Grilele importate din surse și cele generate de AI, pe capitole. Ținta: ${target} grile/capitol (modificabilă în Setări).</p>
    <div class="card">
      <div class="row" style="margin-bottom:10px"><strong>Acoperire pe capitole</strong><span class="spacer"></span>
        <button id="fill-all" ${S.chapters.length ? '' : 'disabled'}>Completează toate capitolele la ${target}</button></div>
      ${S.chapters.length ? `<table class="list"><tr><th>Capitol</th><th>Importate</th><th>Generate</th><th style="width:30%">Progres</th><th></th></tr>
      ${S.chapters.map((c, i) => {
        const qs = qOf(c.id); const imp = qs.filter((q) => q.origin === 'importat').length;
        const pct = Math.min(100, (qs.length / target) * 100);
        return `<tr><td>${i + 1}. ${esc(c.title)}</td><td>${imp}</td><td>${qs.length - imp}</td>
        <td><div class="small muted">${qs.length}/${target}</div><div class="progress ${pct >= 100 ? 'full' : ''}"><div style="width:${pct}%"></div></div></td>
        <td style="text-align:right;white-space:nowrap"><button class="ghost small" data-verify="${c.id}" ${qs.length && P.chapterText(c, sourcesById()).trim() ? '' : 'disabled title="Necesită material de curs"'}>Verifică cheile</button> <button class="small" data-fill="${c.id}" ${qs.length >= target ? 'disabled' : ''}>Completează</button></td></tr>`;
      }).join('')}</table>` : '<div class="empty">Segmentează întâi materia pe capitole.</div>'}
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:12px">
        <div style="min-width:240px;flex:2"><select id="f-ch">${S.chapters.map((c, i) => `<option value="${c.id}" ${f.chapter === c.id ? 'selected' : ''}>${i + 1}. ${esc(c.title)}</option>`).join('')}<option value="__none" ${f.chapter === '__none' ? 'selected' : ''}>— Fără capitol (${unassigned})</option></select></div>
        <div style="min-width:140px;flex:1"><select id="f-or"><option value="all">Toate</option><option value="importat" ${f.origin === 'importat' ? 'selected' : ''}>Importate</option><option value="generat" ${f.origin === 'generat' ? 'selected' : ''}>Generate AI</option><option value="noted" ${f.origin === 'noted' ? 'selected' : ''}>Cu notă / cheie corectată</option></select></div>
        <div style="min-width:180px;flex:2"><input type="text" id="f-q" placeholder="Caută…" value="${esc(f.q)}"/></div>
        <button class="ghost" id="add-q">+ Grilă manuală</button>
      </div>
      <div class="muted small" style="margin-bottom:8px">${list.length} grile</div>
      ${list.slice(f.page * PAGE, (f.page + 1) * PAGE).map((q, i) => qCard(q, f.page * PAGE + i)).join('') || '<div class="empty">Nicio grilă.</div>'}
      ${pages > 1 ? `<div class="row"><button class="ghost small" id="pg-prev" ${f.page ? '' : 'disabled'}>← Anterioare</button><span class="muted small">Pagina ${f.page + 1}/${pages}</span><button class="ghost small" id="pg-next" ${f.page < pages - 1 ? '' : 'disabled'}>Următoare →</button></div>` : ''}
    </div>`;

  $('#f-ch').onchange = (e) => { f.chapter = e.target.value; f.page = 0; render(); };
  $('#f-or').onchange = (e) => { f.origin = e.target.value; f.page = 0; render(); };
  $('#f-q').onchange = (e) => { f.q = e.target.value; f.page = 0; render(); };
  $('#pg-prev') && ($('#pg-prev').onclick = () => { f.page--; render(); });
  $('#pg-next') && ($('#pg-next').onclick = () => { f.page++; render(); });
  $('#fill-all').onclick = () => fillChapters(S.chapters.map((c) => c.id));
  $('#add-q').onclick = () => editQuestion(null, f.chapter === '__none' ? null : f.chapter);
  v.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fill) fillChapters([b.dataset.fill]);
    if (b.dataset.verify) verifyChapter(b.dataset.verify);
    if (b.dataset.delq) {
      if (!confirm('Ștergi grila?')) return;
      await db.del('questions', b.dataset.delq);
      S.questions = S.questions.filter((q) => q.id !== b.dataset.delq);
      render();
    }
    if (b.dataset.editq) editQuestion(S.questions.find((q) => q.id === b.dataset.editq));
  };
}

function qCard(q, i, picked) {
  const acc = q.stats?.seen ? ` · ${Math.round((q.stats.right / q.stats.seen) * 100)}% corect din ${q.stats.seen}` : '';
  return `<div class="q">
    <div class="row small" style="margin-bottom:4px"><span class="badge ${q.origin === 'generat' ? '' : 'gray'}">${q.origin === 'generat' ? 'generată AI' : 'importată'}</span>
      <span class="badge gray">${q.correct.length > 1 ? 'CM' : 'CS'}</span>${q.answerSource === 'dedus' ? '<span class="badge warn" title="Răspunsul nu era în sursă; a fost dedus de AI — verifică">răspuns dedus</span>' : ''}
      ${q.verifiedAt && !q.keyCorrected ? '<span class="badge" title="Cheia a fost verificată față de curs">cheie verificată</span>' : ''}
      ${q.topic ? `<span class="muted">${esc(q.topic)}</span>` : ''}<span class="muted">${acc}</span><span class="spacer"></span>
      <button class="ghost small" data-editq="${q.id}">Editează</button><button class="danger small" data-delq="${q.id}">Șterge</button></div>
    <div class="stem">${i + 1}. ${esc(q.stem)}</div>
    <ol>${q.options.map((o, k) => `<li class="${q.correct.includes(k) ? 'right' : picked?.includes(k) ? 'picked' : ''}">${L[k]}. ${esc(o)}${q.correct.includes(k) ? ' ✓' : picked?.includes(k) ? ' ✗ (ales de tine)' : ''}</li>`).join('')}</ol>
    ${q.explanation ? `<div class="expl">💡 ${esc(q.explanation)}</div>` : ''}${noteHtml(q)}
    ${q.sourceName ? `<div class="expl small">Sursa: ${esc(q.sourceName)}</div>` : ''}
  </div>`;
}

async function editQuestion(q, chapterId) {
  const isNew = !q;
  q = q ? { ...q } : { id: uid('q_'), stem: '', options: ['', '', '', '', ''], correct: [], chapterId, origin: 'importat', sourceName: 'manual', explanation: '', topic: '', stats: { seen: 0, right: 0 }, createdAt: Date.now() };
  const v = $('#view');
  v.innerHTML = `<h2>${isNew ? 'Grilă nouă' : 'Editează grila'}</h2><div class="card">
    <label class="field"><span>Capitol</span>${chapterSelect('e-ch', q.chapterId)}</label>
    <label class="field"><span>Enunț</span><textarea id="e-stem" style="min-height:70px">${esc(q.stem)}</textarea></label>
    ${q.options.concat(Array(5).fill('')).slice(0, 5).map((o, k) => `<div class="row" style="margin-bottom:8px"><label><input type="checkbox" class="e-c" data-k="${k}" ${q.correct.includes(k) ? 'checked' : ''}/> ${L[k]}</label><div style="flex:1"><input type="text" class="e-o" value="${esc(o)}"/></div></div>`).join('')}
    <label class="field"><span>Explicație</span><textarea id="e-ex" style="min-height:60px">${esc(q.explanation)}</textarea></label>
    <div class="row"><button id="e-save">Salvează</button><button class="ghost" id="e-cancel">Renunță</button></div></div>`;
  $('#e-cancel').onclick = render;
  $('#e-save').onclick = async () => {
    const opts = $$('.e-o').map((i) => i.value.trim());
    const correct = $$('.e-c').filter((c) => c.checked).map((c) => +c.dataset.k);
    const keep = opts.map((o, k) => [o, k]).filter(([o]) => o);
    q.options = keep.map(([o]) => o);
    q.correct = keep.map(([, k], idx) => (correct.includes(k) ? idx : -1)).filter((x) => x >= 0);
    q.stem = $('#e-stem').value.trim();
    q.explanation = $('#e-ex').value.trim();
    q.chapterId = $('#e-ch').value || null;
    q.type = q.correct.length > 1 ? 'CM' : 'CS';
    if (!q.stem || q.options.length < 2 || !q.correct.length) return toast('Completează enunțul, minim 2 variante și cel puțin un răspuns corect.');
    if (q.answerSource === 'dedus') q.answerSource = 'cheie';
    await db.put('questions', q);
    S.questions = S.questions.filter((x) => x.id !== q.id).concat(q);
    render();
  };
}

function fillChapters(ids) {
  if (needKeyToast()) return;
  const { target, batch } = getSettings();
  runJob(ids.length > 1 ? `Completez ${ids.length} capitole la ${target} grile` : `Generez grile: ${chapterById(ids[0]).title}`, async (job) => {
    let made = 0;
    for (let ci = 0; ci < ids.length; ci++) {
      const ch = chapterById(ids[ci]);
      if (!ch) continue;
      let fails = 0;
      while (qOf(ch.id).length < target && fails < 2) {
        if (job.signal.aborted) throw new Error('Anulat');
        const have = qOf(ch.id);
        const n = Math.min(batch, target - have.length);
        const prefix = `${ids.length > 1 ? `[${ci + 1}/${ids.length}] ` : ''}${ch.title}: ${have.length}/${target}`;
        job.status(`${prefix} — generez ${n} grile…`);
        job.progress(have.length / target);
        const fresh = await P.generateQuestions(Study.withRef(ch), sourcesById(), have, n, { signal: job.signal, onStatus: (t) => job.status(`${prefix} — generez ${n} grile ${t}`) });
        if (!fresh.length) fails++;
        await db.putMany('questions', fresh);
        S.questions.push(...fresh);
        made += fresh.length;
        if (S.tab === 'grile' || S.tab === 'capitole') render();
      }
    }
    return `Am generat ${made} grile noi.`;
  });
}

// Verifică cheile grilelor unui capitol față de curs („cursul are prioritate").
function verifyChapter(id, jobApi) {
  const run = async (job) => {
    const ch = chapterById(id);
    const qs = qOf(id).filter((q) => !q.verifiedAt && q.origin !== 'generat');
    if (!qs.length) return 'Toate grilele importate din capitol sunt deja verificate.';
    const res = await P.verifyKeys(ch, sourcesById(), qs, { signal: job.signal, onStatus: job.status });
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    let changed = 0;
    for (const q of qs) {
      const r = byId[q.id];
      if (!r) continue;
      q.verifiedAt = Date.now();
      if (r.changed) { q.correct = r.correct; q.note = r.note; q.keyCorrected = true; q.type = q.correct.length > 1 ? 'CM' : 'CS'; changed++; }
    }
    await db.putMany('questions', qs);
    return `${qs.length} grile verificate; ${changed} chei corectate conform cursului.`;
  };
  if (jobApi) return run(jobApi);
  if (needKeyToast()) return;
  runJob(`Verific cheile: ${chapterById(id).title}`, run);
}

// Rulează tot pachetul de studiu pentru un capitol.
function prepareChapter(id) {
  if (needKeyToast()) return;
  const ch0 = chapterById(id);
  if (!confirm(`Pregătesc tot pentru „${ch0.title}": verificare chei, grile până la ${getSettings().target}, carduri, cazuri, recall, explicații, sinteză și podcast. Durează câteva minute și consumă credite API. Continui?`)) return;
  runJob(`Pregătesc: ${ch0.title}`, async (job) => {
    const ch = () => Study.withRef(chapterById(id));
    const { target, batch, cardTarget, podcastMinutes } = getSettings();
    const hasMaterial = P.chapterText(chapterById(id), sourcesById()).trim().length > 0;
    const steps = ['chei', 'grile', 'carduri', 'cazuri', 'recall', 'explicatii', 'sinteza', 'podcast'];
    const step = (k, t) => { job.progress(steps.indexOf(k) / steps.length); job.status(t); };
    if (hasMaterial && qOf(id).length) { step('chei', 'Verific cheile…'); await verifyChapter(id, { ...job, status: (t) => job.status('Chei: ' + t) }); }
    let fails = 0;
    while (qOf(id).length < target && fails < 2) {
      const have = qOf(id);
      step('grile', `Grile: ${have.length}/${target}…`);
      const fresh = await P.generateQuestions(ch(), sourcesById(), have, Math.min(batch, target - have.length), { signal: job.signal });
      if (!fresh.length) fails++;
      await db.putMany('questions', fresh); S.questions.push(...fresh);
    }
    fails = 0;
    while (S.cards.filter((c) => c.chapterId === id).length < cardTarget && fails < 2) {
      const have = S.cards.filter((c) => c.chapterId === id);
      step('carduri', `Carduri: ${have.length}/${cardTarget}…`);
      const fresh = await P.generateCards(ch(), sourcesById(), have, Math.min(40, cardTarget - have.length), { signal: job.signal });
      if (!fresh.length) fails++;
      await db.putMany('cards', fresh); S.cards.push(...fresh);
    }
    const save = async (type, content) => { const o = { id: uid('o_'), chapterId: id, type, content, createdAt: Date.now() }; await db.put('outputs', o); S.outputs.push(o); };
    if (!latestOutput(id, 'cazuri')) { step('cazuri', 'Cazuri clinice…'); await save('cazuri', await P.generateCases(ch(), sourcesById(), [], 10, { signal: job.signal })); }
    if (!latestOutput(id, 'recall')) { step('recall', 'Recall & contraste…'); await save('recall', await P.generateRecall(ch(), sourcesById(), { signal: job.signal })); }
    if (!latestOutput(id, 'explicatii')) { step('explicatii', 'Explicații…'); await save('explicatii', await P.generateExplanations(ch(), sourcesById(), { signal: job.signal })); }
    if (!latestOutput(id, 'sinteza')) { step('sinteza', 'Sinteză…'); await save('sinteza', await P.synthesis(ch(), sourcesById(), qOf(id), { signal: job.signal })); }
    if (!latestOutput(id, 'podcast')) { step('podcast', 'Podcast…'); await save('podcast', await P.podcast(ch(), sourcesById(), podcastMinutes, { signal: job.signal })); }
    return `Capitolul e pregătit: ${qOf(id).length} grile, ${S.cards.filter((c) => c.chapterId === id).length} carduri, cazuri, recall, explicații, sinteză și podcast.`;
  });
}

// =============== TEST (exersare / simulare de examen) ===============
function noteHtml(q) {
  if (!q.note && !q.keyCorrected) return '';
  return `<div class="note">${q.keyCorrected ? '<span class="pill p-learn">CHEIE CORECTATĂ</span> ' : ''}${esc(q.note || '')}</div>`;
}

function viewQuiz(v) {
  const cfg = (S.ui.quizCfg ||= { chapter: S.chapters[0]?.id || '__all', count: 30, filter: 'all', type: '', source: '', fixed: false });
  const qz = S.ui.quiz;
  if (qz && !qz.active && qz.done) return quizSummary(v, qz);
  const sources = [...new Set(S.questions.map((q) => q.sourceName || (q.origin === 'generat' ? 'Generate AI' : '')).filter(Boolean))];
  v.innerHTML = `<h2>Test</h2><p class="lead">Exersează cu feedback după fiecare grilă sau fă o simulare de examen, cu corectarea la final. Rezultatele se salvează, așa că poți relua doar greșelile.</p>
    <div class="card">
      <div class="grid2">
        <label class="field"><span>Capitol</span>${chapterSelect('qz-ch', cfg.chapter, { all: true })}</label>
        <label class="field"><span>Sursa</span><select id="qz-src"><option value="">Toate sursele</option>${sources.map((x) => `<option ${cfg.source === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="field"><span>Tip</span><select id="qz-type"><option value="">Simplu + multiplu</option><option value="s" ${cfg.type === 's' ? 'selected' : ''}>Complement simplu</option><option value="m" ${cfg.type === 'm' ? 'selected' : ''}>Complement multiplu</option></select></label>
        <label class="field"><span>Ce grile</span><select id="qz-f">
          ${[['all', 'Toate'], ['unseen', 'Nerezolvate încă'], ['wrong', 'Doar greșelile mele'], ['importat', 'Doar importate'], ['generat', 'Doar generate AI']].map(([k, t]) => `<option value="${k}" ${cfg.filter === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>Număr de grile</span><input type="number" id="qz-n" min="1" max="1000" value="${cfg.count}"/></label>
        <label class="field" style="align-self:end"><input type="checkbox" id="qz-fixed" ${cfg.fixed ? 'checked' : ''}/> Doar grilele cu notă sau cheie corectată</label>
      </div>
      <div class="row"><button id="qz-practice">Exersare (feedback după fiecare)</button><button class="ghost" id="qz-exam">Simulare de examen</button><span class="muted small" id="qz-av"></span></div>
    </div>
    <div class="card" id="qz-stats"></div>`;
  const pool = () => {
    let p = cfg.chapter === '__all' ? S.questions.slice() : qOf(cfg.chapter);
    if (cfg.source) p = p.filter((q) => (q.sourceName || (q.origin === 'generat' ? 'Generate AI' : '')) === cfg.source);
    if (cfg.type) p = p.filter((q) => (cfg.type === 's' ? q.correct.length === 1 : q.correct.length > 1));
    if (cfg.filter === 'unseen') p = p.filter((q) => !q.stats?.seen);
    if (cfg.filter === 'wrong') p = p.filter((q) => q.stats?.seen && q.stats.lastWrong);
    if (cfg.filter === 'importat' || cfg.filter === 'generat') p = p.filter((q) => q.origin === cfg.filter);
    if (cfg.fixed) p = p.filter((q) => q.note || q.keyCorrected);
    return p;
  };
  const upd = () => {
    const p = pool();
    $('#qz-av').textContent = `${p.length} grile disponibile`;
    const seen = p.filter((q) => q.stats?.seen), right = seen.filter((q) => !q.stats.lastWrong).length;
    $('#qz-stats').innerHTML = `<div class="stats"><div><b>${p.length}</b><span>în selecție</span></div><div><b>${seen.length}</b><span>rezolvate</span></div>
      <div><b>${seen.length ? Math.round((right / seen.length) * 100) : 0}%</b><span>corecte la ultima încercare</span></div><div><b>${seen.length - right}</b><span>greșeli de reluat</span></div></div>`;
  };
  const bind = (id, key, fn = (e) => e.target.value) => ($(id).onchange = (e) => { cfg[key] = fn(e); upd(); });
  bind('#qz-ch', 'chapter'); bind('#qz-src', 'source'); bind('#qz-type', 'type'); bind('#qz-f', 'filter');
  bind('#qz-n', 'count', (e) => Math.max(1, +e.target.value || 30)); bind('#qz-fixed', 'fixed', (e) => e.target.checked);
  upd();
  const start = (mode) => {
    const p = pool().sort(() => Math.random() - 0.5).slice(0, cfg.count);
    if (!p.length) return toast('Nu există grile pentru această selecție.');
    S.ui.quiz = { active: true, mode, list: p, i: 0, sel: new Set(), answered: false, results: [], answers: p.map(() => new Set()) };
    quizStep();
  };
  $('#qz-practice').onclick = () => start('practice');
  $('#qz-exam').onclick = () => start('exam');
}

function quizStep() {
  const qz = S.ui.quiz;
  const q = qz.list[qz.i];
  const v = $('#view');
  const exam = qz.mode === 'exam';
  if (exam) qz.sel = qz.answers[qz.i];
  // Amestecăm variantele, păstrând maparea către indicii originali.
  qz.order ||= {};
  const order = (qz.order[q.id] ||= q.options.map((_, k) => k).sort(() => Math.random() - 0.5));
  const ok = qz.answered && sameSet(qz.sel, new Set(q.correct));
  const answeredCount = exam ? qz.answers.filter((a) => a.size).length : qz.results.length;
  v.innerHTML = `<div class="row" style="margin-bottom:10px"><h2 style="margin:0">${exam ? 'Simulare' : 'Grila'} ${qz.i + 1}/${qz.list.length}</h2><span class="badge gray">${q.correct.length > 1 ? 'complement multiplu' : 'complement simplu'}</span><span class="spacer"></span>
      <span class="muted small">${exam ? `Răspunse: ${answeredCount}/${qz.list.length}` : `Corecte: ${qz.results.filter((r) => r.ok).length}/${qz.results.length}`}</span><button class="ghost small" id="qz-stop">${exam ? 'Renunță' : 'Termină'}</button></div>
    <div class="progress" style="margin-bottom:14px"><div style="width:${(qz.i / qz.list.length) * 100}%"></div></div>
    <div class="card"><div class="muted small">${esc(chapterById(q.chapterId)?.title || q.importChapter || '')}${q.sourceName ? ' · ' + esc(q.sourceName) : ''}</div>
      <div style="font-weight:600;font-size:1.05rem;margin:6px 0 14px">${esc(q.stem)}</div>
      ${order.map((k, pos) => {
        let cls = qz.sel.has(k) ? 'sel' : '';
        if (qz.answered) cls = q.correct.includes(k) ? 'good' : qz.sel.has(k) ? 'bad' : '';
        return `<div class="quiz-opt ${cls}" data-k="${k}"><span class="letter">${L[pos]}.</span><span>${esc(q.options[k])}</span></div>`;
      }).join('')}
      ${qz.answered ? `<div class="feedback ${ok ? 'good' : 'bad'}"><strong>${ok ? '✓ Corect!' : '✗ Greșit.'}</strong> Răspuns corect: ${order.map((k, pos) => (q.correct.includes(k) ? L[pos] : null)).filter(Boolean).join(', ')}
        ${q.explanation ? `<div style="margin-top:6px">${esc(q.explanation)}</div>` : ''}</div>${noteHtml(q)}` : ''}
      <div class="row" style="margin-top:14px">
        ${exam ? `<button class="ghost" id="qz-prev" ${qz.i ? '' : 'disabled'}>← Înapoi</button><span class="spacer"></span>
          <button id="qz-next">${qz.i === qz.list.length - 1 ? 'Termină examenul' : 'Următoarea →'}</button>`
        : `<span class="spacer"></span>${qz.answered ? `<button id="qz-next">${qz.i + 1 < qz.list.length ? 'Următoarea →' : 'Vezi rezultatul'}</button>` : `<button id="qz-check" ${qz.sel.size ? '' : 'disabled'}>Verifică</button>`}`}</div>
    </div>`;
  $$('.quiz-opt', v).forEach((el) => (el.onclick = () => {
    if (qz.answered) return;
    const k = +el.dataset.k;
    qz.sel.has(k) ? qz.sel.delete(k) : qz.sel.add(k);
    quizStep();
  }));
  $('#qz-stop').onclick = () => {
    if (exam) { if (!confirm('Renunți la simulare? Răspunsurile nu se salvează.')) return; S.ui.quiz = null; render(); return; }
    finishQuiz();
  };
  const check = $('#qz-check');
  if (check) check.onclick = async () => {
    qz.answered = true;
    const good = sameSet(qz.sel, new Set(q.correct));
    qz.results.push({ q, ok: good, picked: [...qz.sel] });
    await recordAnswer(q, good);
    quizStep();
  };
  const prev = $('#qz-prev');
  if (prev) prev.onclick = () => { qz.i--; quizStep(); };
  $('#qz-next').onclick = async () => {
    if (exam) {
      if (qz.i < qz.list.length - 1) { qz.i++; return quizStep(); }
      const empty = qz.answers.filter((a) => !a.size).length;
      if (empty && !confirm(`Ai ${empty} grile fără răspuns. Termini examenul?`)) return;
      for (let i = 0; i < qz.list.length; i++) {
        const good = sameSet(qz.answers[i], new Set(qz.list[i].correct));
        qz.results.push({ q: qz.list[i], ok: good, picked: [...qz.answers[i]] });
        await recordAnswer(qz.list[i], good);
      }
      return finishQuiz();
    }
    qz.i++;
    qz.sel = new Set();
    qz.answered = false;
    qz.i < qz.list.length ? quizStep() : finishQuiz();
  };
}
async function recordAnswer(q, good) {
  q.stats = { seen: (q.stats?.seen || 0) + 1, right: (q.stats?.right || 0) + (good ? 1 : 0), lastWrong: !good };
  await db.put('questions', q);
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
function finishQuiz() {
  S.ui.quiz.active = false;
  S.ui.quiz.done = true;
  render();
}
function quizSummary(v, qz) {
  const right = qz.results.filter((r) => r.ok).length;
  const pct = qz.results.length ? Math.round((right / qz.results.length) * 100) : 0;
  const wrong = qz.results.filter((r) => !r.ok);
  const byCh = {};
  for (const r of qz.results) { const t = chapterById(r.q.chapterId)?.title || r.q.importChapter || 'Fără capitol'; (byCh[t] ||= [0, 0])[0]++; if (r.ok) byCh[t][1]++; }
  v.innerHTML = `<h2>Rezultat${qz.mode === 'exam' ? ' — simulare de examen' : ''}</h2><div class="card"><div style="font-size:2rem;font-weight:700">${right}/${qz.results.length} · ${pct}%</div>
    ${Object.keys(byCh).length > 1 ? `<table class="list" style="margin-top:10px">${Object.entries(byCh).map(([t, [n, r]]) => `<tr><td>${esc(t)}</td><td>${r}/${n}</td><td>${Math.round((r / n) * 100)}%</td></tr>`).join('')}</table>` : ''}
    <div class="row" style="margin-top:10px"><button id="qz-new">Test nou</button>
    ${wrong.length ? '<button class="ghost" id="qz-retry">Reia grilele greșite</button>' : ''}</div></div>
    ${wrong.length ? `<h3>Revizuiește cele ${wrong.length} greșite</h3>` + wrong.map((r, i) => qCard(r.q, i, r.picked)).join('') : ''}`;
  $('#qz-new').onclick = () => { S.ui.quiz = null; render(); };
  const rt = $('#qz-retry');
  if (rt) rt.onclick = () => {
    const list = wrong.map((r) => r.q);
    S.ui.quiz = { active: true, mode: 'practice', list, i: 0, sel: new Set(), answered: false, results: [], answers: list.map(() => new Set()) };
    quizStep();
  };
  $$('[data-delq],[data-editq]', v).forEach((b) => b.remove());
}

// =============== SINTEZE ===============
function viewSynth(v) {
  if (!S.chapters.length) { v.innerHTML = '<h2>Sinteze</h2><div class="card empty">Segmentează întâi materia pe capitole.</div>'; return; }
  needKey(v);
  const cur = (S.ui.synthCh && chapterById(S.ui.synthCh)) ? S.ui.synthCh : S.chapters[0].id;
  S.ui.synthCh = cur;
  const out = latestOutput(cur, 'sinteza');
  v.insertAdjacentHTML('beforeend', `<h2>Sinteze pentru examen</h2>
    <p class="lead">Sinteză completă pe capitol: noțiuni-cheie, clasificări, tabele comparative, cifre de reținut, mnemotehnici și capcanele frecvente la grile.</p>
    <div class="card"><div class="row">
      <div style="flex:1;min-width:220px">${chapterSelect('sy-ch', cur)}</div>
      <button id="sy-gen">${out ? 'Regenerează' : 'Generează sinteza'}</button>
      <button class="ghost" id="sy-all">Generează pentru toate capitolele lipsă</button>
    </div>
    <div class="small muted" style="margin-top:8px">${S.chapters.map((c, i) => `${latestOutput(c.id, 'sinteza') ? '✅' : '⬜'} ${i + 1}`).join(' · ')}</div></div>
    <div class="card"><div class="row" style="margin-bottom:6px">${out ? `<span class="muted small">Generată: ${new Date(out.createdAt).toLocaleString('ro-RO')}</span><span class="spacer"></span><button class="ghost small" id="sy-dl">Descarcă .md</button><button class="ghost small" id="sy-print">Printează / PDF</button>` : ''}</div>
      <div class="md" id="sy-body">${out ? md(out.content) : '<div class="empty">Nicio sinteză pentru acest capitol încă.</div>'}</div></div>`);
  $('#sy-ch').onchange = (e) => { S.ui.synthCh = e.target.value; render(); };
  $('#sy-gen').onclick = () => genSynth([cur]);
  $('#sy-all').onclick = () => genSynth(S.chapters.filter((c) => !latestOutput(c.id, 'sinteza')).map((c) => c.id));
  if (out) {
    $('#sy-dl').onclick = () => download(`Sinteza - ${chapterById(cur).title}.md`, out.content, 'text/markdown');
    $('#sy-print').onclick = () => printHtml(chapterById(cur).title, md(out.content));
  }
}

function genSynth(ids) {
  if (needKeyToast()) return;
  if (!ids.length) return toast('Toate capitolele au deja sinteză.');
  runJob(ids.length > 1 ? `Sinteze pentru ${ids.length} capitole` : `Sinteză: ${chapterById(ids[0]).title}`, async (job) => {
    for (let i = 0; i < ids.length; i++) {
      const ch = chapterById(ids[i]);
      job.progress(i / ids.length);
      job.status(`${ch.title}: scriu…`);
      const content = await P.synthesis(Study.withRef(ch), sourcesById(), qOf(ch.id), {
        signal: job.signal,
        onText: (t) => {
          job.status(`${ch.title}: ${fmt(t.length)} caractere`);
          if (S.tab === 'sinteze' && S.ui.synthCh === ch.id) { const b = $('#sy-body'); if (b) b.innerHTML = md(t); }
        },
      });
      const o = { id: uid('o_'), chapterId: ch.id, type: 'sinteza', content, createdAt: Date.now() };
      await db.put('outputs', o);
      S.outputs.push(o);
    }
    return 'Sinteze gata.';
  });
}

// =============== PODCAST ===============
function viewPodcast(v) {
  if (!S.chapters.length) { v.innerHTML = '<h2>Podcast</h2><div class="card empty">Segmentează întâi materia pe capitole.</div>'; return; }
  needKey(v);
  const set = getSettings();
  const cur = (S.ui.podCh && chapterById(S.ui.podCh)) ? S.ui.podCh : S.chapters[0].id;
  S.ui.podCh = cur;
  const out = latestOutput(cur, 'podcast');
  const voices = speechSynthesis.getVoices();
  const ro = voices.filter((x) => /^ro/i.test(x.lang));
  const vlist = ro.length ? ro : voices;
  const pv = (S.ui.podVoices ||= {});
  const vopts = (sel) => vlist.map((x) => `<option value="${esc(x.name)}" ${x.name === sel ? 'selected' : ''}>${esc(x.name)} (${x.lang})</option>`).join('');
  v.insertAdjacentHTML('beforeend', `<h2>Podcast de recapitulare</h2>
    <p class="lead">Un dialog scurt între doi prezentatori despre ce trebuie ținut minte din capitol, citit cu voce sintetică direct în browser.</p>
    <div class="card"><div class="row">
      <div style="flex:1;min-width:220px">${chapterSelect('pd-ch', cur)}</div>
      <label class="row small">Durată <select id="pd-min" style="width:auto">${[3, 5, 8, 12].map((m) => `<option ${+set.podcastMinutes === m ? 'selected' : ''}>${m}</option>`).join('')}</select> min</label>
      <button id="pd-gen">${out ? 'Regenerează' : 'Creează podcastul'}</button></div></div>
    ${out ? `<div class="card">
      <div class="row" style="margin-bottom:10px"><strong>🎙️ ${esc(out.content.title)}</strong><span class="spacer"></span><button class="ghost small" id="pd-dl">Descarcă scenariul</button></div>
      ${!ro.length ? '<p class="small" style="color:var(--warn)">Browserul nu are o voce românească instalată — se folosește altă voce. Pe Windows: Setări → Timp și limbă → Vorbire → adaugă „Română". Chrome/Edge au de obicei voci online românești.</p>' : ''}
      <div class="grid2"><label class="field"><span>Vocea Anei</span><select id="pd-va">${vopts(pv.Ana || vlist[0]?.name)}</select></label>
      <label class="field"><span>Vocea lui Mihai</span><select id="pd-vm">${vopts(pv.Mihai || vlist[1]?.name || vlist[0]?.name)}</select></label></div>
      <div class="row" style="margin-bottom:12px"><button id="pd-play">▶ Redă</button><button class="ghost" id="pd-pause">⏸ Pauză</button><button class="ghost" id="pd-stop">⏹ Stop</button>
        <label class="row small">Viteză <input type="range" id="pd-rate" min="0.7" max="1.6" step="0.1" value="${S.ui.podRate || 1}" style="width:120px"/></label></div>
      <div id="pd-lines">${out.content.lines.map((l, i) => `<div class="pod-line ${l.speaker}" data-i="${i}"><b>${l.speaker}</b>${esc(l.text)}</div>`).join('')}</div>
    </div>` : '<div class="card empty">Niciun podcast pentru acest capitol încă.</div>'}`);
  if (!voices.length) speechSynthesis.onvoiceschanged = () => { speechSynthesis.onvoiceschanged = null; if (S.tab === 'podcast') render(); };
  $('#pd-ch').onchange = (e) => { stopPodcast(); S.ui.podIndex = 0; S.ui.podCh = e.target.value; render(); };
  $('#pd-min').onchange = (e) => saveSettings({ ...getSettings(), podcastMinutes: +e.target.value });
  $('#pd-gen').onclick = () => {
    if (needKeyToast()) return;
    const ch = chapterById(cur);
    stopPodcast();
    runJob(`Podcast: ${ch.title}`, async (job) => {
      const content = await P.podcast(Study.withRef(ch), sourcesById(), +$('#pd-min').value, { signal: job.signal, onStatus: job.status });
      const o = { id: uid('o_'), chapterId: ch.id, type: 'podcast', content, createdAt: Date.now() };
      await db.put('outputs', o);
      S.outputs.push(o);
      return `Podcast gata: ${content.lines.length} replici.`;
    });
  };
  if (!out) return;
  $('#pd-va').onchange = (e) => (pv.Ana = e.target.value);
  $('#pd-vm').onchange = (e) => (pv.Mihai = e.target.value);
  $('#pd-rate').oninput = (e) => (S.ui.podRate = +e.target.value);
  $('#pd-dl').onclick = () => download(`Podcast - ${chapterById(cur).title}.txt`, `${out.content.title}\n\n` + out.content.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n\n'), 'text/plain');
  $('#pd-play').onclick = () => {
    if (speechSynthesis.paused) { speechSynthesis.resume(); return; }
    playPodcast(out.content.lines, S.ui.podIndex || 0);
  };
  $('#pd-pause').onclick = () => speechSynthesis.pause();
  $('#pd-stop').onclick = () => { stopPodcast(); S.ui.podIndex = 0; $$('.pod-line').forEach((x) => x.classList.remove('now')); };
  $$('.pod-line', v).forEach((el) => (el.onclick = () => { stopPodcast(); playPodcast(out.content.lines, +el.dataset.i); }));
}

function playPodcast(lines, start) {
  speechSynthesis.cancel();
  S.ui.playing = true;
  const voices = speechSynthesis.getVoices();
  const pick = (name) => voices.find((x) => x.name === name);
  const token = (S.ui.podToken = Symbol());
  const speak = (i) => {
    if (S.ui.podToken !== token) return;
    if (i >= lines.length) { S.ui.playing = false; S.ui.podIndex = 0; return; }
    S.ui.podIndex = i;
    $$('.pod-line').forEach((x) => x.classList.toggle('now', +x.dataset.i === i));
    $(`.pod-line[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const l = lines[i];
    const u = new SpeechSynthesisUtterance(l.text);
    const voiceName = l.speaker === 'Ana' ? $('#pd-va')?.value : $('#pd-vm')?.value;
    const voice = pick(voiceName);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'ro-RO';
    u.rate = S.ui.podRate || 1;
    // Dacă ambii vorbitori au aceeași voce, îi diferențiem prin ton.
    if ($('#pd-va')?.value === $('#pd-vm')?.value) u.pitch = l.speaker === 'Ana' ? 1.15 : 0.85;
    u.onend = () => speak(i + 1);
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') speak(i + 1); };
    speechSynthesis.speak(u);
  };
  speak(start);
}
function stopPodcast() {
  S.ui.podToken = null;
  S.ui.playing = false;
  speechSynthesis.cancel();
}

// =============== SETĂRI ===============
function viewSettings(v) {
  const s = getSettings();
  v.innerHTML = `<h2>Setări</h2>
    <div class="card">
      <label class="field"><span>Cheie Claude API</span><input type="password" id="st-key" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"/></label>
      <p class="small muted" style="margin-top:-6px">Obții o cheie din <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Claude Console</a>. Cheia se păstrează doar în acest browser (localStorage) și e trimisă doar către API-ul Anthropic. Nu folosi aplicația pe un calculator public.</p>
      <label class="field"><span>Model</span><select id="st-model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
      <div class="grid2">
        <label class="field"><span>Ținta de grile per capitol</span><input type="number" id="st-target" min="10" max="1000" value="${s.target}"/></label>
        <label class="field"><span>Grile generate per apel</span><input type="number" id="st-batch" min="5" max="40" value="${s.batch}"/></label>
        <label class="field"><span>Ținta de carduri per capitol</span><input type="number" id="st-ctarget" min="10" max="500" value="${s.cardTarget}"/></label>
        <label class="field"><span>Carduri noi pe zi (repetiție)</span><input type="number" id="st-npd" min="0" max="200" value="${s.newPerDay}"/></label>
      </div>
      <button id="st-save">Salvează</button>
    </div>
    <div class="card"><strong>Date</strong>
      <p class="small muted">Toate datele (surse, capitole, grile, carduri și progresul la repetiție, sinteze, podcasturi) sunt stocate local în acest browser. Fă periodic o copie de siguranță.</p>
      <div class="muted small" style="margin-bottom:10px">${S.sources.length} surse · ${S.chapters.length} capitole · ${S.questions.length} grile · ${S.cards.length} carduri · ${S.outputs.length} materiale generate</div>
      <div class="row"><button class="ghost" id="st-exp">Exportă backup (.json)</button><button class="ghost" id="st-imp">Importă backup</button>
      <button class="ghost" id="st-expq">Exportă grilele (.txt)</button><span class="spacer"></span><button class="danger" id="st-wipe">Șterge tot</button></div>
      <input type="file" id="st-file" accept=".json" hidden/>
    </div>`;
  $('#st-save').onclick = () => {
    saveSettings({ ...s, apiKey: $('#st-key').value.trim(), model: $('#st-model').value, target: Math.max(10, +$('#st-target').value || 100), batch: Math.min(40, Math.max(5, +$('#st-batch').value || 15)), cardTarget: Math.max(10, +$('#st-ctarget').value || 60), newPerDay: Math.max(0, +$('#st-npd').value || 0) });
    toast('Setări salvate.');
  };
  $('#st-exp').onclick = () => download(`medstudy-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 2, sources: S.sources, chapters: S.chapters, questions: S.questions, outputs: S.outputs, cards: S.cards }), 'application/json');
  $('#st-expq').onclick = () => {
    const txt = S.chapters.map((c, i) => `=== ${i + 1}. ${c.title} ===\n\n` + qOf(c.id).map((q, k) => `${k + 1}. ${q.stem}\n${q.options.map((o, j) => `${L[j]}. ${o}`).join('\n')}\nRăspuns: ${q.correct.map((j) => L[j]).join(', ')}${q.explanation ? `\nExplicație: ${q.explanation}` : ''}`).join('\n\n')).join('\n\n\n');
    download('grile.txt', txt, 'text/plain');
  };
  $('#st-imp').onclick = () => $('#st-file').click();
  $('#st-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm('Importul înlocuiește toate datele actuale. Continui?')) return;
      for (const st of ['sources', 'chapters', 'questions', 'outputs', 'cards']) { await db.clear(st); await db.putMany(st, data[st] || []); }
      await load();
      toast('Backup importat.');
      render();
    } catch (err) { toast('Fișier invalid: ' + err.message); }
  };
  $('#st-wipe').onclick = async () => {
    if (!confirm('Ștergi TOATE sursele, capitolele, grilele, cardurile și sintezele? Acțiunea nu poate fi anulată.')) return;
    for (const st of ['sources', 'chapters', 'questions', 'outputs', 'cards']) await db.clear(st);
    await load();
    render();
  };
}

Object.assign(views, { surse: viewSources, capitole: viewChapters, grile: viewBank, antrenament: viewQuiz, sinteze: viewSynth, podcast: viewPodcast, setari: viewSettings, __quizStep: quizStep });

await load();
render();
