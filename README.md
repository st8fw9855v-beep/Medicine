# Semiologie Recall+

Aplicația **Semiologie Recall** conține un deck cu repetiție spațiată, 868 de grile cu chei verificate față de cursul din 2022, cazuri clinice amestecate, fișe de recall, tabele de contrast și explicații de mecanism. Această versiune o extinde și o face o pagină pe care o deschizi și o trimiți colegilor printr-un link.

## Ce conține

- **Materii**: Semiologie medicală, Semiologie chirurgicală, Fiziopatologie, Farmacologie și Anatomie patologică (Morfopatologie). Materia se alege din bara de sus, iar fiecare tab arată doar conținutul ei. Conținutul original Semiologie Recall face parte din Semiologie medicală.
- **Review**: carduri cu repetiție spațiată (Space, apoi 1–4), plus un buton care scrie carduri noi pentru capitolul ales.
- **Questions**: exersare cu feedback după fiecare grilă sau simulare de examen. Filtrele: capitol, sursă, CS/CM, greșelile mele, chei corectate.
- **Cases**: cazuri clinice amestecate.
- **Summaries**: o sinteză de examen pentru fiecare capitol.
- **Podcast**: un dialog scurt despre ce trebuie ținut minte, citit cu voci Claude.
- **Course**: încarci cursul și băncile de grile ale materiei.
  - Cursul e împărțit pe capitole.
  - Grilele potrivite din bancă trec în capitolele noi.
  - **Fill to 100** scrie grile noi până la cel puțin 100 pe capitol.
  - **Check keys** verifică cheile față de curs.
  - **⚡ Prepare everything** face toți pașii pentru un capitol.
- **⚙**: țintele (grile și carduri pe capitol), completarea automată și backup-ul.

## Cum funcționează ca pagină Claude

- **Fără cheie API**: funcțiile AI folosesc contul Claude al celui care apasă butonul. Claude cere o singură dată permisiunea.
- **Conținut comun**: tot ce se adaugă (surse, capitole, grile, carduri, sinteze, podcasturi) e salvat în pagină și e văzut de toți colegii care o deschid, autentificați în Claude.
- **Cine poate adăuga material**: proprietarul și cei cu acces de Contributor sau mai mare. Colegii cu acces de vizualizare învață din tot ce s-a adăugat.
- **Progresul personal** la carduri și la grile rămâne al fiecăruia: se păstrează în browser și în contul lui.
- **Deschisă în afara Claude**, de exemplu `index.html` local sau prin GitHub Pages, merge partea originală, fără funcțiile AI și fără materialul comun.

## Banca de grile din Google Drive

Grilele din anul III din folderul de Drive al cursului (Farmacologie, Fiziopatologie, Morfopatologie, Semiologie medicală și chirurgicală) sunt încărcate în pagină ca „bancă de grile”:
- **Citirea:** pagina le citește cu Claude, pe contul proprietarului, la prima deschidere și continuă de unde a rămas dacă e închisă.
- **Așteptarea pe materii:** grilele așteaptă în bancă, pe materii, până apare capitolul lor.
- **Când încarci un curs:** după ce cursul e împărțit pe capitole, grilele potrivite din bancă trec automat în capitolele noi. Capitolele noi sunt apoi completate până la 100 de grile; poți dezactiva asta din Settings.

Scriptul `tools/drive_import.py` refă importul pentru alt an sau alt folder.

## Structura

```
app/template.html    stilurile și structura paginii (aplicația originală + panourile noi)
app/base-data.js     conținutul original: SECTIONS, CARDS, CASES, RECALL, CONTRASTS, EXPLAIN, GRILE, CHAPTERS, SOURCES
app/app.js           logica: repetiție spațiată, grile, cazuri, recall, explicații, deck + surse, capitole, AI, sinteze, podcast
build.py             construiește pagina
tools/drive_import.py  pregătește băncile de grile dintr-un folder Google Drive
dist/semiologie-recall.html   pagina publicată în Claude
index.html           aceeași pagină ca document complet
```

Comanda `python3 build.py` reconstruiește pagina după orice modificare în `app/`. Librăriile (pdf.js 3.11.174, mammoth 1.6.0, marked 12.0.2, DOMPurify 3.1.6) se încarcă de pe cdn.jsdelivr.net.
