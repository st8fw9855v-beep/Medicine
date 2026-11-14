# Studiu Medicină

O aplicație web pentru învățat pe grile, construită în jurul Claude API. Rulează în întregime în browser și nu are nevoie de server propriu.

## Ce face

Ideile de învățare (repetiție spațiată, recall liber, cazuri amestecate, explicații de mecanism, simulări de examen, chei verificate față de curs) sunt preluate din pagina „Semiologie Recall” și generalizate pentru orice materie.

1. **Surse**: încarci materiale de curs și culegeri de grile în format PDF (inclusiv scanat), DOCX, TXT/MD, HTML sau imagini. Poți și lipi text direct. PDF-urile scanate și pozele sunt transcrise automat cu AI. Paginile HTML de studiu de tip „Semiologie Recall” (cu `GRILE`, `CARDS`, `CASES`, `RECALL`, `CONTRASTS`, `EXPLAIN`) se importă direct, fără AI, păstrând notele și cheile corectate.
2. **Capitole**: AI-ul citește toate materialele și împarte materia pe capitole, cu rezumat și subteme. Fiecare capitol rămâne legat de pasajele exacte din surse, iar capitolele se pot redenumi, uni sau șterge. Dacă ai doar grile importate, poți crea capitolele din etichetele lor. Butonul **⚡ Pregătește tot** face, pentru un capitol, toți pașii de mai jos dintr-o dată.
3. **Repetiție**: flashcard-uri cu repetiție spațiată, notate Din nou / Greu / Bine / Ușor, cu tastele Spațiu și 1–4 și o limită de carduri noi pe zi. Cardurile se generează pe capitole după reguli clare: o întrebare pe card, discriminatori, praguri numerice. Linkul „De ce?” duce la explicația secțiunii.
4. **Banca de grile**:
   - grilele din surse sunt extrase și repartizate automat pe capitole. Dacă sursa are cheie de răspunsuri, aplicația o folosește. Dacă nu, răspunsul e dedus de AI și grila primește marcajul „răspuns dedus";
   - butonul „Completează” generează grile noi, în stil CS/CM, pe baza textului capitolului, până se ajunge la ținta setată (implicit **100/capitol**). Grilele deja existente nu se repetă;
   - **Verifică cheile** compară cheile grilelor cu cursul. Când o cheie contrazice cursul, câștigă cursul: grila primește marcajul „cheie corectată” și o notă explicativă;
   - grilele se pot edita, șterge sau adăuga manual.
5. **Test**: **exersare** cu feedback după fiecare grilă sau **simulare de examen**, cu corectarea la final, navigare înapoi și scor pe capitole. Filtrele: capitol, sursă, CS/CM, „doar greșelile mele”, „doar cu notă sau cheie corectată”.
6. **Cazuri**: cazuri clinice scurte amestecate din toate capitolele. Cazurile sar între teme, ca să exersezi alegerea conceptului potrivit.
7. **Recall**: fișe de „blurting” (scrii din memorie, apoi bifezi din checklist) și tabele de contrast între entitățile care se confundă.
8. **Explicații**: mecanismele din spatele semnelor, pe secțiuni.
9. **Sinteze**: pentru fiecare capitol se generează o sinteză completă de examen, cu noțiuni-cheie, clasificări, tabele comparative, cifre de reținut, mnemotehnici, capcanele frecvente la grile și întrebări de autoevaluare. Sinteza se poate descărca în format .md sau printa ca PDF.
10. **Podcast**: un dialog scurt de 3–12 minute între doi prezentatori, despre ce trebuie ținut minte din capitol. E citit cu vocea sintetică a browserului, iar scenariul se poate descărca.
11. **Metodă**: ghidul de studiu (bucla pre-test → citire → recall → carduri → mecanism → repetiție → cazuri amestecate) și regulile pentru carduri.

## Cum se folosește

1. Deschide aplicația. Poți activa GitHub Pages pe acest repo sau o poți porni local, de exemplu cu `python3 -m http.server` în acest folder, apoi deschizi `http://localhost:8000`.
2. În **Setări**, introdu o cheie Claude API (din [Claude Console](https://platform.claude.com/settings/keys)) și alege modelul. Implicit e Claude Opus 5.5.
3. Mergi pe tabul **Surse**, apoi **Capitole** → „Segmentează”, apoi **Surse** → „Extrage grilele”, apoi **Capitole** → „⚡ Pregătește tot” (sau pas cu pas, din fiecare tab).
4. Pentru a importa „Semiologie Recall”: deschide `https://www.livesend.io/api/viewer/skstnh2jtn`, salvează pagina (Ctrl+S, „doar HTML”) și încarc-o în **Surse**.

> Fișierele trebuie servite prin HTTP. Dublu-clic pe `index.html` (`file://`) nu funcționează, pentru că browserul blochează modulele JS.

## Date și confidențialitate

- Toate datele (surse, grile, sinteze) se salvează **local în browser**, în IndexedDB. Pentru siguranță, folosește din când în când **Setări → Exportă backup**.
- Cheia API se păstrează în `localStorage` și e trimisă doar la `api.anthropic.com`. Nu folosi aplicația pe un calculator public.
- Fiecare operație AI consumă credite din contul tău Anthropic. Generarea a 100 de grile pentru un capitol înseamnă aproximativ 7 apeluri, iar costul depinde de mărimea capitolului (textul capitolului este cache-uit între apeluri).

## Structura proiectului

```
index.html          interfața (taburi)
css/style.css       stiluri (tema luminoasă/întunecată)
js/core.js          starea aplicației, job-uri și utilitare comune
js/app.js           surse, capitole, banca de grile, test, sinteze, podcast, setări
js/study.js         repetiție spațiată, cazuri, recall & contraste, explicații, metodă
js/importers.js     importul structurat al paginilor de studiu (fără a executa codul lor)
js/pipelines.js     prompturile și fluxurile AI
js/ai.js            clientul Claude API (streaming + ieșiri JSON structurate)
js/parse.js         extragerea textului din PDF/DOCX/etc.
js/db.js            stocarea în IndexedDB
vendor/             biblioteci incluse local: Anthropic SDK 1.3.0, pdf.js 6.4.299, mammoth 1.13.0, marked 18.1.2, DOMPurify 3.4.17
```
