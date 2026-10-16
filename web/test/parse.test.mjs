import { parseScan } from '../src/lib/parse.js';
import assert from 'node:assert';

let n = 0;
function eq(a, b, label) { n++; assert.deepStrictEqual(a, b, label); console.log('ok', n, label); }
function throwsPartial(fn, label) {
  n++;
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err && err.partial === true, label + ' (atteso errore partial)');
  console.log('ok', n, label);
}

// Code32 fustella
eq(parseScan('A012345678').aic, '012345678', 'code32 A+9');
eq(parseScan('036631017').aic, '036631017', 'code32 9 cifre');

// GS1 italiano (DM 6/3/2025): AI 716 per l'AIC, non 7001.
const GS = String.fromCharCode(29);
const it = ']d201080320890012362101234567890' + GS + '1727103010112345678' + GS + "716098765432";
const gIt = parseScan(it);
eq(gIt.aic, '098765432', 'gs1-it aic da AI 716');
eq(gIt.gtin, '08032089001236', 'gs1-it gtin');
eq(gIt.lotto, '112345678', 'gs1-it lotto');
eq(gIt.scadenza, '2027-10-30', 'gs1-it scadenza');
eq(gIt.seriale, '01234567890', 'gs1-it seriale');

// GS1 con parentesi: AIC via 716 (IT) e via 7001 (compatibilità estero/demo)
const g = parseScan('(01)08001234567890(17)260131(10)LOT77(21)SN1(716)036631017');
eq(g.gtin, '08001234567890', 'gs1 gtin');
eq(g.lotto, 'LOT77', 'gs1 lotto');
eq(g.scadenza, '2026-01-31', 'gs1 scadenza');
eq(g.seriale, 'SN1', 'gs1 seriale');
eq(g.aic, '036631017', 'gs1 aic da 716');
eq(parseScan('(01)08001234567890(7001)036631017').aic, '036631017', 'gs1 aic da 7001 (legacy)');

// Riga HRI in chiaro letta dallo scanner al posto del matrix
eq(parseScan('PC:08032089001236 SN:ABC LOTTO:182M0L SCAD:30/10/2027 AIC:026089110').aic, '026089110', 'hri aic in chiaro');

// Lettura parziale dello scanner (solo lotto beccato a metà frame):
// niente errore criptico, ma errore "partial" gestito dalla UI.
throwsPartial(() => parseScan('182M0L'), 'frammento lotto -> partial');

// GS1 senza AIC: ritorna GTIN (risoluzione via AIFA)
const g2 = parseScan('(01)08001234567890(17)260131(10)ABC');
eq(g2.gtin, '08001234567890', 'gs1 solo gtin');

console.log('Tutti i test parser OK:', n);
