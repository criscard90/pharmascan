// PharmaScan - lookup AIFA via Cloudflare Worker (proxy anti-CORS) + fallback.
// Ordine: 1) Worker URL configurato 2) Cloud Function legacy 3) API AIFA diretta 4) demo.
const WORKER_KEY = 'pharmascan_worker_url';
const FN_KEY = 'pharmascan_fn_url';
const DEFAULT_WORKER = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AIFA_WORKER_URL) || '';
export function getWorkerUrl() { try { return localStorage.getItem(WORKER_KEY) || DEFAULT_WORKER || ''; } catch (e) { return DEFAULT_WORKER || ''; } }
export function setWorkerUrl(u) { try { if (u) localStorage.setItem(WORKER_KEY, u); else localStorage.removeItem(WORKER_KEY); } catch (e) {} }
export function getFunctionUrl() { try { return localStorage.getItem(FN_KEY) || ''; } catch (e) { return ''; } }
export function setFunctionUrl(u) { try { if (u) localStorage.setItem(FN_KEY, u); else localStorage.removeItem(FN_KEY); } catch (e) {} }
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
  const wUrl = getWorkerUrl();
  if (wUrl) {
    try {
      const j = await fetchJson(wUrl.replace(/\/$/, '') + '/?aic=' + encodeURIComponent(aic));
      if (j && !j.error && (j.nome || j.aic)) return withExtra(j, aic, ex);
      if (j && j.error && j.aic) { lastErr = new Error(j.error); }
    } catch (e) { lastErr = e; console.warn('Worker AIFA non raggiungibile:', e); }
  }
  const fnUrl = getFunctionUrl();
  if (fnUrl) {
    try {
      const j = await fetchJson(fnUrl.replace(/\/$/, '') + '?aic=' + encodeURIComponent(aic));
      if (j && (j.nome || j.name)) return withExtra({ ...j, fonte: j.fonte || 'aifa-function' }, aic, ex);
    } catch (e) { lastErr = e; console.warn('Function AIFA non raggiungibile:', e); }
  }
  try {
    const j = await fetchJson('https://api.aifa.gov.it/aifa-bdf-eif-be/1.0.0/formadosaggio/ricerca?query=' + encodeURIComponent(aic) + '&page=0', 10000);
    const content = (j && j.data && Array.isArray(j.data.content)) ? j.data.content : [];
    const item = content.find((it) => (((it && it.confezioni) || []).some((p) => String(p.aic) === aic))) || (content.length === 1 ? content[0] : null);
    if (item) {
      const med = item.medicinale || {}; const packs = Array.isArray(item.confezioni) ? item.confezioni : [];
      const pack = packs.find((p) => String(p.aic) === aic) || packs[0] || {};
      return withExtra({ nome: (med.denominazioneMedicinale || '') + (item.descrizioneFormaDosaggio ? ' \u2014 ' + item.descrizioneFormaDosaggio : ''), principioAttivo: ((item.principiAttiviIt || []).join(' + ')), titolare: med.aziendaTitolare || '', stato: pack.descrizioneStatoAmministrativo || '', fogliettoUrl: 'https://medicinali.aifa.gov.it/it/detail?aic=' + aic, schedaUrl: item.id ? 'https://medicinali.aifa.gov.it/#/dettaglio/' + item.id : '', fonte: 'aifa-diretto' }, aic, ex);
    }
  } catch (e) { lastErr = e; }
  const d = DEMO[aic];
  if (d) return { ...withExtra(d, aic, ex), fonte: 'demo' };
  const nf = withExtra({}, aic, ex);
  nf.nome = 'Farmaco AIC ' + aic + ' (dati non trovati)';
  nf.fonte = 'sconosciuto';
  nf.notFound = true;
  nf.nota = lastErr ? ('AIFA non raggiungibile (' + (lastErr.message || lastErr) + '). Configura il Worker anti-CORS qui sotto.') : 'AIC assente in AIFA. Verifica il codice.';
  return nf;
}
