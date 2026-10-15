import assert from 'node:assert';
import { normalizeAic, pickContentItem, pickConfezione, mapAifaItem } from '../src/index.js';

let n = 0;
function eq(a, b, label) { n++; assert.deepStrictEqual(a, b, label); console.log('ok', n, label); }

const ITEM = {
  id: '0000017747',
  principiAttiviIt: ['ACIDO CLAVULANICO', 'AMOXICILLINA'],
  confezioni: [
    {
      aic: '026089110',
      denominazionePackage: '«bambini» flacone da 35 ml con siringa dosatrice',
      flagCommercio: 0,
      flagCarenza: 1,
      carenzaMotivazione: 'Cessata commercializzazione definitiva',
      descrizioniRf: ['Soggetto a Prescrizione Medica'],
      descrizioneStatoAmministrativo: 'AUTORIZZATA',
      classeRimborsabilita: 'A',
      descrizioneRimborsabilita: 'A TOTALE CARICO DEL SSN.'
    }
  ],
  medicinale: {
    aic6: 26089,
    denominazioneMedicinale: 'AUGMENTIN',
    codiceSis: 200,
    aziendaTitolare: 'GLAXOSMITHKLINE S.P.A.',
    statoAmministrativo: 'A',
    commercio: '0'
  },
  formaFarmaceutica: 'Polvere per sospensione orale',
  descrizioneFormaDosaggio: '400 mg / 5 ml',
  codiceAtc: 'J01CR02',
  descrizioneAtc: 'Penicilline in associazione',
  vieSomministrazione: ['ORALE'],
  flagFI: true,
  flagRCP: true
};
const ALTRO = { id: '0000099999', medicinale: { denominazioneMedicinale: 'ALTRO' }, confezioni: [{ aic: '099999999' }] };

// normalizeAic
eq(normalizeAic('A036631017'), '036631017', 'normalizza A0+9 cifre');
eq(normalizeAic('  026 089 110 '), '026089110', 'normalizza spazi');
eq(normalizeAic('abc'), '', 'normalizza non numerico');

// selezione item
eq(pickContentItem('026089110', [ALTRO, ITEM]), ITEM, 'item esatto anche con piu risultati');
eq(pickContentItem('026089110', [ITEM]), ITEM, 'item unico');
eq(pickContentItem('011111111', [ALTRO, ITEM]), null, 'nessun match con piu item -> null');
eq(pickContentItem('011111111', []), null, 'nessun contenuto -> null');
eq(pickConfezione('026089110', ITEM).aic, '026089110', 'confezione esatta');

// mapping normalizzato
const d = mapAifaItem('026089110', ITEM, 'aifa-worker');
eq(d.nome, 'AUGMENTIN — 400 mg / 5 ml', 'nome = denominazione + dosaggio');
eq(d.principioAttivo, 'ACIDO CLAVULANICO + AMOXICILLINA', 'principi attivi');
eq(d.titolare, 'GLAXOSMITHKLINE S.P.A.', 'titolare');
eq(d.stato, 'AUTORIZZATA', 'stato amministrativo');
eq(d.inCommercio, false, 'fuori commercio (flagCommercio=0)');
eq(d.prescrizione, 'Soggetto a Prescrizione Medica', 'prescrizione');
eq(d.rimborso, 'A TOTALE CARICO DEL SSN.', 'rimborso');
eq(d.carenza, 'Cessata commercializzazione definitiva', 'carenza');
eq(d.fogliettoUrl, 'https://api.aifa.gov.it/aifa-bdf-eif-be/1.0.0/organizzazione/200/farmaci/26089/stampati?ts=FI', 'link foglietto (FI)');
eq(d.rcpUrl, 'https://api.aifa.gov.it/aifa-bdf-eif-be/1.0.0/organizzazione/200/farmaci/26089/stampati?ts=RCP', 'link RCP');
eq(d.schedaUrl, 'https://medicinali.aifa.gov.it/#/dettaglio/0000017747', 'scheda AIFA');
eq(d.fonte, 'aifa-worker', 'fonte');

// senza link documentali (flag assenti)
const noDocs = mapAifaItem('026089110', Object.assign({}, ITEM, { flagFI: false, flagRCP: false }));
eq(noDocs.fogliettoUrl, '', 'nessun link FI se flag false');
eq(noDocs.rcpUrl, '', 'nessun link RCP se flag false');
eq(noDocs.schedaUrl, 'https://medicinali.aifa.gov.it/#/dettaglio/0000017747', 'scheda sempre presente');

// senza medicinale (payload ridotto)
const ridotto = mapAifaItem('012345678', { confezioni: [] });
eq(ridotto.nome, 'Farmaco AIC 012345678', 'nome placeholder');
eq(ridotto.principioAttivo, '', 'principio vuoto');

console.log('Tutti i test worker OK:', n);
