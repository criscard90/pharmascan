import './style.css';
import { parseScan } from './lib/parse.js';
import { lookupAifa, getWorkerUrl, setWorkerUrl, getFunctionUrl, setFunctionUrl, normalizeLookupAic } from './lib/aifa.js';
import { initStore, storeMode, saveMedicine, listMedicines, removeMedicine } from './lib/store.js';
import { startScanner, stopScanner, toggleTorch } from './lib/scanner.js';
let lastDrug = null; let lastParse = null; let torchOn = false; let busy = false;
document.querySelector('#app').innerHTML = [
'<header class="top"><div class="brand"><span class="cross" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><rect x="9" y="3" width="6" height="18" rx="1.5" fill="#fff"/><rect x="3" y="9" width="18" height="6" rx="1.5" fill="#fff"/></svg></span><span><strong>PharmaScan</strong><small>Armadietto farmaci &bull; dati AIFA</small></span></div><div id="mode" class="pill">locale</div></header>',
'<main>',
'<section class="hero"><div><h1>Riconosci il farmaco dal codice</h1><p>Scansiona fustella o DataMatrix, oppure digita l\'AIC a 9 cifre. Dati ufficiali AIFA via proxy anti-CORS.</p></div><div class="hero-badges"><span class="badge">AIFA</span><span class="badge ghost">PWA offline</span><span class="badge ghost">AIC &bull; GTIN &bull; Lotto</span></div></section>',
'<section class="card"><div class="card-head"><span class="step">1</span><h2>Scansiona o cerca</h2></div>',
'<div class="video-wrap"><video id="cam" playsinline muted></video><div class="frame"><span></span></div><div id="scanState" class="scan-state">Fotocamera spenta</div></div>',
'<div class="row"><button id="bStart" class="primary">Avvia camera</button><button id="bStop">Stop</button><button id="bTorch">Flash</button></div>',
'<div class="row manual-row"><input id="manual" inputmode="numeric" maxlength="12" placeholder="AIC es. 036631017 oppure A036631017" /><button id="bManual" class="primary ghost-btn">Cerca</button></div>',
'<p id="scanMsg" class="msg" role="status"></p></section>',
'<section class="card"><div class="card-head"><span class="step">2</span><h2>Farmaco <span class="muted-sm">fonte AIFA</span></h2><span id="srcBadge" class="src"></span></div>',
'<div id="drug" class="drug"><div class="empty"><div class="empty-ico">+</div><p>Nessuna ricerca ancora.<br/><span>Cerca un AIC per vedere nome, principio attivo e foglietto.</span></p></div></div>',
'<div class="row"><button id="bSave" class="primary" disabled>Salva in armadietto</button></div></section>',
'<section class="card"><div class="card-head"><span class="step">3</span><h2>Armadietto <span id="cabCount" class="count"></span></h2></div>',
'<details class="cfg"><summary>Configurazione proxy AIFA (anti-CORS)</summary>',
'<label>Worker Cloudflare URL<input id="wUrl" placeholder="https://pharmascan-aifa.<tuo>.workers.dev" /></label>',
'<div class="row"><button id="bW">Salva Worker</button><button id="bWTest">Test Worker</button></div>',
'<label class="legacy">Cloud Function legacy (opz.)<input id="fnUrl" placeholder="URL Cloud Function AIFA (opz.)" /></label>',
'<div class="row"><button id="bFn">OK</button></div>',
'<p class="hint">Senza Worker l\'app prova la chiamata diretta AIFA (spesso bloccata da CORS) e poi mostra DEMO/sconosciuto. Deploy del Worker: vedi <code>worker/</code>.</p>',
'<p id="wMsg" class="msg"></p></details>',
'<div id="list" class="list"></div></section>',
'</main><footer>PharmaScan &bull; PWA offline-ready &bull; AIC come ID &bull; AIFA via Cloudflare Worker</footer>'
].join('');
const $ = (id) => document.getElementById(id);
const video = $('cam'), msg = $('scanMsg'), drugBox = $('drug'), listBox = $('list');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function setMsg(t, kind) { msg.textContent = t || ''; msg.className = 'msg' + (kind ? ' ' + kind : ''); }
function statoClass(s) { const x = String(s || '').toLowerCase(); if (/in commercio|autorizzata/.test(x)) return 'ok'; if (/carenza|cessata|revoc|non in commercio|sospes/.test(x)) return 'warn'; return ''; }
function showSkeleton() { drugBox.innerHTML = '<div class="skel"><div class="sk-line big"></div><div class="sk-line"></div><div class="sk-line short"></div></div>'; }
function showDrug(d, p) {
  lastDrug = d;
  $('bSave').disabled = !d || !!d.notFound;
  const badge = $('srcBadge');
  if (!d) { drugBox.innerHTML = '<div class="empty"><div class="empty-ico">+</div><p>Nessuna ricerca ancora.</p></div>'; badge.textContent = ''; badge.className = 'src'; return; }
  badge.textContent = d.fonte || '';
  badge.className = 'src ' + (d.fonte === 'aifa-worker' ? 'ok' : d.fonte === 'demo' ? 'demo' : d.notFound ? 'err' : '');
  if (d.notFound) {
    drugBox.innerHTML = '<div class="notfound"><b>' + esc(d.nome) + '</b><p>' + esc(d.nota || '') + '</p>' + (p && p.lotto ? '<p>Lotto rilevato: <b>' + esc(p.lotto) + '</b>' + (p.scadenza ? ' &bull; Scade <b>' + esc(p.scadenza) + '</b>' : '') + '</p>' : '') + '</div>';
    return;
  }
  const rows = [
    ['Principio attivo', d.principioAttivo], ['Titolare', d.titolare], ['Forma', d.formaFarmaceutica], ['Dosaggio', d.dosaggio], ['Confezione', d.confezione], ['Rimborso', d.rimborso || d.classeRimborsabilita], ['Prescrizione', d.prescrizione], ['Via', d.viaSomministrazione], ['ATC', d.atc]
  ].filter((r) => r[1]);
  drugBox.innerHTML = '<div class="drug-top"><div><div class="drug-name">' + esc(d.nome) + '</div><div class="drug-aic">AIC <code>' + esc(d.aic) + '</code>' + (p && p.gtin ? ' &bull; GTIN <code>' + esc(p.gtin) + '</code>' : '') + '</div></div>' + (d.stato ? '<span class="stato ' + statoClass(d.stato) + '">' + esc(d.stato) + '</span>' : '') + '</div>' +
    (d.carenza ? '<div class="alert">' + esc(d.carenza) + '</div>' : '') +
    (rows.length ? '<dl class="grid">' + rows.map((r) => '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl>' : '') +
    ((p && (p.lotto || p.scadenza || p.seriale)) ? '<div class="scan-tags">' + (p.lotto ? '<span>Lotto <b>' + esc(p.lotto) + '</b></span>' : '') + (p.scadenza ? '<span>Scade <b>' + esc(p.scadenza) + '</b></span>' : '') + (p.seriale ? '<span>S/N <b>' + esc(p.seriale) + '</b></span>' : '') + '</div>' : '') +
    '<div class="links">' + (d.fogliettoUrl ? '<a href="' + esc(d.fogliettoUrl) + '" target="_blank" rel="noopener">Foglietto illustrativo</a>' : '') + (d.rcpUrl ? '<a href="' + esc(d.rcpUrl) + '" target="_blank" rel="noopener">RCP medica</a>' : '') + (d.schedaUrl ? '<a href="' + esc(d.schedaUrl) + '" target="_blank" rel="noopener">Scheda AIFA</a>' : '') + '</div>';
}
async function handleRaw(raw) {
  if (busy) return; busy = true;
  try {
    setMsg('Lettura codice...');
    const p = parseScan(raw);
    lastParse = p;
    const aic = p.aic || normalizeLookupAic(raw);
    if (!/^[0-9]{9}$/.test(aic)) throw new Error('AIC non trovato nel codice. Riprova o digita 9 cifre.');
    setMsg('Letto AIC ' + aic + (p.gtin ? ' (GTIN ' + p.gtin + ')' : '') + ' \u2014 interrogo AIFA...');
    showSkeleton();
    const d = await lookupAifa(aic, p);
    showDrug(d, p);
    if (d && !d.notFound) setMsg('Trovato: ' + d.nome + ' [' + (d.fonte || '?') + ']', 'ok');
    else setMsg((d && d.nota) || 'AIC non trovato in AIFA.', 'err');
  } catch (e) { setMsg('Errore: ' + e.message, 'err'); }
  finally { busy = false; }
}
async function refresh() {
  const items = await listMedicines();
  $('mode').textContent = storeMode();
  $('cabCount').textContent = items.length ? items.length : '';
  if (!items.length) { listBox.innerHTML = '<div class="empty small"><p>Armadietto vuoto.<br/><span>Cerca un farmaco e premi \u201cSalva in armadietto\u201d.</span></p></div>'; return; }
  listBox.innerHTML = items.map((m) => '<div class="item"><div class="item-ico">+</div><div class="item-body"><b>' + esc(m.nome || ('AIC ' + m.aic)) + '</b><span class="muted">AIC ' + esc(m.aic) + (m.lotto ? ' &bull; lotto ' + esc(m.lotto) : '') + (m.scadenza ? ' &bull; scade ' + esc(m.scadenza) : '') + '</span></div><button data-del="' + esc(m.aic) + '" aria-label="Elimina">&times;</button></div>').join('');
  listBox.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await removeMedicine(b.getAttribute('data-del')); refresh(); }; });
}
$('bStart').onclick = async () => {
  setMsg('Avvio fotocamera...'); $('scanState').textContent = 'Avvio...';
  try { const info = await startScanner(video, handleRaw, () => {}); $('scanState').textContent = 'Inquadra il DataMatrix nel riquadro'; setMsg('Inquadra il DataMatrix nel riquadro...' + (info.cameraLabel ? ' [' + info.cameraLabel + ']' : '')); }
  catch (e) { $('scanState').textContent = 'Fotocamera non disponibile'; setMsg('Camera non disponibile: ' + e.message + ' (serve HTTPS)', 'err'); }
};
$('bStop').onclick = () => { stopScanner(); $('scanState').textContent = 'Fotocamera spenta'; setMsg('Scanner fermato.'); };
$('bTorch').onclick = async () => { try { torchOn = !torchOn; await toggleTorch(torchOn); setMsg(torchOn ? 'Flash ON' : 'Flash OFF'); } catch (e) { setMsg('Flash non supportato', 'err'); } };
$('bManual').onclick = () => { const v = $('manual').value.trim(); if (v) handleRaw(v); else setMsg('Digita un AIC (9 cifre), es. 036631017', 'err'); };
$('manual').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bManual').click(); });
$('bSave').onclick = async () => {
  if (!lastDrug || lastDrug.notFound) return;
  const rec = { ...lastDrug, lotto: (lastParse && lastParse.lotto) || lastDrug.lotto || null, scadenza: (lastParse && lastParse.scadenza) || lastDrug.scadenza || null, seriale: (lastParse && lastParse.seriale) || null, gtin: (lastParse && lastParse.gtin) || null, scannedAt: new Date().toISOString() };
  await saveMedicine(rec);
  setMsg('Salvato AIC ' + lastDrug.aic, 'ok'); refresh();
};
$('bW').onclick = () => { setWorkerUrl($('wUrl').value.trim()); $('wMsg').textContent = 'URL Worker salvato.'; setMsg('URL Worker salvato. Riprova la ricerca.', 'ok'); };
$('bWTest').onclick = async () => {
  const u = $('wUrl').value.trim() || getWorkerUrl();
  if (!u) { $('wMsg').textContent = 'Inserisci prima l\'URL del Worker.'; return; }
  $('wMsg').textContent = 'Test in corso...';
  try { const r = await fetch(u.replace(/\/$/, '') + '/?aic=036631017', { headers: { Accept: 'application/json' } }); const j = await r.json(); $('wMsg').textContent = r.ok ? ('OK: ' + (j.nome || j.aic)) : ('Errore ' + r.status + ': ' + (j.error || '')); }
  catch (e) { $('wMsg').textContent = 'Worker non raggiungibile: ' + e.message; }
};
$('bFn').onclick = () => { setFunctionUrl($('fnUrl').value.trim()); $('wMsg').textContent = 'URL function salvato.'; };
$('wUrl').value = getWorkerUrl();
$('fnUrl').value = getFunctionUrl();
await initStore();
refresh();
if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register(new URL('sw.js', window.location.href), { scope: new URL('./', window.location.href) }); } catch (e) {} }
