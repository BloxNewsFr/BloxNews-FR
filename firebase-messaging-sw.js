// ── Firebase Messaging Service Worker ──
// À placer à la RACINE du repo : /BloxNews-FR/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBkJsHWyoiEeqmEktUlgcED-8mBPnar_0w",
  authDomain:        "blox-bulletin-comments.firebaseapp.com",
  databaseURL:       "https://blox-bulletin-comments-default-rtdb.firebaseio.com",
  projectId:         "blox-bulletin-comments",
  storageBucket:     "blox-bulletin-comments.appspot.com",
  messagingSenderId: "774633429491",
  appId:             "1:774633429491:web:d1f534a0df346fbea79a86",
});

const messaging = firebase.messaging();
const APP_BASE = new URL(self.registration.scope).pathname;

// Notification reçue quand le site est en arrière-plan / fermé
messaging.onBackgroundMessage(payload => {
  const { title, body, icon, url } = payload.data || payload.notification || {};
  self.registration.showNotification(title || 'Blox Leaks Network', {
    body:  body  || 'Nouvelle information disponible !',
    icon:  icon  || `${APP_BASE}icons/icon-192x192.png`,
    badge:        `${APP_BASE}icons/icon-96x96.png`,
    data:  { url: url || '/BloxNews-FR/index.html' },
    vibrate: [200, 100, 200],
    tag: 'bloxnews-push',
    renotify: true
  });
});

// Clic sur la notification → ouvrir la bonne page
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/BloxNews-FR/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('bloxnewsfr.github.io') && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
