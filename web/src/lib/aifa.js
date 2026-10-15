// PharmaScan - lookup AIFA diretto (niente proxy: l'API open-data espone CORS '*').
// Ordine: 1) API AIFA diretta 2) demo locale per gli AIC di esempio.
export function normalizeLookupAic(aic) {
  const d = String(aic == null ? '' : aic).replace(/\D/g, '');
  const nine = d.length > 9 ? d.slice(0, 9) : d;
  return nine.padStart(9, '0');
}
const DEMO = {
  '012345678': { nome: 'Paracetamolo 500 mg compresse (DEMO)', principioAttivo: 'Paracetamolo', titolare: 'Angelini (demo)', stato: 'In commercio (demo)', fogliettoUrl: 'https://medicinali.aifa.gov.it' },
  '036631017': { nome: 'Amoxicillina + Acido clavulanico (DEMO)', principioAttivo: 'Amoxicillina + Acido clavulanico', titolare: 'GSK (demo)', stato: 'In commercio (demo)', fogliettoUrl: 'https://medicinali.aifa.gov.it' }
};
async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 12000);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}
function withExtra(d, aic, extra) {
  const e = extra || {};
  return { aic, nome: d.nome || d.name || ('Farmaco AIC ' + aic), principioAttivo: d.principioAttivo || d.active || '', titolare: d.titolare || d.holder || '', stato: d.stato || d.status || '', formaFarmaceutica: d.formaFarmaceutica || '', dosaggio: d.dosaggio || '', confezione: d.confezione || '', rimborso: d.rimborso || d.classeRimborsabilita || '', prescrizione: d.prescrizione || '', carenza: d.carenza || '', viaSomministrazione: d.viaSomministrazione || '', atc: d.atc || '', inCommercio: (d.inCommercio == null ? null : d.inCommercio), fogliettoUrl: d.fogliettoUrl || d.leaflet || '', rcpUrl: d.rcpUrl || '', schedaUrl: d.schedaUrl || d.dettaglioUrl || '', dettaglioUrl: d.dettaglioUrl || '', fonte: d.fonte || 'aifa', lotto: e.lotto || null, scadenza: e.scadenza || null, seriale: e.seriale || null, gtin: e.gtin || null };
}
export async function lookupAifa(aicRaw, extra) {
  const aic = normalizeLookupAic(aicRaw);
  if (!/^[0-9]{9}$/.test(aic)) throw new Error('AIC non valido: servono 9 cifre');
  const ex = extra || {};
  let lastErr = null;
  try {
    const j = await fetchJson('https://api.aifa.gov.it/aifa-bdf-eif-be/1.0.0/formadosaggio/ricerca?query=' + encodeURIComponent(aic) + '&page=0', 10000);
    const content = (j && j.data && Array.isArray(j.data.content)) ? j.data.content : [];
    const item = content.find((it) => (((it && it.confezioni) || []).some((p) => String(p.aic) === aic))) || (content.length === 1 ? content[0] : null);
    if (item) {
      const med = item.medicinale || {}; const packs = Array.isArray(item.confezioni) ? item.confezioni : [];
      const pack = packs.find((p) => String(p.aic) === aic) || packs[0] || {};
      const prescritt = Array.isArray(pack.descrizioniRf) ? pack.descrizioniRf.join(', ') : (pack.descrizioniRf || '');
      const carenzaTxt = (pack.flagCarenza === 1 || pack.flagCarenza === '1' || pack.flagCarenza === true) ? (pack.carenzaMotivazione || pack.notaPubblicaCarenza || 'In carenza') : '';
      const atcArr = Array.isArray(item.codiceAtc) ? item.codiceAtc : (item.codiceAtc ? [item.codiceAtc] : []);
      const vieArr = Array.isArray(pack.vieSomministrazione) ? pack.vieSomministrazione : (Array.isArray(item.vieSomministrazione) ? item.vieSomministrazione : []);
      return withExtra({ nome: (med.denominazioneMedicinale || '') + (item.descrizioneFormaDosaggio ? ' \u2014 ' + item.descrizioneFormaDosaggio : ''), principioAttivo: ((item.principiAttiviIt || []).join(' + ')), titolare: med.aziendaTitolare || '', stato: pack.descrizioneStatoAmministrativo || '', formaFarmaceutica: item.formaFarmaceutica || '', dosaggio: item.descrizioneFormaDosaggio || '', confezione: pack.denominazionePackage || '', rimborso: pack.descrizioneRimborsabilita || pack.classeRimborsabilita || '', prescrizione: prescritt, carenza: carenzaTxt, viaSomministrazione: vieArr.join(', '), atc: atcArr.join(', '), fogliettoUrl: 'https://medicinali.aifa.gov.it/it/detail?aic=' + aic, schedaUrl: item.id ? 'https://medicinali.aifa.gov.it/#/dettaglio/' + item.id : '', fonte: 'aifa-diretto' }, aic, ex);
    }
  } catch (e) { lastErr = e; }
  const d = DEMO[aic];
  if (d) return { ...withExtra(d, aic, ex), fonte: 'demo' };
  const nf = withExtra({}, aic, ex);
  nf.nome = 'Farmaco AIC ' + aic + ' (dati non trovati)';
  nf.fonte = 'sconosciuto';
  nf.notFound = true;
  nf.nota = lastErr ? ('AIFA non raggiungibile (' + (lastErr.message || lastErr) + '). Controlla la connessione e riprova.') : 'AIC assente in AIFA. Verifica il codice.';
  return nf;
}
// Alias legacy: URL proxy non più usati, ma presenti in vecchi localStorage.
// Restituiscono '' così l'app va sempre in diretto AIFA.
export function getWorkerUrl() { return ''; }
export function setWorkerUrl() {}
export function getFunctionUrl() { return ''; }
export function setFunctionUrl() {}
