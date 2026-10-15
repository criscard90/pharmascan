/**
 * PharmaScan - Cloudflare Worker proxy anti-CORS verso API open-data AIFA.
 * Endpoint: GET {WORKER}/?aic=XXXXXXXXX -> JSON normalizzato + CORS *.
 * Deploy: cd worker && npm install && npx wrangler deploy
 */
export const DEFAULT_AIFA_BASE = 'https://api.aifa.gov.it/aifa-bdf-eif-be/1.0.0';
const CORS_BASE = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Correlation-Id', 'Access-Control-Max-Age': '86400' };
export function normalizeAic(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  return (d.length > 9 ? d.slice(0, 9) : d).padStart(9, '0');
}
function asArr(v) { if (Array.isArray(v)) return v; if (v == null || v === '') return []; return [v]; }
export function pickConfezione(aic, item) {
  const p = (item && Array.isArray(item.confezioni)) ? item.confezioni : [];
  if (!p.length) return {};
  return p.find((x) => String(x && x.aic) === String(aic)) || p[0] || {};
}
export function pickContentItem(aic, content) {
  const list = Array.isArray(content) ? content : [];
  if (!list.length) return null;
  const w = String(aic);
  const ex = list.find((it) => ((it && Array.isArray(it.confezioni)) ? it.confezioni : []).some((p) => String(p && p.aic) === w));
  if (ex) return ex;
  if (list.length === 1) return list[0];
  return null;
}
export function mapAifaItem(aic, item, fonte) {
  const src = item || {}; const med = src.medicinale || {}; const pack = pickConfezione(aic, src);
  const pa = String((pack && pack.aic) || aic || '');
  const f = fonte || 'aifa-worker';
  const out = { aic: pa, nome: 'Farmaco AIC ' + pa, principioAttivo: '', titolare: '', stato: '', formaFarmaceutica: '', dosaggio: '', confezione: '', classeRimborsabilita: '', rimborso: '', prescrizione: '', carenza: '', viaSomministrazione: '', atc: '', inCommercio: null, fogliettoUrl: '', rcpUrl: '', schedaUrl: '', dettaglioUrl: '', fonte: f, lotto: null, scadenza: null, seriale: null, gtin: null };
  if (!med.denominazioneMedicinale && !src.descrizioneFormaDosaggio && !pack.denominazionePackage) return out;
  const pr = (Array.isArray(src.principiAttiviIt) && src.principiAttiviIt.length) ? src.principiAttiviIt : asArr(src.descrizioneAtc);
  const dn = med.denominazioneMedicinale || ''; const ds = src.descrizioneFormaDosaggio || '';
  out.nome = (dn && ds && ds !== dn) ? (dn + ' \u2014 ' + ds) : (dn || ds || out.nome);
  out.principioAttivo = pr.join(' + ');
  out.titolare = med.aziendaTitolare || '';
  let ic = null;
  if ((pack && (pack.flagCommercio === 1 || pack.flagCommercio === '1')) || String(med.commercio) === '1') ic = true;
  else if (pack && (pack.flagCommercio === 0 || pack.flagCommercio === '0')) ic = false;
  out.inCommercio = ic;
  out.stato = (pack && pack.descrizioneStatoAmministrativo) || (ic === true ? 'In commercio' : ic === false ? 'Non in commercio' : '');
  out.formaFarmaceutica = src.formaFarmaceutica || '';
  out.dosaggio = ds;
  out.confezione = (pack && pack.denominazionePackage) || '';
  out.classeRimborsabilita = (pack && pack.classeRimborsabilita) || '';
  out.rimborso = pack.descrizioneRimborsabilita || pack.classeRimborsabilita || '';
  out.prescrizione = Array.isArray(pack.descrizioniRf) ? pack.descrizioniRf.join(', ') : (pack.descrizioniRf || '');
  out.carenza = (pack.flagCarenza === 1 || pack.flagCarenza === '1' || pack.flagCarenza === true) ? (pack.carenzaMotivazione || 'In carenza') : '';
  out.viaSomministrazione = asArr(src.vieSomministrazione).join(', ');
  out.atc = asArr(src.codiceAtc).join(', ');
  if (med.codiceSis != null && med.aic6 != null) {
    const b = DEFAULT_AIFA_BASE + '/organizzazione/' + med.codiceSis + '/farmaci/' + med.aic6 + '/stampati?ts=';
    if (src.flagFI) out.fogliettoUrl = b + 'FI';
    if (src.flagRCP) out.rcpUrl = b + 'RCP';
  }
  out.schedaUrl = src.id ? 'https://medicinali.aifa.gov.it/#/dettaglio/' + src.id : ('https://medicinali.aifa.gov.it/it/detail?aic=' + pa);
  out.dettaglioUrl = src.id ? 'https://medicinali.aifa.gov.it/it/dettaglio/' + src.id : '';
  return out;
}
function corsH(origin, env) {
  const a = (env && env.ALLOW_ORIGINS) || '*';
  if (a === '*') return { ...CORS_BASE, 'Access-Control-Allow-Origin': '*' };
  const l = String(a).split(',').map((s) => s.trim()).filter(Boolean);
  const v = (origin && l.includes(origin)) ? origin : (l[0] || '');
  return { ...CORS_BASE, 'Access-Control-Allow-Origin': v, Vary: 'Origin' };
}
function jRes(b, s, h) { return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...h } }); }
async function lookup(aic, env) {
  const base = (env && env.AIFA_BASE) || DEFAULT_AIFA_BASE;
  const r = await fetch(base + '/formadosaggio/ricerca?query=' + encodeURIComponent(aic) + '&page=0', { headers: { Accept: 'application/json', 'Correlation-Id': 'pharmascan-' + aic }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('AIFA HTTP ' + r.status);
  const j = await r.json();
  const c = (j && j.data && Array.isArray(j.data.content)) ? j.data.content : [];
  const it = pickContentItem(aic, c);
  if (!it) return null;
  return mapAifaItem(aic, it, 'aifa-worker');
}
export default {
  async fetch(req, env, ctx) {
    const cors = corsH(req.headers.get('Origin') || '', env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    if ((u.pathname === '/' || u.pathname === '') && !u.searchParams.has('aic')) return jRes({ ok: true, service: 'pharmascan-aifa', usage: '/?aic=XXXXXXXXX' }, 200, cors);
    if (req.method !== 'GET') return jRes({ error: 'Metodo non consentito' }, 405, cors);
    const aic = normalizeAic(u.searchParams.get('aic'));
    if (!/^[0-9]{9}$/.test(aic)) return jRes({ error: 'Parametro ?aic= richiede 9 cifre (es. 036631017)' }, 400, cors);
    try {
      const cache = caches.default;
      const key = new Request(new URL('/__cache/' + aic, u.origin), { method: 'GET' });
      try { const hit = await cache.match(key); if (hit) { const body = await hit.json(); return jRes(body, 200, { ...cors, 'X-Cache': 'HIT' }); } } catch (e) {}
      const dto = await lookup(aic, env);
      if (!dto) return jRes({ aic, error: 'AIC non trovato in AIFA', fonte: 'aifa-worker', nota: 'Nessun risultato.' }, 404, { ...cors, 'Cache-Control': 'public, max-age=60' });
      const out = jRes(dto, 200, { ...cors, 'X-Cache': 'MISS' });
      try { const p = cache.put(key, new Response(JSON.stringify(dto), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } })).catch(function () {}); if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p; } catch (e) {}
      return out;
    } catch (e) { return jRes({ aic, error: 'AIFA non raggiungibile', nota: String((e && e.message) || e), fonte: 'aifa-worker' }, 502, cors); }
  },
};
