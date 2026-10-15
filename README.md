# PharmaScan — PWA Scansione Farmaci e AIFA

Spec: `Specifiche Tecniche - App PWA Scansione Farmaci e AIFA.docx` (§1-§5).

## Struttura
- `web/` — PWA Vite + Vanilla JS (manifest, SW, scanner ZXing, parsing AIC/GS1, store Firestore+locale)
  - lookup AIFA **diretto** (`web/src/lib/aifa.js`): l'API open-data
    `https://api.aifa.gov.it/aifa-bdf-eif-be/1.0.0` espone `Access-Control-Allow-Origin: *`,
    quindi **non serve nessun proxy/worker anti-CORS**.
- `worker/` — legacy non usato (tenuto solo per riferimento, non referenziato dalla UI)
- `functions/` — legacy non usato (tenuto solo per riferimento, non referenziato dalla UI)

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
- Tocca *Avvia camera* → consenti l'accesso alla fotocamera → inquadra fustella/DataMatrix.
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

## URL AIFA (diretto, nessun proxy da configurare)
Nessuna configurazione richiesta: l'app chiama direttamente
`https://api.aifa.gov.it/aifa-bdf-eif-be/1.0.0/formadosaggio/ricerca?query={AIC}&page=0`
(verificato: risponde con `Access-Control-Allow-Origin: *`, quindi niente CORS da aggirare).
Senza rete, il lookup mostra DEMO/sconosciuto ma AIC+lotto+scadenza vengono salvati comunque.

## Test parser (Code32 + GS1 italiano DM 6/3/2025 con AI 716)
```bash
cd web
node test/parse.test.mjs
```

## Deploy hosting + functions
```bash
firebase deploy --only hosting,functions,firestore:rules
```
