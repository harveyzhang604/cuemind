let connection;
function storageError(error) {
  if (error?.name === 'QuotaExceededError')
    return new Error(
      '本地存储空间不足，结果未能保存。请先导出学习备份，再到设置中查看空间并清理缓存，避免反复请求模型。',
    );
  return error;
}
export function db() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const req = indexedDB.open('cuemind', 3);
      req.onupgradeneeded = () => {
        for (const n of ['videos', 'notes', 'chats', 'aiCache', 'audio'])
          if (!req.result.objectStoreNames.contains(n))
            req.result.createObjectStore(n, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          connection = null;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(storageError(req.error));
    });
  return connection;
}
export async function get(store, id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(storageError(r.error));
  });
}
export async function all(store) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(storageError(r.error));
  });
}
export async function put(store, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).put(value);
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(storageError(t.error));
  });
}
export async function remove(store, id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).delete(id);
    t.oncomplete = resolve;
    t.onerror = () => reject(storageError(t.error));
  });
}

// Summarise saved JSON without returning keys, transcripts or note content.
// Cursor traversal avoids loading all long-video records at once.
export async function statistics() {
  const d = await db(),
    stores = ['videos', 'notes', 'chats', 'aiCache', 'audio'];
  const rows = await Promise.all(
    stores.map(
      (name) =>
        new Promise((resolve, reject) => {
          const transaction = d.transaction(name),
            store = transaction.objectStore(name);
          let count = 0,
            bytes = 0;
          const request = store.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            count++;
            bytes +=
              name === 'audio'
                ? cursor.value.bytes || 0
                : new TextEncoder().encode(JSON.stringify(cursor.value)).byteLength;
            cursor.continue();
          };
          transaction.oncomplete = () => resolve([name, { count, bytes }]);
          transaction.onerror = () => reject(storageError(transaction.error));
          transaction.onabort = () =>
            reject(storageError(transaction.error) || new Error('无法读取本地空间'));
        }),
    ),
  );
  return Object.fromEntries(rows);
}

export async function manage(action, transform) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(['videos', 'notes', 'chats', 'aiCache', 'audio'], 'readwrite');
    t.oncomplete = resolve;
    t.onerror = () => reject(storageError(t.error));
    t.onabort = () => reject(storageError(t.error) || new Error('本地数据操作已回滚'));
    if (action === 'delete-notes') {
      t.objectStore('notes').clear();
      return;
    }
    t.objectStore('aiCache').clear();
    if (action === 'reset') {
      for (const store of ['videos', 'notes', 'chats', 'audio']) t.objectStore(store).clear();
      return;
    }
    t.objectStore('chats').clear();
    const cursor = t.objectStore('videos').openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      try {
        c.update(transform(c.value));
        c.continue();
      } catch {
        t.abort();
      }
    };
    const notes = t.objectStore('notes').openCursor();
    notes.onsuccess = () => {
      const c = notes.result;
      if (!c) return;
      const n = c.value;
      delete n.translations;
      c.update(n);
      c.continue();
    };
  });
}

// One transaction: a rejected/corrupt backup cannot leave half of its data installed.
export async function restore(records) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const transaction = d.transaction(['videos', 'notes', 'chats'], 'readwrite');
    transaction.oncomplete = resolve;
    transaction.onabort = () =>
      reject(storageError(transaction.error) || new Error('备份恢复已回滚'));
    transaction.onerror = () => reject(storageError(transaction.error));
    try {
      for (const name of ['videos', 'notes', 'chats'])
        for (const row of records[name]) transaction.objectStore(name).put(row);
    } catch (e) {
      transaction.abort();
      reject(e);
    }
  });
}

// Compare and write in one transaction, so delayed AI cannot overwrite an edit or deletion.
export async function updateNote(id, expected, changes) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('notes', 'readwrite'),
      store = t.objectStore('notes');
    let result = null;
    const r = store.get(id);
    r.onsuccess = () => {
      const n = r.result;
      if (n && n.updatedAt === expected) {
        result = { ...n, ...changes };
        store.put(result);
      }
    };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(storageError(t.error));
    t.onabort = () => reject(storageError(t.error) || new Error('笔记更新已回滚'));
  });
}
