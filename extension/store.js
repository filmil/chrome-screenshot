// SPDX-License-Identifier: Apache-2.0
// Screenshots on their way from the service worker to the editor tab, in
// the extension's own IndexedDB. A screenshot stays while its editor tab
// is open, so that reloading the tab keeps it, and goes when the tab
// closes. Nothing here leaves the browser.
//
// A shot is { id, blob, name, created, editorTabId, scaled }.

const DB = "screenshots";
const STORE = "shots";

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, work) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const putShot = (shot) => run("readwrite", (s) => s.put(shot));
export const getShot = (id) => run("readonly", (s) => s.get(id));
export const deleteShot = (id) => run("readwrite", (s) => s.delete(id));

// Each shot's id, editor tab and time of capture.
export async function listShots() {
  const shots = [];
  await run("readonly", (s) => {
    const request = s.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const { id, editorTabId, created } = cursor.value;
      shots.push({ id, editorTabId, created });
      cursor.continue();
    };
    return null;
  });
  return shots;
}
