# PharmaScan — PWA Scansione Farmaci e AIFA

Spec: `Specifiche Tecniche - App PWA Scansione Farmaci e AIFA.docx` (§1-§5).

## Struttura
- `web/` — PWA Vite + Vanilla JS (manifest, SW, scanner ZXing, parsing AIC/GS1, store Firestore+locale)
- `functions/` — Cloud Function `lookupAic` (middleware anti-CORS verso AIFA)

## Deploy su GitHub Pages (per provarla da mobile)

Si: GitHub Pages va benissimo — è **HTTPS**, quindi la fotocamera funziona da mobile.
Il repo ha già tutto: percorsi relativi (`base: './'`) + workflow `.github/workflows/deploy-pages.yml`
che a ogni push su `main` fa build di `web/`, test parser e pubblica `web/dist/`.

**Cosa devi fare (una tantum):**
1. Commit + push su `main`:
   ```bash
   git add -A
   git commit -m "PharmaScan PWA"
   git push -u origin main
   ```
2. Su GitHub: repo → **Settings → Pages** → *Source: **GitHub Actions*** (non "branch").
3. Al primo push con il workflow, la pagina Actions chiede l'approvazione → l'URL sarà
   `https://criscard90.github.io/pharmascan/`.

**Da mobile:**
- Apri quell'URL da **Chrome (Android)** o **Safari (iOS)**.
- Tocca *Avvia camera* → consenti l'accesso alla fotocamera → inquadra il DataMatrix nel riquadro centrale.
  (In alternativa digita l'AIC nel campo manuale: funziona anche da PC.)
- Menu browser → **"Aggiungi a schermata Home"** per usarla come app (offline via Service Worker).
- Senza config Firebase l'armadietto resta salvato **sul telefono** (localStorage); con le
  `VITE_FB_*` si sincronizza su Firestore.

**Nota Firebase su Pages:** le `VITE_FB_*` servono solo in build-time; per averle su Pages
aggiungi gli *Actions secrets* corrispondenti e un passo `env:` nel workflow, oppure resta
in modalità locale (nessuna configurazione richiesta).


## Config Firebase (opzionale — senza, l'app va in locale)
Crea `.env` in `web/` da `.env.example`:
```
VITE_FB_API_KEY=...
VITE_FB_AUTH=...
VITE_FB_PROJECT=...
```
L'armadietto usa Firestore (`armadietto/{AIC}`) con persistenza IndexedDB; senza config usa `localStorage`.

## URL Cloud Function AIFA (trasparente, zero-config per l'utente)

L'utente non deve incollare nessun URL: il campo resta solo in
*Impostazioni avanzate* per debug, mentre l'app prova in ordine:

1. override manuale `localStorage` (solo debug);
2. `VITE_AIFA_FN_URL` (build-time, es. secret `VITE_AIFA_FN_URL` su GitHub Pages);
3. same-origin `/api/lookupAic` — su Firebase Hosting il rewrite in
   `firebase.json` gira verso `lookupAic` senza CORS e senza URL visibile;
4. fallback demo/offline (`AIC+lotto+scadenza` salvati comunque).

Perché il proxy resta necessario: il browser blocca `fetch` diretto verso
`medicinali.aifa.gov.it` (manca `Access-Control-Allow-Origin`). Senza proxy,
`041962010` "funziona" solo in apparenza: ritorna
`Farmaco AIC 041962010 (dati da completare)` con `fonte: sconosciuto`
(nessun nome/principio/titolare reali).

Deploy trasparente consigliato per distribuzione:
```bash
firebase deploy --only hosting,functions,firestore:rules
```
Ogni client usa poi `/api/lookupAic?aic=...` sullo stesso dominio: nessun
campo da compilare.

## Test parser (Code32 + GS1)
```bash
cd web
node test/parse.test.mjs
```

## Deploy hosting + functions
```bash
firebase deploy --only hosting,functions,firestore:rules
```
