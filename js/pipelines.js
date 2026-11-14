// Fluxurile de lucru AI: transcriere, segmentare, extragere grile, generare grile, sinteze, podcast.
import { callJSON, callText, estimateTokens } from './ai.js';
import { fileToBase64, fileKind, chunkBlocks } from './parse.js';
import { uid } from './db.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// ---------- utilitare ----------
export function normStem(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\s*\d+\s*[.)-]\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function chapterText(chapter, sourcesById, maxChars = Infinity) {
  const parts = [];
  for (const r of chapter.ranges || []) {
    const src = sourcesById[r.sourceId];
    if (!src) continue;
    const from = Math.max(0, r.fromBlock);
    const to = Math.min(src.blocks.length - 1, r.toBlock);
    if (to < from) continue;
    parts.push(`### Sursa: ${src.name}\n` + src.blocks.slice(from, to + 1).join('\n'));
  }
  let t = parts.join('\n\n');
  if (t.length > maxChars) t = t.slice(0, maxChars);
  return t;
}

function questionToText(q, i) {
  const opts = q.options.map((o, k) => `${LETTERS[k]}. ${o}`).join('\n');
  return `${i + 1}. (${q.type}) ${q.stem}\n${opts}\nRăspuns: ${q.correct.map((c) => LETTERS[c]).join(', ')}`;
}

function sanitizeQuestion(q) {
  const options = (q.options || []).map((o) => String(o).replace(/^\s*[A-Ea-e][.)]\s*/, '').trim()).filter(Boolean).slice(0, 5);
  let correct = [...new Set((q.correct || []).map(Number))].filter((c) => c >= 0 && c < options.length).sort();
  if (!options.length || !correct.length || !q.stem) return null;
  const type = correct.length > 1 ? 'CM' : 'CS';
  return { stem: q.stem.trim(), options, correct, type, explanation: (q.explanation || '').trim(), topic: q.topic || '' };
}

const QUESTION_ITEM = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['CS', 'CM'] },
    stem: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    correct: { type: 'array', items: { type: 'integer' } },
    explanation: { type: 'string' },
    topic: { type: 'string' },
  },
  required: ['type', 'stem', 'options', 'correct', 'explanation', 'topic'],
  additionalProperties: false,
};

// ---------- 1. Transcriere (PDF scanat / imagini) ----------
export async function transcribeFile(file, { signal, onText } = {}) {
  const kind = fileKind(file);
  const data = await fileToBase64(file);
  const block =
    kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data } };
  return callText({
    system: 'Ești un instrument de transcriere (OCR). Transcrii fidel, în limba originală, tot textul din document, păstrând titlurile, numerotarea, listele și tabelele (în Markdown). Nu adăuga comentarii.',
    content: [block, { type: 'text', text: 'Transcrie integral textul acestui document.' }],
    effort: 'low',
    maxTokens: 128000,
    signal,
    onText,
  });
}

// ---------- 2. Segmentare pe capitole ----------
const SEGMENT_SCHEMA = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          topics: { type: 'array', items: { type: 'string' } },
          ranges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'integer' },
                fromBlock: { type: 'integer' },
                toBlock: { type: 'integer' },
              },
              required: ['source', 'fromBlock', 'toBlock'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'summary', 'topics', 'ranges'],
        additionalProperties: false,
      },
    },
  },
  required: ['chapters'],
  additionalProperties: false,
};

function numberedSource(src, idx) {
  return `<sursa id="${idx}" nume="${src.name}">\n` + src.blocks.map((b, i) => `[§${i}] ${b}`).join('\n') + `\n</sursa>`;
}

async function segmentGroup(group, { signal, onText, hint }) {
  const body = group.map(({ src, idx }) => numberedSource(src, idx)).join('\n\n');
  const res = await callJSON({
    system:
      'Ești un profesor universitar de medicină care organizează materia de examen. ' +
      'Primești una sau mai multe surse de curs, împărțite în blocuri numerotate [§n]. ' +
      'Împarte materia în capitole de studiu coerente, în ordinea logică a predării. ' +
      'Un capitol trebuie să fie suficient de bogat pentru ~100 de grile (de regulă corespunde unui capitol/curs din material; nu fragmenta excesiv, nu comasa teme fără legătură). ' +
      'Dacă mai multe surse tratează aceeași temă, pune-le în același capitol, cu câte un interval (range) pentru fiecare sursă. ' +
      'Intervalele sunt inclusive (fromBlock..toBlock) și trebuie să acopere tot conținutul util; ignoră cuprinsul, bibliografia și paginile goale. ' +
      'Titlurile, rezumatele și temele se scriu în limba română. ' +
      '„topics" = 5-15 subteme concrete ale capitolului (folosite pentru a distribui grilele).',
    content: [
      { type: 'text', text: body },
      { type: 'text', text: 'Segmentează materia de mai sus pe capitole.' + (hint ? `\nIndicații de la student: ${hint}` : '') },
    ],
    schema: SEGMENT_SCHEMA,
    effort: 'high',
    maxTokens: 64000,
    signal,
    onText,
  });
  return res.chapters;
}

export async function segmentSources(materials, { signal, onStatus = () => {}, hint } = {}) {
  const indexed = materials.map((src, idx) => ({ src, idx }));
  // Grupăm sursele astfel încât fiecare apel să rămână bine sub fereastra de context.
  const LIMIT = 600000; // tokeni estimați per apel
  const groups = [];
  let cur = [];
  let tok = 0;
  for (const it of indexed) {
    const t = estimateTokens(it.src.text.length * 1.05);
    if (tok + t > LIMIT && cur.length) { groups.push(cur); cur = []; tok = 0; }
    cur.push(it);
    tok += t;
  }
  if (cur.length) groups.push(cur);

  const chapters = [];
  for (let g = 0; g < groups.length; g++) {
    onStatus(`Analizez materia (${g + 1}/${groups.length})…`);
    const res = await segmentGroup(groups[g], {
      signal,
      hint,
      onText: (n) => onStatus(`Analizez materia (${g + 1}/${groups.length})… ${n} caractere primite`),
    });
    for (const ch of res) {
      const ranges = ch.ranges
        .filter((r) => materials[r.source])
        .map((r) => ({ sourceId: materials[r.source].id, fromBlock: Math.min(r.fromBlock, r.toBlock), toBlock: Math.max(r.fromBlock, r.toBlock) }));
      chapters.push({ id: uid('ch_'), order: chapters.length, title: ch.title, summary: ch.summary, topics: ch.topics, ranges });
    }
  }
  return chapters;
}

// ---------- 3. Extragere grile din surse de grile ----------
const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...QUESTION_ITEM.properties,
          chapter: { type: 'integer' },
          answerSource: { type: 'string', enum: ['cheie', 'dedus'] },
        },
        required: [...QUESTION_ITEM.required, 'chapter', 'answerSource'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

function chapterMenu(chapters) {
  return chapters.map((c, i) => `${i + 1}. ${c.title} — subteme: ${(c.topics || []).join('; ')}`).join('\n');
}

export async function extractQuestions(source, chapters, { signal, onStatus = () => {}, onBatch = async () => {} } = {}) {
  const chunks = chunkBlocks(source.blocks, 22000, 1);
  // Cheia de răspunsuri e adesea la finalul documentului: o trimitem ca context în fiecare apel.
  const tail = source.text.length > 22000 ? source.text.slice(-12000) : '';
  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    onStatus(`Extrag grile din „${source.name}" (${i + 1}/${chunks.length})…`);
    const res = await callJSON({
      system:
        'Extragi grile (întrebări cu răspuns multiplu) dintr-un document de examen de medicină, în limba română. ' +
        'Reguli: (1) Copiază fidel enunțul și variantele (fără litera din față). ' +
        '(2) „correct" = indicii variantelor corecte (0=A … 4=E). Dacă documentul conține răspunsul/cheia, folosește-o și pune answerSource="cheie"; altfel deduce răspunsul corect din cunoștințele medicale și pune answerSource="dedus". ' +
        '(3) type: CS = complement simplu (un singur răspuns corect), CM = complement multiplu. ' +
        '(4) „chapter" = numărul capitolului din lista dată căruia îi aparține grila; 0 dacă nu se potrivește niciunui capitol. ' +
        '(5) „explanation" = 1-3 fraze care justifică răspunsul. „topic" = subtema. ' +
        '(6) Ignoră grilele tăiate la începutul sau finalul fragmentului (incomplete). Nu inventa grile care nu există în text.',
      content: [
        { type: 'text', text: `Capitolele materiei:\n${chapterMenu(chapters)}` },
        ...(tail && i < chunks.length - 1 ? [{ type: 'text', text: `Finalul documentului (poate conține cheia de răspunsuri):\n${tail}` }] : []),
        { type: 'text', text: `Fragmentul ${i + 1}/${chunks.length} din „${source.name}":\n\n${chunks[i]}` },
        { type: 'text', text: 'Extrage toate grilele complete din fragment.' },
      ],
      schema: EXTRACT_SCHEMA,
      effort: 'low',
      maxTokens: 64000,
      signal,
      onText: (n) => onStatus(`Extrag grile din „${source.name}" (${i + 1}/${chunks.length})… ${n} caractere`),
    });
    const qs = [];
    for (const raw of res.questions) {
      const q = sanitizeQuestion(raw);
      if (!q) continue;
      const ch = chapters[raw.chapter - 1];
      qs.push({
        id: uid('q_'), ...q, chapterId: ch ? ch.id : null, origin: 'importat',
        answerSource: raw.answerSource, sourceId: source.id, sourceName: source.name,
        stats: { seen: 0, right: 0 }, createdAt: Date.now(),
      });
    }
    total += qs.length;
    await onBatch(qs);
  }
  return total;
}

// ---------- 4. Reasignare grile la capitole (după resegmentare) ----------
export async function assignQuestions(questions, chapters, { signal, onStatus = () => {} } = {}) {
  const schema = {
    type: 'object',
    properties: { map: { type: 'array', items: { type: 'object', properties: { q: { type: 'integer' }, chapter: { type: 'integer' } }, required: ['q', 'chapter'], additionalProperties: false } } },
    required: ['map'], additionalProperties: false,
  };
  const out = [];
  for (let i = 0; i < questions.length; i += 150) {
    const part = questions.slice(i, i + 150);
    onStatus(`Asociez grile la capitole (${Math.min(i + 150, questions.length)}/${questions.length})…`);
    const res = await callJSON({
      system: 'Asociezi fiecare grilă capitolului căruia îi aparține. Răspunde cu numărul capitolului (0 dacă nu se potrivește niciunul).',
      content: `Capitole:\n${chapterMenu(chapters)}\n\nGrile:\n` + part.map((q, k) => `${k + 1}. ${q.stem} | ${q.options.join(' | ')}`).join('\n'),
      schema, effort: 'low', maxTokens: 16000, signal,
    });
    for (const m of res.map) {
      const q = part[m.q - 1];
      if (q) out.push({ ...q, chapterId: chapters[m.chapter - 1]?.id || null });
    }
  }
  return out;
}

// ---------- 5. Generare grile noi ----------
const GEN_SCHEMA = { type: 'object', properties: { questions: { type: 'array', items: QUESTION_ITEM } }, required: ['questions'], additionalProperties: false };

export async function generateQuestions(chapter, sourcesById, existing, count, { signal, onStatus = () => {} } = {}) {
  const text = chapterText(chapter, sourcesById, 400000);
  const stems = existing.map((q) => '- ' + q.stem.slice(0, 160)).join('\n');
  const topicCounts = {};
  for (const q of existing) if (q.topic) topicCounts[q.topic] = (topicCounts[q.topic] || 0) + 1;
  const res = await callJSON({
    system: [
      {
        type: 'text',
        text:
          'Ești profesor universitar de medicină și redactezi grile pentru examenul de licență / rezidențiat, în limba română, ' +
          'în stilul grilelor oficiale: 5 variante (A-E), tip CS (complement simplu: exact 1 răspuns corect) sau CM (complement multiplu: 2-4 răspunsuri corecte). ' +
          'Reguli: grilele se bazează STRICT pe materialul capitolului de mai jos; testează noțiuni importante (definiții, clasificări, mecanisme, semne, diagnostic, tratament, valori numerice, excepții); ' +
          'distractorii sunt plauzibili, nu absurzi; evită „toate/niciuna de mai sus"; nu repeta grilele existente și nu le reformula superficial; ' +
          'aproximativ 40% CS și 60% CM; variază dificultatea. „explanation" justifică fiecare variantă corectă (și de ce distractorul principal e greșit), cu referire la material. ' +
          '„correct" conține indicii variantelor corecte (0=A … 4=E).',
      },
      {
        type: 'text',
        text: `CAPITOL: ${chapter.title}\nSubteme: ${(chapter.topics || []).join('; ')}\n\nMATERIAL:\n${text}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    content:
      `Generează exact ${count} grile NOI pentru acest capitol.\n` +
      `Distribuie-le pe subteme, favorizând subtemele mai puțin acoperite. Acoperirea actuală: ${JSON.stringify(topicCounts)}\n\n` +
      (stems ? `Grile deja existente (NU le repeta):\n${stems}` : 'Nu există încă grile pentru acest capitol.'),
    schema: GEN_SCHEMA,
    effort: 'medium',
    maxTokens: 64000,
    signal,
    onText: (n) => onStatus(`… ${n} caractere primite`),
  });
  const seen = new Set(existing.map((q) => normStem(q.stem)));
  const out = [];
  for (const raw of res.questions) {
    const q = sanitizeQuestion(raw);
    if (!q || seen.has(normStem(q.stem))) continue;
    seen.add(normStem(q.stem));
    out.push({ id: uid('q_'), ...q, chapterId: chapter.id, origin: 'generat', stats: { seen: 0, right: 0 }, createdAt: Date.now() });
  }
  return out;
}

// ---------- 6. Sinteză de examen ----------
export async function synthesis(chapter, sourcesById, questions, { signal, onText } = {}) {
  const text = chapterText(chapter, sourcesById, 500000);
  const hard = questions
    .filter((q) => q.stats?.seen && q.stats.right / q.stats.seen < 0.6)
    .slice(0, 40);
  const sample = (hard.length ? hard : questions).slice(0, 60);
  return callText({
    system:
      'Ești profesor universitar de medicină. Scrii o SINTEZĂ COMPLETĂ PENTRU EXAMEN, în limba română, în Markdown, pentru un student care învață pe grile. ' +
      'Sinteza trebuie să permită recapitularea întregului capitol fără a reciti cursul: densă, structurată, fără umplutură. ' +
      'Structură (adaptează secțiunile la natura capitolului, omite ce nu se aplică): ' +
      '## Pe scurt (5-8 rânduri) · ## Noțiuni-cheie și definiții · ## Clasificări · ## Mecanisme / fiziopatologie · ## Clinic, diagnostic, tratament · ' +
      '## Tabele comparative (tabele Markdown) · ## Cifre și valori de reținut · ## Mnemotehnici · ## Capcane frecvente la grile · ## Autoevaluare (10 întrebări scurte cu răspuns). ' +
      'Folosește **bold** pentru termenii care apar des la grile. Bazează-te pe material; dacă adaugi ceva din afara lui, marchează cu „(completare)".',
    content:
      `CAPITOL: ${chapter.title}\n\nMATERIAL:\n${text}\n\n` +
      (sample.length ? `GRILE DIN ACEST CAPITOL (folosește-le pentru secțiunea „Capcane frecvente" și pentru a ști ce se cere):\n${sample.map(questionToText).join('\n\n')}` : '') +
      '\n\nScrie sinteza.',
    effort: 'medium',
    maxTokens: 64000,
    signal,
    onText,
  });
}

// ---------- 7. Podcast ----------
const PODCAST_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', properties: { speaker: { type: 'string', enum: ['Ana', 'Mihai'] }, text: { type: 'string' } }, required: ['speaker', 'text'], additionalProperties: false } },
  },
  required: ['title', 'lines'],
  additionalProperties: false,
};

export async function podcast(chapter, sourcesById, minutes, { signal, onStatus = () => {} } = {}) {
  const text = chapterText(chapter, sourcesById, 400000);
  const words = Math.round(minutes * 145);
  return callJSON({
    system:
      'Scrii scenariul unui podcast educațional scurt, în limba română, pentru studenți la medicină care se pregătesc de examen. ' +
      'Doi prezentatori: Ana (explică, structurează) și Mihai (pune întrebări de student, face legături, recapitulează). ' +
      'Ton natural, conversațional, dar dens în informație. Conținut: doar ce TREBUIE ținut minte din capitol — ideile principale, ' +
      'clasificări, cifre-cheie, diferențe care se confundă la grile, mnemotehnici. Încheie cu o recapitulare „top 5 de reținut". ' +
      'Textul va fi citit de o voce sintetică: fără Markdown, fără liste cu simboluri, abrevierile scrise o dată pe larg, numerele scrise clar. Replici scurte (1-4 fraze).',
    content: `CAPITOL: ${chapter.title}\n\nMATERIAL:\n${text}\n\nScrie un podcast de aproximativ ${minutes} minute (~${words} de cuvinte).`,
    schema: PODCAST_SCHEMA,
    effort: 'medium',
    maxTokens: 32000,
    signal,
    onText: (n) => onStatus(`Scriu scenariul… ${n} caractere`),
  });
}

export { LETTERS };
