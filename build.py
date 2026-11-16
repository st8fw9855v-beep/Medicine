#!/usr/bin/env python3
"""Construiește pagina dintr-un singur fișier.

  dist/semiologie-recall.html  — pagina publicată ca artifact Claude (fără <!doctype>, platforma adaugă scheletul)
  index.html                   — aceeași pagină ca document complet (GitHub Pages, deschidere locală)
"""
from pathlib import Path

root = Path(__file__).parent
tpl = (root / 'app/template.html').read_text(encoding='utf-8')
data = (root / 'app/base-data.js').read_text(encoding='utf-8')
app = (root / 'app/app.js').read_text(encoding='utf-8')
for name, s in (('base-data.js', data), ('app.js', app)):
    assert '</script' not in s.lower(), f'{name} contains </script>'
page = tpl.replace('/*BASE_DATA*/', data).replace('/*APP*/', app)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/semiologie-recall.html').write_text(page, encoding='utf-8')
full = ('<!doctype html><html lang="ro"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>\n' + page + '\n</body></html>\n')
(root / 'index.html').write_text(full, encoding='utf-8')
print(f'dist/semiologie-recall.html: {len(page.encode()) / 1024:.0f} KiB')

# Versiunea pentru LiveSend se face din aplicație (⚙ → „Versiune pentru LiveSend”), din datele fiecărei persoane.
