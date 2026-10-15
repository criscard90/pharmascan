// PharmaScan - parsing AIC (DM 6/3/2025 + Spec sezione 3).
// - Code32 fustella: "A012345678" -> AIC 9 cifre.
// - GS1 DataMatrix italiano: AI 01 GTIN(14) + 21 seriale + 17 scadenza(6) + 10 lotto + 716 AIC(9).
//   (NO AI 7001: quello è di altri paesi; in Italia l'AIC viaggia con AI nazionale 716.)
// - Riga stampata HRI: "PC:.. SN:.. SCAD:.. LOTTO:.. AIC:.."
const GS = String.fromCharCode(29);

export function normalizeRaw(input) {
  if (input == null) return '';
  let s = String(input).trim().toUpperCase();
  for (const a of ['<FNC1>', '<GS>', '{FNC1}', '{GS}']) s = s.split(a).join(GS);
  return s;
}

export function isValidAic(a) { return /^[0-9]{9}$/.test(a || ''); }

export function parseCode32(raw) {
  const s = normalizeRaw(raw).replace(/[\s\-.]/g, '');
  let m = s.match(/^A([0-9]{9})$/) || s.match(/^([0-9]{9})$/) || s.match(/A([0-9]{9})/);
  if (!m) throw new Error('Code32 non riconosciuto: ' + raw);
  return { aic: m[1], format: 'code32', raw: String(raw) };
}

export function parseGS1(rawInput) {
  const raw = String(rawInput == null ? '' : rawInput);
  const up = normalizeRaw(raw);
  const ai = {};
  if (up.indexOf('(') !== -1) {
    const re = /\((\d{2,4})\)([^()]*)/g;
    let m;
    while ((m = re.exec(up)) !== null) ai[m[1]] = m[2].split(GS).join('');
  } else {
    let s = up.replace(/^\]D[1-6]/, '');
    // Lunghezze fisse: 01 GTIN(14), 17 scadenza(6), 716 AIC-IT(9).
    const fixed = { '01': 14, 17: 6, 716: 9 };
    // Variabili (terminate da <GS> o fine stringa): 10 lotto, 21 seriale.
    // (7001 tenuto per compatibilità con DataMatrix esteri/demo.)
    const vari = { 10: 1, 21: 1, 7001: 1 };
    let i = 0, guard = 0;
    while (i < s.length && guard++ < 60) {
      let id = null;
      const c4 = s.substr(i, 4), c3 = s.substr(i, 3), c2 = s.substr(i, 2);
      if (fixed[c4] || vari[c4]) { id = c4; i += 4; }
      else if (fixed[c3] || vari[c3]) { id = c3; i += 3; }
      else if (/^\d{2}$/.test(c2)) { id = c2; i += 2; }
      else { i++; continue; }
      if (fixed[id]) {
        ai[id] = s.substr(i, fixed[id]);
        // Se dopo il campo fisso c'è un <GS> di troppo, saltalo.
        i += fixed[id];
        if (s[i] === GS) i++;
      } else {
        const nx = s.indexOf(GS, i);
        if (nx === -1) { ai[id] = s.substring(i); i = s.length; }
        else { ai[id] = s.substring(i, nx); i = nx + 1; }
      }
    }
  }
  // HRI stampata (PC/SN/SCAD/LOTTO/AIC) — fallback quando lo scanner legge
  // la riga in chiaro invece del DataMatrix, es. "PC:0803.. SN:.. AIC:026089110".
  if (!ai['716'] && !ai['7001']) {
    const h = up.match(/(?:^|[\s;])AIC\s*[:=\-]?\s*([0-9]{9})/);
    if (h) ai['716'] = h[1];
  }
  if (!ai['10']) {
    const h = up.match(/(?:^|[\s;])LOTTO\s*[:=\-]?\s*([A-Z0-9\-./]{1,20})/);
    if (h) ai['10'] = h[1];
  }
  let scadenza = null;
  if (ai['17'] && /^\d{6}$/.test(ai['17'])) {
    const yy = ai['17'].substr(0, 2), mm = ai['17'].substr(2, 2);
    let dd = ai['17'].substr(4, 2);
    if (dd === '00') dd = String(new Date(Number('20' + yy), Number(mm), 0).getDate()).padStart(2, '0');
    scadenza = '20' + yy + '-' + mm + '-' + dd;
  }
  let aic = null;
  // Italia (DM 6/3/2025): AIC con AI nazionale 716 (9 cifre).
  for (const k of ['716', '7001']) {
    if (!ai[k]) continue;
    const d = String(ai[k]).replace(/\D/g, '');
    const m = d.match(/([0-9]{9})/);
    if (m) { aic = m[1]; break; }
  }
  // Pseudo-AI "02" di alcuni scanner economici che mappano l'AIC dopo il GTIN.
  if (!aic && ai['02']) {
    const m = String(ai['02']).replace(/\D/g, '').match(/([0-9]{9})/);
    if (m) aic = m[1];
  }
  return {
    aic, gtin: ai['01'] || null, lotto: ai['10'] || null,
    scadenza, seriale: ai['21'] || null, ai, raw
  };
}

export function parseScan(rawInput) {
  const raw = String(rawInput == null ? '' : rawInput);
  const up = normalizeRaw(raw);
  const looksGS1 = /\(01\)|\(716\)|\(7001\)|\(10\)|\(17\)|\(21\)/.test(up)
    || /(?:^|[\s;])(PC|SN|SCAD|LOTTO|AIC)\s*:/.test(up)
    || up.indexOf(GS) !== -1 || /^01\d{14}/.test(up.replace(/^\]D[1-6]/, ''));
  if (looksGS1) {
    const g = parseGS1(raw);
    // DataMatrix completo -> c'è almeno AIC o GTIN: OK.
    if (g.aic || g.gtin) return Object.assign({}, g, { format: 'gs1-datamatrix' });
    // Sembra GS1 ma senza AIC né GTIN: frammento di scansione (es. solo il
    // lotto "182M0L" letto a metà) oppure matrix senza AIC. Non sparare un
    // errore criptico: segnala "parziale" così la UI invita a ri-inquadrare
    // invece di mostrare "Impossibile estrarre AIC da: ...".
    const frag = new Error('Lettura parziale (' + raw.trim().slice(0, 24) + '): inquadra tutto il DataMatrix o digita l\u2019AIC a 9 cifre.');
    frag.partial = true;
    frag.parse = g;
    throw frag;
  }
  try {
    const c = parseCode32(raw);
    return { aic: c.aic, gtin: null, lotto: null, scadenza: null, seriale: null, ai: {}, format: c.format, raw };
  } catch (e) {
    const m = up.replace(/\D/g, '').match(/([0-9]{9})/);
    if (m) return { aic: m[1], gtin: null, lotto: null, scadenza: null, seriale: null, ai: {}, format: 'guess-9digits', raw };
    // Frammento letto a metà (tipico: solo il lotto "182M0L" beccato dallo
    // scanner mentre inquadri): niente 9 cifre, niente GS1 completo.
    // Segnala "parziale" così la UI invita a ri-inquadrare invece di
    // mostrare "Impossibile estrarre AIC da: ...".
    const frag = new Error('Lettura parziale (' + raw.trim().slice(0, 24) + '): inquadra tutto il DataMatrix o digita l\u2019AIC a 9 cifre.');
    frag.partial = true;
    throw frag;
  }
}
