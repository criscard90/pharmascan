// PharmaScan - parsing AIC (Spec sezione 3).
// Code32 fustella: "A012345678" -> AIC 9 cifre.
// GS1 DataMatrix: AI 01 GTIN, 7001 AIC, 10 lotto, 17 scadenza, 21 seriale.
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
    const fixed = { '01': 14, 17: 6 };
    const vari = { 10: 1, 21: 1, 7001: 1 };
    let i = 0, guard = 0;
    while (i < s.length && guard++ < 40) {
      let id = null;
      const c4 = s.substr(i, 4), c2 = s.substr(i, 2);
      if (fixed[c4] || vari[c4]) { id = c4; i += 4; }
      else if (/^\d{2}$/.test(c2)) { id = c2; i += 2; }
      else { i++; continue; }
      if (fixed[id]) { ai[id] = s.substr(i, fixed[id]); i += fixed[id]; }
      else {
        const nx = s.indexOf(GS, i);
        if (nx === -1) { ai[id] = s.substring(i); i = s.length; }
        else { ai[id] = s.substring(i, nx); i = nx + 1; }
      }
    }
  }
  let scadenza = null;
  if (ai['17'] && /^\d{6}$/.test(ai['17'])) {
    const yy = ai['17'].substr(0, 2), mm = ai['17'].substr(2, 2);
    let dd = ai['17'].substr(4, 2);
    if (dd === '00') dd = String(new Date(Number('20' + yy), Number(mm), 0).getDate()).padStart(2, '0');
    scadenza = '20' + yy + '-' + mm + '-' + dd;
  }
  let aic = null;
  if (ai['7001']) {
    const d = ai['7001'].replace(/\D/g, '');
    const m = d.match(/([0-9]{9})/);
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
  const looksGS1 = /\(01\)|\(7001\)|\(10\)|\(17\)|\(21\)/.test(up)
    || up.indexOf(GS) !== -1 || /^01\d{14}/.test(up.replace(/^\]D[1-6]/, ''));
  if (looksGS1) {
    const g = parseGS1(raw);
    if (g.aic || g.gtin) return Object.assign({}, g, { format: 'gs1-datamatrix' });
  }
  try {
    const c = parseCode32(raw);
    return { aic: c.aic, gtin: null, lotto: null, scadenza: null, seriale: null, ai: {}, format: c.format, raw };
  } catch (e) {
    const m = up.replace(/\D/g, '').match(/([0-9]{9})/);
    if (m) return { aic: m[1], gtin: null, lotto: null, scadenza: null, seriale: null, ai: {}, format: 'guess-9digits', raw };
    throw new Error('Impossibile estrarre AIC da: ' + raw);
  }
}
