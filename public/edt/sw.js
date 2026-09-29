// ============================================================================
// Service worker de la section EDT — scope /edt/ (voir la balise
// <script>navigator.serviceWorker.register('/edt/sw.js', {scope:'/edt/'})</script>
// dans edt.js). Rôle minimal et volontaire : pas de cache offline (l'app a
// besoin d'aller chercher l'heure/l'état à jour, un cache agressif ferait
// plus de mal que de bien ici) — seulement afficher les notifications push
// reçues et ouvrir l'app au clic dessus.
// ============================================================================

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Mon EDT', body: '' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Mon EDT', body: event.data.text() };
    }
  }

  const title = data.title || 'Mon EDT';
  const options = {
    body: data.body || '',
    tag: data.tag || 'edt-notification',
    icon: '/edt/icons/icon-192.png',
    badge: '/edt/icons/icon-192.png',
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.indexOf('/edt/') !== -1 && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/edt/');
      }
    })
  );
});
