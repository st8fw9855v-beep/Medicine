# Semiologie Recall+

Aplicația **Semiologie Recall** (deck cu repetiție spațiată, 868 de grile cu chei verificate față de cursul din 2022, cazuri clinice amestecate, fișe de recall, tabele de contrast și explicații de mecanism), extinsă cu:

1. **Surse & capitole**: încarci materiale de curs și bănci de grile în orice format: PDF (inclusiv scanat), DOCX, TXT/MD, HTML, poze de pagini sau text lipit.
   - AI-ul împarte materialul nou pe capitole. Când materialul ține de un capitol existent (Cap. I, II, III…), îl atașează acelui capitol în loc să creeze unul dublat.
   - Băncile de grile sunt citite, curățate de duplicate (inclusiv față de cele 868 de grile originale) și repartizate pe capitole.
   - **Fill to 100** scrie grile noi în același stil (complement simplu/multiplu), bazate pe cursul capitolului, până la cel puțin 100 pe capitol. Ținta se schimbă din Settings.
   - **Check keys** verifică cheile din băncile încărcate față de curs. Cursul are prioritate: grila primește marcajul „KEY CORRECTED” și o notă, la fel ca în aplicația originală.
   - **⚡ Prepare everything** face toate pașii pentru un capitol: verifică cheile, completează grilele și cardurile, apoi scrie cazuri, fișe de recall, explicații, sinteza și podcastul.
2. **Exam summaries**: o sinteză completă de examen pe capitol, cu definiții, clasificări, tabele, cifre de reținut, mnemotehnici, capcanele de la grile și autoevaluare. Se poate descărca în .md sau printa ca PDF.
3. **Podcast**: un dialog scurt (3–12 min) între Ana și Mihai despre ce trebuie ținut minte din capitol, citit cu vocea browserului. Scenariul se poate descărca.
4. Tab-urile originale funcționează pentru orice capitol nou:
   - **Review** și **Deck**: cardurile noi intră în același program de repetiție;
   - **Exam questions**: filtrele pe capitol și sursă includ conținutul nou;
   - **Cases**, **Recall & contrasts** și **Explanations** au acum un selector de capitol și un buton care scrie conținut nou pentru capitolul ales.

Conținutul original al aplicației se află neschimbat în `js/base-data.js`. Tot ce adaugi se păstrează separat, în browser.

## Pornire

1. Servește folderul prin HTTP, de exemplu cu GitHub Pages sau cu `python3 -m http.server` (apoi deschizi `http://localhost:8000`). Deschiderea directă a `index.html` cu dublu-clic nu funcționează.
2. Funcțiile originale merg imediat, fără cont. Pentru funcțiile AI, introdu o cheie Claude API în **Settings** (din [Claude Console](https://platform.claude.com/settings/keys)). Modelul implicit e Claude Opus 5.5.
3. În **Sources & chapters**, încarcă materialele și grilele. Împărțirea pe capitole și sortarea grilelor pornesc automat, apoi apeși **Fill to 100** sau **⚡ Prepare everything**.

## Date

- Progresul la repetiție și la grile se salvează ca în original, în `localStorage`.
- Sursele, capitolele, grilele, cardurile, sintezele și podcasturile pe care le adaugi se salvează în IndexedDB. Fă din când în când **Settings → Export backup**.
- Cheia API rămâne în browser și e trimisă doar către `api.anthropic.com`. Fiecare acțiune AI consumă credite din contul tău Anthropic.

## Structura

```
index.html        aplicația originală (stiluri, antet, panouri) + panourile noi
css/plus.css      stilurile adăugate
js/base-data.js   conținutul original: SECTIONS, CARDS, CASES, RECALL, CONTRASTS, EXPLAIN, GRILE, CHAPTERS, SOURCES
js/main.js        logica originală (SRS, grile, cazuri, recall, explicații, deck) + surse, capitole, sinteze, podcast, setări
js/pipelines.js   prompturile și fluxurile AI (segmentare, extragere, generare, verificare chei, sinteze, podcast)
js/ai.js          clientul Claude API (streaming + JSON structurat)
js/parse.js       extragerea textului din PDF/DOCX/HTML
js/db.js          IndexedDB
vendor/           Anthropic SDK 1.3.0, pdf.js 6.4.299, mammoth 1.13.0, marked 18.1.2, DOMPurify 3.4.17
```
