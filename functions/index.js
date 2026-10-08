// PharmaScan Cloud Function: lookup AIC -> AIFA (Spec sezione 4).
// Middleware anti-CORS: il frontend chiama questa function,
// la function interroga open-data AIFA e ritorna metadati normalizzati.
import { onRequest } from 'firebase-functions/v2/https';

const AIFA_BASE = 'https://medicinali.aifa.gov.it';

export const lookupAic = onRequest({ cors: true, region: 'europe-west1' }, async (req, res) => {
  const aic = String(req.query.aic || '').replace(/\D/g, '').slice(0, 9);
  if (!/^[0-9]{9}$/.test(aic)) {
    res.status(400).json({ error: 'Parametro ?aic=9cifre richiesto' });
    return;
  }
  try {
    // Tentativo 1: pagina dettaglio AIFA per AIC (HTML scraping leggero).
    const r = await fetch(AIFA_BASE + '/it/detail?aic=' + aic, { headers: { Accept: 'text/html' } });
    const html = await r.text();
    const pick = function (rx) { const m = html.match(rx); return m ? m[1].trim() : ''; };
    const nome = pick(/<h1[^>]*>([^<]+)<\/h1>/i) || pick(/<title>([^<]+)<\/title>/i);
    if (nome) {
      res.json({
        aic, nome,
        principioAttivo: pick(/principio attivo[^<]*<[^>]*>([^<]+)/i),
        titolare: pick(/titolare[^<]*<[^>]*>([^<]+)/i),
        stato: pick(/stato[^<]*<[^>]*>([^<]+)/i),
        fogliettoUrl: AIFA_BASE + '/it/detail?aic=' + aic,
        fonte: 'aifa-scrape'
      });
      return;
    }
    throw new Error('AIFA senza risultati');
  } catch (e) {
    // Fallback: ritorna placeholder strutturato, il client salva comunque AIC+lotto+scadenza.
    res.json({
      aic, nome: 'Farmaco AIC ' + aic, principioAttivo: '', titolare: '',
      stato: '', fogliettoUrl: AIFA_BASE, fonte: 'fallback', nota: 'AIFA non raggiungibile: ' + e.message
    });
  }
});
