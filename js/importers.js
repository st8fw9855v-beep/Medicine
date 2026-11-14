// Import structurat (fără AI) din pagini HTML de studiu de tip „Semiologie Recall"
// care conțin constante JS: GRILE, CARDS, SECTIONS, CASES, RECALL, CONTRASTS, EXPLAIN, CHAPTERS, SOURCES.
// Datele se citesc ca literale, fără a executa niciun cod din pagină.
import { uid } from './db.js';

// Extrage literalul (array/obiect) care urmează după `const NAME =`.
function extractLiteral(src, name) {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  const open = src[i];
  if (open !== '[' && open !== '{') return null;
  let depth = 0, str = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (str) {
      if (c === '\\') { j++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

// Convertește un literal JS simplu (chei fără ghilimele, șiruri cu ' sau ", virgule finale) în JSON.
function jsToJSON(lit) {
  let out = '';
  for (let i = 0; i < lit.length; i++) {
    const c = lit[i];
    if (c === '"' || c === "'" || c === '`') {
      let s = '';
      let j = i + 1;
      for (; j < lit.length && lit[j] !== c; j++) {
        if (lit[j] === '\\') { s += lit[j] + lit[j + 1]; j++; continue; }
        if (c !== '"' && lit[j] === '"') { s += '\\"'; continue; }
        if (lit[j] === '\n') { s += '\\n'; continue; }
        s += lit[j];
      }
      out += '"' + s.replace(/\\'/g, "'") + '"';
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < lit.length && /[\w$]/.test(lit[j])) j++;
      const word = lit.slice(i, j);
      let k = j;
      while (/\s/.test(lit[k])) k++;
      if (lit[k] === ':' && /[{,]\s*$/.test(out)) out += JSON.stringify(word);
      else out += word; // true/false/null
      i = j - 1;
      continue;
    }
    if (c === '/' && lit[i + 1] === '/') { while (i < lit.length && lit[i] !== '\n') i++; continue; }
    if (c === '/' && lit[i + 1] === '*') { i = lit.indexOf('*/', i + 2) + 1; continue; }
    out += c;
  }
  return out.replace(/,(\s*[\]}])/g, '$1');
}

function read(src, name) {
  const lit = extractLiteral(src, name);
  if (!lit) return null;
  try { return JSON.parse(lit); } catch { /* încercăm conversia */ }
  try { return JSON.parse(jsToJSON(lit)); } catch (e) { console.warn('Nu am putut citi', name, e); return null; }
}

export function looksLikeStudyPage(text) {
  return /(?:const|let|var)\s+(GRILE|CARDS)\s*=\s*\[/.test(text);
}

/**
 * Întoarce { title, questions, cards, extras } gata de salvat.
 * extras = conținut auxiliar (cazuri, recall, contraste, explicații) ca „outputs" fără capitol.
 */
export function parseStudyPage(html, fileName) {
  const title = (/<title>([^<]*)/i.exec(html)?.[1] || fileName).trim();
  const SECTIONS = read(html, 'SECTIONS') || {};
  const SOURCES = read(html, 'SOURCES') || {};
  const CHAPTERS = read(html, 'CHAPTERS') || {};
  const now = Date.now();
  const secLabel = (k) => (SECTIONS[k] ? `${SECTIONS[k][0]}${SECTIONS[k][1] ? ` (${SECTIONS[k][1]})` : ''}` : k || '');

  const questions = (read(html, 'GRILE') || [])
    .filter((r) => Array.isArray(r) && r[3] && Array.isArray(r[4]) && Array.isArray(r[5]))
    .map((r) => {
      const options = r[4].map(String);
      const correct = [...new Set(r[5].map(Number))].filter((k) => k >= 0 && k < options.length).sort();
      return {
        id: uid('q_'), stem: String(r[3]).trim(), options, correct, type: correct.length > 1 ? 'CM' : 'CS',
        explanation: '', note: r[6] || '', keyCorrected: !!r[7], topic: '',
        chapterId: null, importChapter: CHAPTERS[r[1]] || r[1] || '',
        origin: 'importat', sourceName: SOURCES[r[2]] || r[2] || title, importKey: `${title}:${r[0]}`,
        stats: { seen: 0, right: 0 }, createdAt: now,
      };
    })
    .filter((q) => q.correct.length);

  const cards = (read(html, 'CARDS') || [])
    .filter((c) => Array.isArray(c) && c[2] && c[3])
    .map((c) => ({ id: uid('c_'), chapterId: null, section: secLabel(c[1]), front: String(c[2]), back: String(c[3]), origin: 'importat', sourceName: title, importKey: `${title}:${c[0]}`, srs: null, createdAt: now }));

  const extras = [];
  const cases = read(html, 'CASES');
  if (Array.isArray(cases) && cases.length) extras.push({ type: 'cazuri', content: cases.filter((c) => c.q && Array.isArray(c.o)) });
  const recall = read(html, 'RECALL');
  const contrasts = read(html, 'CONTRASTS');
  if ((recall && recall.length) || (contrasts && contrasts.length)) extras.push({ type: 'recall', content: { recall: recall || [], contrasts: contrasts || [] } });
  const explain = read(html, 'EXPLAIN');
  if (explain && typeof explain === 'object') {
    const items = [];
    for (const [k, arr] of Object.entries(explain)) for (const [t, txt] of arr || []) items.push({ section: secLabel(k), title: t, text: txt, html: true });
    if (items.length) extras.push({ type: 'explicatii', content: items });
  }
  return {
    title,
    questions,
    cards,
    extras: extras.map((e) => ({ id: uid('o_'), chapterId: null, importLabel: title, createdAt: now, ...e })),
  };
}
