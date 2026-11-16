#!/usr/bin/env python3
"""Pregătește băncile de grile dintr-un folder public Google Drive pentru pagina Semiologie Recall+.

Pași:
  1. listează folderul (gdown), păstrează documentele cu grile dintr-un an (implicit „Anul III”);
  2. le descarcă și extrage textul (pdftotext, catdoc, python-docx);
  3. elimină duplicatele exacte și fișierele conținute aproape integral în altele;
  4. scrie, în OUT/dbdocs, documentele pentru stocarea comună a paginii:
       sources/<id>              {name, kind:"grile", subject, pool:true, origin, chars, nBlocks, addedAt}
       sources/<id>/chunks/cNNNN {n, blocks:[…]}   (câte 150 de blocuri de ~700 de caractere)
     și OUT/batches.json, loturi gata de scris cu instrumentul ArtifactData (action "batch").

Pagina citește apoi grilele cu Claude (contul proprietarului), le ține în „bancă” pe materii
și le mută în capitolele potrivite când se încarcă materialul de curs.

Cerințe: pip install gdown python-docx; apt install poppler-utils catdoc.
Utilizare: python3 tools/drive_import.py FOLDER_ID OUT_DIR ["Anul III"]
"""
import hashlib, itertools, json, os, re, subprocess, sys, time

# Doar materiile din aplicație (Bioetica și Imunologia nu se importă).
SUBJ = {'FARMACOLOGIE': 'Farmacologie', 'FIZIOPATOLOGIE': 'Fiziopatologie', 'MORFOPATOLOGIE': 'Morfopatologie',
        'SEMIO CHIR': 'Semiologie chirurgicală', 'SEMIO MED': 'Semiologie medicală'}
QUESTION_PATH = re.compile(r'grile|grila|teste|test_|intreb', re.I)


def list_folder(folder_id):
    import gdown
    return [(f.id, f.path) for f in gdown.download_folder(id=folder_id, skip_download=True, quiet=True)]


def to_text(path):
    kind = subprocess.run(['file', '-b', path], capture_output=True, text=True).stdout
    if kind.startswith('PDF'):
        return subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    if kind.startswith('Composite'):
        return subprocess.run(['catdoc', '-d', 'utf-8', path], capture_output=True, text=True).stdout
    import docx
    d = docx.Document(path)
    return '\n'.join(p.text for p in d.paragraphs) + '\n' + '\n'.join(' | '.join(c.text for c in r.cells) for t in d.tables for r in t.rows)


def split_blocks(text, target=700):  # aceeași împărțire ca splitBlocks din app/app.js
    blocks, cur = [], ''
    for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        if len(cur) + len(line) > target * 1.6 and cur:
            blocks.append(cur.strip()); cur = ''
        if len(line) > target * 2.5:
            blocks += [line[i:i + target].strip() for i in range(0, len(line), target)]; continue
        cur += line + '\n'
        if len(cur) >= target and re.search(r'[.:;!?)]\s*$', line):
            blocks.append(cur.strip()); cur = ''
    if cur.strip(): blocks.append(cur.strip())
    return [b for b in blocks if b]


def is_french(t):
    w = re.findall(r"[a-zăâîșşțţéèêàç']+", t.lower())
    fr = sum(x in ('les', 'des', 'une', 'est', 'dans', 'pour', 'avec', 'qui', 'sont', 'du', 'à', 'le', 'la') for x in w)
    ro = sum(x in ('si', 'și', 'este', 'care', 'din', 'pentru', 'sunt', 'cu', 'de', 'la', 'in', 'în', 'sau') for x in w)
    return fr > ro * 0.6


def main(folder_id, out, year='Anul III'):
    os.makedirs(f'{out}/files', exist_ok=True); os.makedirs(f'{out}/dbdocs', exist_ok=True)
    files = [(i, p) for i, p in list_folder(folder_id)
             if f'Medicina - {year}/' in p and p.split('/')[1] in SUBJ and QUESTION_PATH.search(p) and p.rsplit('.', 1)[-1].lower() in ('pdf', 'docx', 'doc') and '/cursuri' not in p]
    texts = {}
    for n, (fid, p) in enumerate(files):
        dst = f'{out}/files/{n:03d}_' + os.path.basename(p).replace(' ', '_')
        if not os.path.exists(dst):
            subprocess.run(['curl', '-sSL', '-o', dst, f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t'], check=True)
        t = re.sub(r'[ \t]{3,}', '  ', re.sub(r'\n{3,}', '\n\n', to_text(dst))).strip()
        # fără duplicate exacte, PDF-uri scanate (fără text), franceză sau notițe fără variante de răspuns
        if len(t) < 200 or is_french(t) or len(re.findall(r'(?m)^\s*[a-eA-E][).]\s', t)) < 10: continue
        h = hashlib.md5(re.sub(r'\s+', ' ', t).encode()).hexdigest()
        if h not in {v[2] for v in texts.values()}: texts[p] = (t, fid, h)
    lines = {p: {re.sub(r'\s+', ' ', l).strip().lower() for l in t.split('\n') if len(l.strip()) > 25} for p, (t, _, _) in texts.items()}
    for a, b in itertools.permutations(list(texts), 2):  # conținut aproape integral în alt fișier
        if a in texts and b in texts and len(lines[a]) > 20 and len(lines[a] & lines[b]) / len(lines[a]) > 0.8 and len(lines[a]) <= len(lines[b]):
            del texts[a]
    writes, now = [], int(time.time() * 1000)
    for k, (p, (t, fid, _)) in enumerate(sorted(texts.items())):
        sid, parts = f'drive-{re.sub(r"[^a-z0-9]", "", year.lower())}-{k + 1:03d}', p.split('/')
        subj = SUBJ.get(parts[1], parts[1].title())
        blocks = split_blocks(t)
        for c in range(0, len(blocks), 150):
            fn = f'{out}/dbdocs/{sid}-c{c // 150:04d}.json'
            json.dump({'n': c // 150, 'blocks': blocks[c:c + 150]}, open(fn, 'w'), ensure_ascii=False)
            writes.append({'op': 'set', 'collection': f'sources/{sid}/chunks', 'doc_id': f'c{c // 150:04d}', 'file_path': os.path.abspath(fn)})
        fn = f'{out}/dbdocs/{sid}.json'
        json.dump({'name': f'{subj} · {parts[-1]}', 'kind': 'grile', 'subject': subj, 'pool': True, 'origin': 'Google Drive · ' + p,
                   'chars': len(t), 'nBlocks': len(blocks), 'addedAt': now + k}, open(fn, 'w'), ensure_ascii=False)
        writes.append({'op': 'set', 'collection': 'sources', 'doc_id': sid, 'file_path': os.path.abspath(fn), 'meta': True})
    ordered = [w for w in writes if not w.get('meta')] + [w for w in writes if w.get('meta')]
    batches, cur, size = [], [], 0
    for w in ordered:
        s = os.path.getsize(w['file_path'])
        if cur and (len(cur) >= 50 or size + s > 900_000): batches.append(cur); cur, size = [], 0
        cur.append({k: v for k, v in w.items() if k != 'meta'}); size += s
    if cur: batches.append(cur)
    json.dump(batches, open(f'{out}/batches.json', 'w'))
    print(f'{len(texts)} question banks, {len(writes)} documents, {len(batches)} batches → {out}/batches.json')


if __name__ == '__main__':
    main(*sys.argv[1:])
