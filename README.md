# Semiologie Recall+

Aplicație de recapitulare pentru anul III de Medicină, pe materii: Semiologie medicală, Semiologie chirurgicală, Fiziopatologie, Farmacologie și Anatomie patologică. Pornește de la aplicația Semiologie Recall.

## Cum funcționează

1. **Documente** (primul tab): fiecare persoană își încarcă documentele pentru materia aleasă.
   - **Cursul**: carte, cursuri, LP-uri sau notițe, în format PDF (inclusiv scanat), Word, text sau poze.
   - **Grilele proprii**: opțional.
2. **Capitole**: cursul se împarte pe capitole. O carte cu capitole proprii păstrează capitolele cărții; un curs fără capitole (LP-uri, notițe) e grupat în capitole de ~50 de pagini, valoare care se schimbă din ⚙.
3. **Banca**: pentru fiecare capitol, aplicația alege din banca comună **doar** grilele, cardurile și cazurile care corespund documentului încărcat. Butonul „Caută din nou în bancă” repetă căutarea.
4. **Generare la cerere**: la fiecare capitol, butoanele „+ Grile”, „+ Carduri” și „+ Cazuri” (10, 20 sau 50) generează din documentul persoanei. Tot la cerere se fac „Sinteză”, „Podcast” și „Verifică cheile”, care verifică grilele alese față de cursul persoanei. Nimic nu se generează automat.
5. **Învățare**:
   - **Repetiție**: carduri cu repetiție spațiată;
   - **Grile**: exersare sau simulare de examen;
   - **Cazuri**: cazuri clinice;
   - **Sinteze** și **Podcast**: cu voci Claude.

## Date

- **Banca comună** (doar citire pentru toți, modificabilă doar de proprietar): cele 868 de grile, 295 de carduri și 36 de cazuri originale Semiologie Recall, plus grilele din Google Drive (anul III). Proprietarul adaugă fișiere în bancă din ⚙.
- **Datele fiecărei persoane sunt private**: documentele, capitolele, ce s-a ales din bancă, ce s-a generat și progresul.
  - Cu acces de Contributor sau mai mare, datele se salvează în contul persoanei.
  - Altfel, datele rămân în browserul persoanei.
- **AI**: funcțiile AI rulează pe contul Claude al persoanei care apasă butonul, fără cheie API.
- **LiveSend**: din ⚙, „Versiune pentru LiveSend (HTML)” salvează un fișier cu capitolele persoanei și tot ce a ales sau generat. Fișierul se poate pune pe livesend.io; acolo se poate învăța, dar fără funcțiile AI.

## Banca de grile din Google Drive

`tools/drive_import.py` pregătește băncile de grile dintr-un folder Drive (Farmacologie, Fiziopatologie, Morfopatologie, Semiologie medicală și chirurgicală). Pagina le citește cu Claude, pe contul proprietarului, la prima deschidere, și continuă de unde a rămas.

## Structura

```
app/template.html    stilurile și structura paginii
app/base-data.js     conținutul original Semiologie Recall: SECTIONS, CARDS, CASES, RECALL, CONTRASTS, EXPLAIN, GRILE, CHAPTERS, SOURCES
app/app.js           aplicația: documente, capitole, bancă, generare la cerere, repetiție, grile, cazuri, sinteze, podcast
build.py             construiește pagina
tools/drive_import.py  pregătește băncile de grile dintr-un folder Google Drive
dist/semiologie-recall.html   pagina publicată în Claude
index.html           aceeași pagină ca document complet
```

Comanda `python3 build.py` reconstruiește pagina după orice modificare în `app/`.
