// PharmaScan - store armadietto: Firestore + fallback locale.
// Spec sezione 4: doc id = AIC; sezione 5: offline via IndexedDB.
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, collection, enableIndexedDbPersistence, serverTimestamp } from 'firebase/firestore';

const LS_KEY = 'pharmascan_cabinet_v1';
let db = null;
let mode = 'local';

export function firebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FB_API_KEY || '',
    authDomain: import.meta.env.VITE_FB_AUTH || '',
    projectId: import.meta.env.VITE_FB_PROJECT || ''
  };
}

export async function initStore() {
  const c = firebaseConfig();
  if (c.apiKey && c.projectId) {
    try {
      if (!getApps().length) initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId });
      db = getFirestore();
      try { await enableIndexedDbPersistence(db); } catch (e) { console.warn('persistence', e); }
      mode = 'firestore';
    } catch (e) { console.warn('firestore off, uso locale', e); db = null; mode = 'local'; }
  }
  return mode;
}
export function storeMode() { return mode; }

function readLS() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function writeLS(o) { localStorage.setItem(LS_KEY, JSON.stringify(o)); }

export async function saveMedicine(item) {
  const rec = Object.assign({}, item, { updatedAt: new Date().toISOString() });
  if (db) {
    await setDoc(doc(db, 'armadietto', rec.aic), Object.assign({}, rec, { updatedAt: serverTimestamp() }), { merge: true });
  } else {
    const all = readLS(); all[rec.aic] = rec; writeLS(all);
  }
  return rec;
}
export async function listMedicines() {
  if (db) {
    const s = await getDocs(collection(db, 'armadietto'));
    return s.docs.map(function (d) { return Object.assign({ aic: d.id }, d.data()); });
  }
  return Object.values(readLS());
}
export async function removeMedicine(aic) {
  if (db) { await deleteDoc(doc(db, 'armadietto', aic)); }
  else { const all = readLS(); delete all[aic]; writeLS(all); }
}
