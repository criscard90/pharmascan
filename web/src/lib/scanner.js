// PharmaScan - scanner ZXing (Spec sezione 4: camera posteriore, focus continuo).
// Formati: CODE_39/Code32 fustella + DATA_MATRIX GS1.
// Indurito per DataMatrix farmaceutico piccolo: risoluzione 1280x720,
// TRY_HARDER + ASSUME_GS1, focus continuo, overlay debug char-code.
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';

let reader = null;
let stream = null;
let scanning = false;
let scanTimer = null;
let preview = null;
let scanCanvas = null;
let scanContext = null;

const SCAN_REGION_WIDTH = 0.7;

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
    }
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    preview = videoEl;
    videoEl.srcObject = stream;
    await videoEl.play();
    try {
      const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      if (track) {
        const caps = (track.getCapabilities && track.getCapabilities()) || {};
        const adv = [];
        if (caps.focusMode && caps.focusMode.indexOf('continuous') !== -1) adv.push({ focusMode: 'continuous' });
        if (o.torch === true && caps.torch) adv.push({ torch: true });
        if (adv.length && track.applyConstraints) {
          await track.applyConstraints({ advanced: adv }).catch(function () {});
        }
      }
    } catch (e) {}
    scanCanvas = document.createElement('canvas');
    scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
    if (!scanContext) scanContext = scanCanvas.getContext('2d');
    if (!scanContext) throw new Error('Impossibile preparare l’immagine della fotocamera');
    scanning = true;
    scanFrame(videoEl, onResult, onError, o);
  } catch (e) { stopScanner(); if (onError) onError(e); throw e; }
  return { cameraLabel: cam ? cam.label : '' };
}

function scanFrame(videoEl, onResult, onError, opts) {
  if (!scanning || !reader) return;
  if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && videoEl.videoWidth && videoEl.videoHeight) {
    const bounds = videoEl.getBoundingClientRect();
    const viewRatio = bounds.width / bounds.height;
    if (!viewRatio || !Number.isFinite(viewRatio)) {
      scanTimer = setTimeout(function () { scanFrame(videoEl, onResult, onError, opts); }, 200);
      return;
    }
    const videoRatio = videoEl.videoWidth / videoEl.videoHeight;
    let viewWidth = videoEl.videoWidth;
    let viewHeight = videoEl.videoHeight;
    let viewX = 0;
    let viewY = 0;

    if (videoRatio > viewRatio) {
      viewWidth = videoEl.videoHeight * viewRatio;
      viewX = (videoEl.videoWidth - viewWidth) / 2;
    } else {
      viewHeight = videoEl.videoWidth / viewRatio;
      viewY = (videoEl.videoHeight - viewHeight) / 2;
    }

    const regionWidth = viewWidth * SCAN_REGION_WIDTH;
    const regionHeight = viewHeight * SCAN_REGION_WIDTH * viewRatio;
    const canvasWidth = Math.round(regionWidth);
    const canvasHeight = Math.round(regionHeight);
    if (scanCanvas.width !== canvasWidth) scanCanvas.width = canvasWidth;
    if (scanCanvas.height !== canvasHeight) scanCanvas.height = canvasHeight;
    try {
      scanContext.drawImage(
        videoEl,
        viewX + (viewWidth - regionWidth) / 2,
        viewY + (viewHeight - regionHeight) / 2,
        regionWidth,
        regionHeight,
        0,
        0,
        canvasWidth,
        canvasHeight
      );
      const result = reader.decodeFromCanvas(scanCanvas);
      const text = result.getText();
      if (text && opts.onRaw) opts.onRaw(text, debugRaw(text));
      if (text) onResult(text);
    } catch (e) {
      const name = String(e && e.name || '');
      if (name !== 'NotFoundException' && name !== 'ChecksumException' && name !== 'FormatException' && onError) onError(e);
    }
  }
  scanTimer = setTimeout(function () { scanFrame(videoEl, onResult, onError, opts); }, 200);
}

export function stopScanner() {
  scanning = false;
  if (scanTimer !== null) clearTimeout(scanTimer);
  scanTimer = null;
  try { if (reader) reader.reset(); } catch (e) {}
  if (preview && preview.srcObject === stream) {
    preview.pause();
    preview.srcObject = null;
  }
  preview = null;
  try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  scanCanvas = null;
  scanContext = null;
  reader = null; stream = null;
}

export async function toggleTorch(on) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track) throw new Error('Fotocamera non attiva');
  await track.applyConstraints({ advanced: [{ torch: !!on }] });
}
