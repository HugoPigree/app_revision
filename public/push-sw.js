/* Notifications push de Cadence (importé par le service worker généré). */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Cadence', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Cadence';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Boutons « ✓ Fait » / « Décaler » (Android, ordinateur ; ignorés par l'iPhone)
      actions: Array.isArray(data.actions) ? data.actions : [],
      requireInteraction: !!data.act,
      data: { url: data.url || '/', act: data.act || null },
    }),
  );
});

/** Ouvre l'app (ou la remet au premier plan) sur une adresse donnée */
function openApp(url) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        c.postMessage({ type: 'open', url: url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  });
}

/** Note « fait » dans la base locale de l'app (pour ne pas reposer la question avant la synchro) */
function markDoneLocally(key) {
  return new Promise((resolve) => {
    const m = /^(.+)_(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m) return resolve();
    const req = indexedDB.open('cadence-v2');
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('occStates', 'readwrite');
        tx.objectStore('occStates').put({ key: key, taskId: m[1], date: m[2], status: 'done' });
        tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); resolve(); };
      } catch (e) { db.close(); resolve(); }
    };
  });
}

/** Bouton « ✓ Fait » : coche la tâche sur le serveur, sans ouvrir l'app */
function markDone(act) {
  return fetch(act.api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ u: act.u, k: act.k, t: act.t }),
  }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return markDoneLocally(act.k);
  }).then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .then((list) => { for (const c of list) c.postMessage({ type: 'refresh' }); });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = d.url || '/';
  if (event.action === 'done' && d.act) {
    // Sans réseau : on ouvre l'app pour répondre là-bas
    event.waitUntil(markDone(d.act).catch(() => openApp(url)));
    return;
  }
  if (event.action === 'postpone') {
    event.waitUntil(openApp(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'decaler=1'));
    return;
  }
  event.waitUntil(openApp(url));
});
