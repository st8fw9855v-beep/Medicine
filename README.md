# Semiologie Recall+

Aplicația **Semiologie Recall** conține un deck cu repetiție spațiată, 868 de grile cu chei verificate față de cursul din 2022, cazuri clinice amestecate, fișe de recall, tabele de contrast și explicații de mecanism. Această versiune o extinde și o face o pagină pe care o deschizi și o trimiți colegilor printr-un link.

## Ce s-a adăugat

- **Sources & chapters**: încarci materiale de curs și bănci de grile în orice format: PDF (inclusiv scanat), DOCX, TXT, HTML, poze de pagini sau text lipit.
  - Claude împarte materialul pe capitole și îl atașează capitolelor existente când se potrivesc.
  - Grilele din bănci sunt sortate pe capitole și curățate de duplicate.
  - **Fill to 100** scrie grile noi în același stil până la cel puțin 100 pe capitol.
  - **Check keys** verifică cheile față de curs: cursul are prioritate, iar grila primește „KEY CORRECTED” și o notă.
  - **⚡ Prepare everything** face toți pașii pentru un capitol.
- **Exam summaries**: o sinteză completă de examen pe capitol.
- **Podcast**: un dialog scurt între Ana și Mihai despre ce trebuie ținut minte, citit cu voci Claude.
- **Tab-urile originale** funcționează și pentru capitolele noi. Cases, Recall & contrasts, Explanations și Review pot scrie conținut nou pentru capitolul ales.

## Cum funcționează ca pagină Claude

- **Fără cheie API**: funcțiile AI folosesc contul Claude al celui care apasă butonul. Claude cere o singură dată permisiunea.
- **Conținut comun**: tot ce se adaugă (surse, capitole, grile, carduri, sinteze, podcasturi) e salvat în pagină și e văzut de toți colegii care o deschid, autentificați în Claude.
- **Cine poate adăuga material**: proprietarul și cei cu acces de Contributor sau mai mare. Colegii cu acces de vizualizare învață din tot ce s-a adăugat.
- **Progresul personal** la carduri și la grile rămâne al fiecăruia: se păstrează în browser și în contul lui.
- **Deschisă în afara Claude**, de exemplu `index.html` local sau prin GitHub Pages, merge partea originală, fără funcțiile AI și fără materialul comun.

## Structura

```
app/template.html    stilurile și structura paginii (aplicația originală + panourile noi)
app/base-data.js     conținutul original: SECTIONS, CARDS, CASES, RECALL, CONTRASTS, EXPLAIN, GRILE, CHAPTERS, SOURCES
app/app.js           logica: repetiție spațiată, grile, cazuri, recall, explicații, deck + surse, capitole, AI, sinteze, podcast
build.py             construiește pagina
dist/semiologie-recall.html   pagina publicată în Claude
index.html           aceeași pagină ca document complet
```

Comanda `python3 build.py` reconstruiește pagina după orice modificare în `app/`. Librăriile (pdf.js 3.11.174, mammoth 1.6.0, marked 12.0.2, DOMPurify 3.1.6) se încarcă de pe cdn.jsdelivr.net.
