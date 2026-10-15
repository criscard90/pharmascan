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
  // Prima proviamo a usare l'URL configurato dall'utente (funzione Cloud Function)
  const functionUrl = getFunctionUrl();
  if (functionUrl) {
    try {
      const r = await fetch(functionUrl.replace(/\/$/, '') + '?aic=' + encodeURIComponent(aic), { 
        headers: { Accept: 'application/json' } 
      });
      if (r.ok) {
        const j = await r.json();
        return { aic, nome: j.nome || j.name || 'Farmaco ' + aic, principioAttivo: j.principioAttivo || j.active || '', titolare: j.titolare || j.holder || '', stato: j.stato || j.status || '', fogliettoUrl: j.fogliettoUrl || j.leaflet || '', lotto: extra.lotto || null, scadenza: extra.scadenza || null, seriale: extra.seriale || null, gtin: extra.gtin || null, fonte: 'aifa-function' };
      }
    } catch (e) {
      console.warn('Funzione AIFA non raggiungibile (URL configurato):', e);
    }
  }
  // Se nessun URL personalizzato, usiamo il base URL di AIFA
  const aiFaBase = 'https://medicinali.aifa.gov.it';
  try {
    const r = await fetch(aiFaBase + '/it/detail?aic=' + aic, { 
      headers: { Accept: 'text/html' } 
    });
    if (r.ok) {
      const html = await r.text();
      const pick = function (rx) { const m = html.match(rx); return m ? m[1].trim() : ''; };
      const nome = pick(/<h1[^>]*>([^<]+)<\/h1>/i) || pick(/<title>([^<]+)<\/title>/i);
      if (nome) {
        return {
          aic, nome,
          principioAttivo: pick(/principio attivo[^<]*<[^>]*>([^<]+)/i),
          titolare: pick(/titolare[^<]*<[^>]*>([^<]+)/i),
          stato: pick(/stato[^<]*<[^>]*>([^<]+)/i),
          fogliettoUrl: aiFaBase + '/it/detail?aic=' + aic,
          fonte: 'aifa-scrape'
        };
      }
    }
  } catch (e) {
    console.warn('Fallback AIFA non raggiungibile:', e);
  }
  // Ultimo tentativo: dizionario demo
  const d = DEMO[aic];
  if (d) return Object.assign({ aic }, d, { lotto: extra.lotto || null, scadenza: extra.scadenza || null, seriale: extra.seriale || null, gtin: extra.gtin || null, fonte: 'demo' });
  return { aic, nome: 'Farmaco AIC ' + aic + ' (dati da completare)', principioAttivo: '', titolare: '', stato: '', fogliettoUrl: 'https://medicinali.aifa.gov.it', lotto: extra.lotto || null, scadenza: extra.scadenza || null, seriale: extra.seriale || null, gtin: extra.gtin || null, fonte: 'sconosciuto' };
}