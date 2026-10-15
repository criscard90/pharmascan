// PharmaScan - scanner ZXing (Spec sezione 4: camera posteriore, focus continuo).
// Formati: CODE_39/Code32 fustella + DATA_MATRIX GS1.
// Indurito per DataMatrix farmaceutico piccolo: risoluzione 1280x720,
// TRY_HARDER + ASSUME_GS1, focus continuo, overlay debug char-code.
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

let reader = null;
let controls = null;
let stream = null;
let scanning = false;

export async function listCameras() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter(function (d) { return d.kind === 'videoinput'; });
}

export function pickRearCamera(cams) {
  if (!cams || !cams.length) return null;
  const rx = /back|rear|posteriore|environment|principale/i;
  return cams.find(function (c) { return rx.test(c.label || ''); }) || cams[cams.length - 1];
}

export function debugRaw(raw) {
  const t = String(raw == null ? '' : raw);
  const codes = [];
  for (let i = 0; i < t.length; i++) codes.push(t.charCodeAt(i));
  const hasGS = codes.indexOf(29) !== -1;
  // Rappresentazione compatta: GS evidenziato, controlli come [nn].
  let pretty = '';
  for (let i = 0; i < t.length; i++) {
    const c = codes[i];
    if (c === 29) pretty += '|GS|';
    else if (c < 32) pretty += '[' + c + ']';
    else pretty += t[i];
  }
  return { len: t.length, hasGS, codes: codes.slice(0, 160), pretty: pretty.slice(0, 260) };
}

export async function startScanner(videoEl, onResult, onError, opts) {
  stopScanner();
  const o = opts || {};
  reader = new BrowserMultiFormatReader(new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.CODE_39, BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13]],
    [DecodeHintType.TRY_HARDER, true],
    [DecodeHintType.ASSUME_GS1, true]
  ]), 300);
  const cams = await listCameras();
  const cam = pickRearCamera(cams);
  const deviceId = cam ? cam.deviceId : undefined;
  scanning = true;
  const constraints = {
    audio: false,
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      facingMode: deviceId ? undefined : { ideal: 'environment' },
      width: { ideal: 1280 }, height: { ideal: 720 },
      focusMode: { ideal: 'continuous' }
    }
  };
  try {
    controls = await reader.decodeFromConstraints(constraints, videoEl, function (res, err) {
      if (!scanning) return;
      if (res) {
        const t = res.getText();
        if (t && o.onRaw) { try { o.onRaw(t, debugRaw(t)); } catch (e) {} }
        if (t) onResult(t);
      }
      else if (err && onError) {
        const n = String(err && err.name || '');
        if (n !== 'NotFoundException') onError(err);
      }
    });
    stream = videoEl.srcObject || null;
    try {
      const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      if (track) {
        const caps = (track.getCapabilities && track.getCapabilities()) || {};
        const adv = [];
        if (caps.focusMode && caps.focusMode.indexOf('continuous') !== -1) adv.push({ focusMode: 'continuous' });
        else adv.push({ focusMode: 'continuous' });
        if (o.torch === true && caps.torch) adv.push({ torch: true });
        if (adv.length && track.applyConstraints) {
          await track.applyConstraints({ advanced: adv }).catch(function () {});
        }
      }
    } catch (e) {}
  } catch (e) { if (onError) onError(e); throw e; }
  return { cameraLabel: cam ? cam.label : '' };
}

export function stopScanner() {
  scanning = false;
  try { if (controls) controls.stop(); } catch (e) {}
  try { if (reader) reader.reset(); } catch (e) {}
  try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  reader = null; controls = null; stream = null;
}

export async function toggleTorch(on) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track) throw new Error('Fotocamera non attiva');
  await track.applyConstraints({ advanced: [{ torch: !!on }] });
}
