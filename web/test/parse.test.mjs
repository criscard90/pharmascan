import { parseScan } from '../src/lib/parse.js';
import assert from 'node:assert';

let n = 0;
function eq(a, b, label) { n++; assert.deepStrictEqual(a, b, label); console.log('ok', n, label); }

// Code32 fustella
eq(parseScan('A012345678').aic, '012345678', 'code32 A+9');
eq(parseScan('036631017').aic, '036631017', 'code32 9 cifre');

// GS1 con parentesi: AIC via 7001 + lotto + scadenza + seriale
const g = parseScan('(01)08001234567890(17)260131(10)LOT77(21)SN1(7001)036631017');
eq(g.gtin, '08001234567890', 'gs1 gtin');
eq(g.lotto, 'LOT77', 'gs1 lotto');
eq(g.scadenza, '2026-01-31', 'gs1 scadenza');
eq(g.seriale, 'SN1', 'gs1 seriale');
eq(g.aic, '036631017', 'gs1 aic da 7001');

// GS1 senza AIC: ritorna GTIN (risoluzione via AIFA)
const g2 = parseScan('(01)08001234567890(17)260131(10)ABC');
eq(g2.gtin, '08001234567890', 'gs1 solo gtin');

console.log('Tutti i test parser OK:', n);
