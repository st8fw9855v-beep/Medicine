// Persistență locală în IndexedDB (totul rămâne în browserul utilizatorului).
const DB_NAME = 'medstudy';
const DB_VERSION = 2;
export const STORES = ['sources', 'chapters', 'questions', 'outputs', 'cards'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const result = fn(s);
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const db = {
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  put: (store, obj) => tx(store, 'readwrite', (s) => { s.put(obj); }),
  putMany: (store, arr) => tx(store, 'readwrite', (s) => { for (const o of arr) s.put(o); }),
  del: (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); }),
  delMany: (store, ids) => tx(store, 'readwrite', (s) => { for (const id of ids) s.delete(id); }),
  clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
};

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
