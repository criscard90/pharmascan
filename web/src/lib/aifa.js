// PharmaScan - lookup AIFA via Cloud Function (Spec sezione 4).
// La function fa da middleware anti-CORS verso open-data AIFA.
const FN_URL_KEY = 'pharmascan_fn_url';

export function getFunctionUrl() {
  return localStorage.getItem(FN_URL_KEY) || '';
}
export function setFunctionUrl(u) {
  if (u) localStorage.setItem(FN_URL_KEY, u);
  else localStorage.removeItem(FN_URL_KEY);
}

// Demo fallback quando la function non e configurata / offline.
const DEMO = {
  '012345678': { nome: 'Tachipirina 500 mg compresse (DEMO)', principioAttivo: 'Paracetamolo', titolare: 'Angelini (demo)', stato: 'In commercio (demo)', fogliettoUrl: 'https://medicinali.aifa.gov.it' },
  '036631017': { nome: 'Augmentin 875/125 mg (DEMO)', principioAttivo: 'Amoxicillina + Acido clavulanico', titolare: 'GSK (demo)', stato: 'In commercio (demo)', fogliettoUrl: 'https://medicinali.aifa.gov.it' }
};

export async function lookupAifa(aic, extra) {
  extra = extra || {};
  const url = getFunctionUrl();
  if (url) {
    try {
      const r = await fetch(url.replace(/\/$/, '') + '?aic=' + encodeURIComponent(aic), { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        return { aic, nome: j.nome || j.name || 'Farmaco ' + aic, principioAttivo: j.principioAttivo || j.active || '', titolare: j.titolare || j.holder || '', stato: j.stato || j.status || '', fogliettoUrl: j.fogliettoUrl || j.leaflet || '', lotto: extra.lotto || null, scadenza: extra.scadenza || null, seriale: extra.seriale || null, gtin: extra.gtin || null, fonte: 'aifa-function' };
      }
    } catch (e) { console.warn('function AIFA non raggiungibile', e); }
  }
  const d = DEMO[aic];
  if (d) return Object.assign({ aic }, d, { lotto: extra.lotto || null, scadenza: extra.scadenza || null, seriale: extra.seriale || null, gtin: extra.gtin || null, fonte: 'demo' });
  return { aic, nome: 'Farmaco AIC ' + aic + ' (dati da completare)', principioAttivo: '', titolare: '', stato: '', fogliettoUrl: 'https://medicinali.aifa.gov.it', lotto: extra.lotto || null, scadenza: extra.scadenza || null, seriale: extra.seriale || null, gtin: extra.gtin || null, fonte: 'sconosciuto' };
}
