const DATABASE_NAME = "ltx-remote-guided";
const DATABASE_VERSION = 1;
const STORE_NAME = "handoffs";
const STORAGE_PREFIX = "ltx-guided:";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "token" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function databaseRequest(mode, operation) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  }));
}

export function createGuidedToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function saveGuidedHandoff(payload, files = {}) {
  const token = createGuidedToken();
  const record = {
    token,
    createdAt: Date.now(),
    payload,
    files: Object.fromEntries(
      Object.entries(files).filter(([, file]) => file instanceof Blob),
    ),
  };
  try {
    await databaseRequest("readwrite", (store) => store.put(record));
  } catch {
    sessionStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify(payload));
  }
  return token;
}

export async function consumeGuidedHandoff(token) {
  if (!token) return null;
  let record = null;
  try {
    record = await databaseRequest("readwrite", (store) => {
      const request = store.get(token);
      request.addEventListener("success", () => store.delete(token));
      return request;
    });
  } catch {
    // Safari private mode and hardened browsers may reject IndexedDB.
  }
  if (record) return record;
  const key = `${STORAGE_PREFIX}${token}`;
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) return null;
  return { token, payload: JSON.parse(raw), files: {} };
}

export function setInputFile(input, file) {
  if (!input || !(file instanceof Blob) || typeof DataTransfer === "undefined") return false;
  const namedFile = file instanceof File
    ? file
    : new File([file], file.name || "guided-upload", { type: file.type || "application/octet-stream" });
  const transfer = new DataTransfer();
  transfer.items.add(namedFile);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function guidedTokenFromLocation() {
  return new URLSearchParams(location.search).get("guided");
}

