// PharmaScan - scanner ZXing (Spec sezione 4: camera posteriore, focus continuo).
// Formati: CODE_39/Code32 fustella + DATA_MATRIX GS1.
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

let reader = null;
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

export async function startScanner(videoEl, onResult, onError) {
  stopScanner();
  reader = new BrowserMultiFormatReader(new Map([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.CODE_128, BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13]],
    [DecodeHintType.TRY_HARDER, true]
  ]), 300);
  const cams = await listCameras();
  const cam = pickRearCamera(cams);
  const deviceId = cam ? cam.deviceId : undefined;
  scanning = true;
  try {
    await reader.decodeFromVideoDevice(deviceId, videoEl, function (res, err) {
      if (!scanning) return;
      if (res) { const t = res.getText(); if (t) onResult(t); }
      else if (err && onError) {
        const n = String(err && err.name || '');
        if (n !== 'NotFoundException') onError(err);
      }
    });
    stream = videoEl.srcObject || null;
    try {
      const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      if (track && track.applyConstraints) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
      }
    } catch (e) {}
  } catch (e) { if (onError) onError(e); throw e; }
  return { cameraLabel: cam ? cam.label : '' };
}

export function stopScanner() {
  scanning = false;
  try { if (reader) reader.reset(); } catch (e) {}
  try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  reader = null; stream = null;
}

export async function toggleTorch(on) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track) throw new Error('Fotocamera non attiva');
  await track.applyConstraints({ advanced: [{ torch: !!on }] });
}
