import './style.css';
import { parseScan } from './lib/parse.js';
import { lookupAifa, getFunctionUrl, setFunctionUrl } from './lib/aifa.js';
import { initStore, storeMode, saveMedicine, listMedicines, removeMedicine } from './lib/store.js';
import { startScanner, stopScanner, toggleTorch } from './lib/scanner.js';

let lastDrug = null;
let torchOn = false;

document.querySelector('#app').innerHTML = [
'<header class="top"><div class="brand">PharmaScan</div><div id="mode" class="pill">locale</div></header>',
'<main>',
'<section class="card"><h2>1. Scansiona</h2>',
'<div class="video-wrap"><video id="cam" playsinline muted></video><div class="frame"></div></div>',
'<div class="row"><button id="bStart" class="primary">Avvia camera</button>',
'<button id="bStop">Stop</button><button id="bTorch">Flash</button></div>',
'<div class="row"><input id="manual" inputmode="numeric" placeholder="AIC es. 036631017" />',
'<button id="bManual">Cerca</button></div>',
'<p id="scanMsg" class="msg"></p></section>',
'<section class="card"><h2>2. Farmaco (AIFA)</h2>',
'<div id="drug" class="drug">Nessuna scansione.</div>',
'<div class="row"><button id="bSave" class="primary" disabled>Salva in armadietto</button></div></section>',
'<section class="card"><h2>3. Armadietto</h2>',
'<div class="row"><input id="fnUrl" placeholder="URL Cloud Function AIFA (opz.)" /><button id="bFn">OK</button></div>',
'<div id="list" class="list"></div></section>',
'</main><footer>PWA offline-ready - AIC come ID - AIFA via Cloud Function</footer>'
].join('');

const $ = function (id) { return document.getElementById(id); };
const video = $('cam'), msg = $('scanMsg'), drugBox = $('drug'), listBox = $('list');
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function showDrug(d, p) {
  lastDrug = d; $('bSave').disabled = !d;
  if (!d) { drugBox.textContent = 'Nessuna scansione.'; return; }
  drugBox.innerHTML = '<b>' + esc(d.nome) + '</b><br/>AIC: <code>' + esc(d.aic) + '</code> (' + esc(d.fonte || '') + ')' +
    (d.principioAttivo ? '<br/>Principio: ' + esc(d.principioAttivo) : '') +
    (d.titolare ? '<br/>Titolare: ' + esc(d.titolare) : '') +
    (d.stato ? '<br/>Stato: ' + esc(d.stato) : '') +
    (p && p.lotto ? '<br/>Lotto: ' + esc(p.lotto) : '') +
    (p && p.scadenza ? '<br/>Scadenza: ' + esc(p.scadenza) : '') +
    (d.fogliettoUrl ? '<br/><a href="' + esc(d.fogliettoUrl) + '" target="_blank">Foglietto / RCP</a>' : '');
}

async function handleRaw(raw) {
  try {
    const p = parseScan(raw);
    msg.textContent = 'Letto -> AIC ' + (p.aic || '?') + (p.gtin ? ' GTIN ' + p.gtin : '');
    const aic = p.aic || (p.gtin || '').slice(0, 9) || raw.replace(/\D/g, '').slice(0, 9);
    const d = await lookupAifa(aic, p);
    showDrug(d, p);
  } catch (e) { msg.textContent = 'Errore: ' + e.message; }
}

async function refresh() {
  const items = await listMedicines();
  $('mode').textContent = storeMode();
  if (!items.length) { listBox.innerHTML = '<p class="muted">Armadietto vuoto.</p>'; return; }
  listBox.innerHTML = items.map(function (m) {
    return '<div class="item"><div><b>' + esc(m.nome || m.aic) + '</b><br/><span class="muted">AIC ' + esc(m.aic) +
      (m.lotto ? ' lotto ' + esc(m.lotto) : '') + (m.scadenza ? ' scade ' + esc(m.scadenza) : '') + '</span></div>' +
      '<button data-del="' + esc(m.aic) + '">Elimina</button></div>';
  }).join('');
  listBox.querySelectorAll('[data-del]').forEach(function (b) {
    b.onclick = async function () { await removeMedicine(b.getAttribute('data-del')); refresh(); };
  });
}

$('bStart').onclick = async function () {
  msg.textContent = 'Avvio fotocamera...';
  try {
    const info = await startScanner(video, handleRaw, function () {});
    msg.textContent = 'Inquadra fustella o DataMatrix...' + (info.cameraLabel ? ' [' + info.cameraLabel + ']' : '');
  } catch (e) { msg.textContent = 'Camera non disponibile: ' + e.message + ' (serve HTTPS)'; }
};
$('bStop').onclick = function () { stopScanner(); msg.textContent = 'Scanner fermato.'; };
$('bTorch').onclick = async function () {
  try { torchOn = !torchOn; await toggleTorch(torchOn); msg.textContent = torchOn ? 'Flash ON' : 'Flash OFF'; }
  catch (e) { msg.textContent = 'Flash non supportato'; }
};
$('bManual').onclick = function () { const v = $('manual').value.trim(); if (v) handleRaw(v); };
$('bSave').onclick = async function () {
  if (!lastDrug) return;
  await saveMedicine(Object.assign({}, lastDrug, { scannedAt: new Date().toISOString() }));
  msg.textContent = 'Salvato AIC ' + lastDrug.aic; refresh();
};
$('bFn').onclick = function () { setFunctionUrl($('fnUrl').value.trim()); msg.textContent = 'URL function salvato.'; };

$('fnUrl').value = getFunctionUrl();
await initStore();
refresh();
if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register(new URL('sw.js', window.location.href), { scope: new URL('./', window.location.href) }); } catch (e) {} }
