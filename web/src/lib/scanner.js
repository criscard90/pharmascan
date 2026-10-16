// PharmaScan - scanner ZXing (Spec sezione 4: camera posteriore, focus continuo).
// Formati: CODE_39/Code32 fustella + DATA_MATRIX GS1.
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

let reader = null;
let stream = null;
let scanning = false;
let scanTimer = null;
let preview = null;
let scanCanvas = null;
let scanContext = null;

const SCAN_REGION_WIDTH = 0.54;

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
  ]));
  const cams = await listCameras();
  const cam = pickRearCamera(cams);
  const deviceId = cam ? cam.deviceId : undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }
    });
    preview = videoEl;
    videoEl.srcObject = stream;
    await videoEl.play();
    try {
      const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      if (track && track.applyConstraints) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
      }
    } catch (e) {}
    scanCanvas = document.createElement('canvas');
    scanContext = scanCanvas.getContext('2d');
    if (!scanContext) throw new Error('Impossibile preparare l’immagine della fotocamera');
    scanning = true;
    scanFrame(videoEl, onResult, onError);
  } catch (e) { stopScanner(); if (onError) onError(e); throw e; }
  return { cameraLabel: cam ? cam.label : '' };
}

function scanFrame(videoEl, onResult, onError) {
  if (!scanning || !reader) return;
  if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && videoEl.videoWidth && videoEl.videoHeight) {
    const bounds = videoEl.getBoundingClientRect();
    const viewRatio = bounds.width / bounds.height;
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

    try {
      const result = reader.decodeFromCanvas(scanCanvas);
      const text = result.getText();
      if (text) onResult(text);
    } catch (e) {
      const name = String(e && e.name || '');
      if (name !== 'NotFoundException' && name !== 'ChecksumException' && name !== 'FormatException' && onError) onError(e);
    }
  }
  scanTimer = setTimeout(function () { scanFrame(videoEl, onResult, onError); }, 200);
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
