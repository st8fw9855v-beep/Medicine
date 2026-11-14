// Extragere text din fișiere încărcate (PDF, DOCX, TXT/MD/HTML, imagini).
import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

export function fileKind(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx')) return 'docx';
  if (/\.(png|jpe?g|webp|gif)$/.test(n)) return 'image';
  if (/\.(html?|xhtml)$/.test(n)) return 'html';
  return 'text';
}

export async function extractText(file, onProgress = () => {}) {
  const kind = fileKind(file);
  if (kind === 'pdf') {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let out = '';
      for (const item of content.items) {
        out += item.str;
        out += item.hasEOL ? '\n' : (item.str.endsWith(' ') ? '' : ' ');
      }
      pages.push(out.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim());
      onProgress(i / pdf.numPages);
    }
    return { text: pages.join('\n\n'), pages: pdf.numPages };
  }
  if (kind === 'docx') {
    const res = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: res.value };
  }
  if (kind === 'html') {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    return { text: doc.body.innerText || doc.body.textContent || '' };
  }
  if (kind === 'image') return { text: '' };
  return { text: await file.text() };
}

export async function fileToBase64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) bin += String.fromCharCode.apply(null, buf.subarray(i, i + step));
  return btoa(bin);
}

// Împarte textul în blocuri numerotate (~700 caractere) pe granițe de rând.
// Blocurile sunt folosite ca „adrese" stabile la segmentarea pe capitole.
export function splitBlocks(text, target = 700) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let cur = '';
  for (const line of lines) {
    if (cur.length + line.length > target * 1.6 && cur.length > 0) {
      blocks.push(cur.trim());
      cur = '';
    }
    cur += line + '\n';
    if (cur.length >= target && /[.:;!?)]\s*$/.test(line)) {
      blocks.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) blocks.push(cur.trim());
  return blocks.filter((b) => b.length > 0);
}

// Grupează blocurile în bucăți de cel mult maxChars caractere.
// overlap = câte blocuri de la finalul bucății anterioare se repetă (ca o grilă tăiată să apară întreagă).
export function chunkBlocks(blocks, maxChars, overlap = 0) {
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const b of blocks) {
    if (len + b.length > maxChars && cur.length) {
      chunks.push(cur.join('\n'));
      cur = overlap ? cur.slice(-overlap) : [];
      len = cur.reduce((s, x) => s + x.length + 1, 0);
    }
    cur.push(b);
    len += b.length + 1;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}
