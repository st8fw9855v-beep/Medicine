// Starea aplicației și utilitarele comune pentru toate vederile.
import { db, uid } from './db.js';
import { getSettings } from './ai.js';
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';

export const views = {};
export const S = { sources: [], chapters: [], questions: [], outputs: [], cards: [], tab: 'surse', ui: {} };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const md = (s) => DOMPurify.sanitize(marked.parse(s || ''));
export const fmt = (n) => n.toLocaleString('ro-RO');

// ---------------- încărcare stare ----------------
export async function load() {
  [S.sources, S.chapters, S.questions, S.outputs, S.cards] = await Promise.all(['sources', 'chapters', 'questions', 'outputs', 'cards'].map((s) => db.all(s)));
  S.chapters.sort((a, b) => a.order - b.order);
  S.sources.sort((a, b) => a.addedAt - b.addedAt);
}
export const sourcesById = () => Object.fromEntries(S.sources.map((s) => [s.id, s]));
export const chapterById = (id) => S.chapters.find((c) => c.id === id);
export const qOf = (chId) => S.questions.filter((q) => q.chapterId === chId);
export const latestOutput = (chId, type) => S.outputs.filter((o) => o.chapterId === chId && o.type === type).sort((a, b) => b.createdAt - a.createdAt)[0];

// ---------------- notificări & job-uri ----------------
let toastTimer;
export function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

const jobs = [];
export function renderJobs() {
  const box = $('#jobs');
  box.classList.toggle('hidden', jobs.length === 0);
  box.classList.toggle('min', !!S.ui.jobsMin);
  const running = jobs.filter((j) => j.state === 'run').length;
  $('#jobs-count').textContent = running ? `(${running} în lucru)` : '';
  $('#jobs-list').innerHTML = jobs
    .slice().reverse()
    .map((j) => `<div class="job ${j.state}">
      <div class="row"><strong>${esc(j.title)}</strong><span class="spacer"></span>
      ${j.state === 'run' ? `<button class="ghost small" data-abort="${j.id}">Anulează</button>` : ''}</div>
      <div class="st">${esc(j.statusText)}</div>
      ${j.state === 'run' && j.frac != null ? `<div class="progress"><div style="width:${Math.round(j.frac * 100)}%"></div></div>` : ''}
    </div>`).join('');
}
$('#jobs').addEventListener('click', (e) => {
  const id = e.target.dataset.abort;
  if (id) jobs.find((j) => j.id === id)?.ctrl.abort();
});
$('#jobs-min').onclick = () => { S.ui.jobsMin = !S.ui.jobsMin; renderJobs(); };
$('#jobs-close').onclick = () => { for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state !== 'run') jobs.splice(i, 1); renderJobs(); };

export async function runJob(title, fn) {
  const job = { id: uid('j'), title, state: 'run', statusText: 'Pornesc…', frac: null, ctrl: new AbortController() };
  jobs.push(job);
  renderJobs();
  const api = {
    signal: job.ctrl.signal,
    status: (t) => { job.statusText = t; renderJobs(); },
    progress: (f) => { job.frac = f; renderJobs(); },
  };
  try {
    const msg = await fn(api);
    job.state = 'done';
    job.statusText = msg || 'Gata.';
  } catch (err) {
    console.error(err);
    job.state = 'err';
    job.statusText = job.ctrl.signal.aborted ? 'Anulat.' : 'Eroare: ' + (err?.error?.error?.message || err.message || err);
  }
  renderJobs();
  render();
  // Job-urile reușite dispar singure; erorile rămân până sunt închise.
  if (job.state === 'done') setTimeout(() => { const k = jobs.indexOf(job); if (k >= 0) { jobs.splice(k, 1); renderJobs(); } }, 8000);
}

// ---------------- navigare ----------------
$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('button')?.dataset.tab;
  if (!t) return;
  S.tab = t;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  render();
});

export function render() {
  const v = $('#view');
  const sameTab = S.ui.drawn === S.tab;
  S.ui.drawn = S.tab;
  // Antrenamentul în curs nu se re-randează din fundal (de ex. când termină un job).
  if (S.tab === 'antrenament' && S.ui.quiz?.active) { if (!sameTab) views.__quizStep(); return; }
  if (S.tab === 'repetitie' && S.ui.srs?.started && sameTab) return;
  v.onclick = null;
  v.innerHTML = '';
  views[S.tab](v);
  if (S.tab === 'podcast' && S.ui.playing) $(`.pod-line[data-i="${S.ui.podIndex}"]`)?.classList.add('now');
}

export function chapterSelect(id, selected, { all = false } = {}) {
  return `<select id="${id}">${all ? `<option value="__all">Toate capitolele</option>` : ''}${S.chapters.map((c, i) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${i + 1}. ${esc(c.title)}</option>`).join('')}</select>`;
}
export function needKey(v) {
  if (getSettings().apiKey) return false;
  v.insertAdjacentHTML('afterbegin', `<div class="card" style="border-color:var(--warn)"><strong>Lipsește cheia API.</strong> Funcțiile AI au nevoie de o cheie Claude API — adaug-o în tabul <a href="#" id="go-set">Setări</a>.</div>`);
  $('#go-set').onclick = (e) => { e.preventDefault(); $('#tabs [data-tab=setari]').click(); };
  return true;
}
export function needKeyToast() {
  if (getSettings().apiKey) return false;
  toast('Adaugă întâi cheia API în tabul Setări.');
  return true;
}

// ---------------- utilitare ----------------
export function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  a.download = name.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function printHtml(title, html) {
  const w = window.open('', '_blank');
  if (!w) return toast('Permite ferestrele pop-up pentru a printa.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:800px;margin:30px auto;padding:0 20px;color:#111}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}h2{border-bottom:1px solid #ccc}</style></head><body><h1>${esc(title)}</h1>${html}</body></html>`);
  w.document.close();
  w.onload = () => w.print();
}
