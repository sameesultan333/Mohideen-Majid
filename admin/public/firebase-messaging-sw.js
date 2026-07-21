importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyBo1cdjgdEjHfyDwKBha0EL5nHh5jEEaTQ",
  authDomain:        "mohideen-masjid.firebaseapp.com",
  projectId:         "mohideen-masjid",
  storageBucket:     "mohideen-masjid.firebasestorage.app",
  messagingSenderId: "676960223561",
  appId:             "1:676960223561:android:cdb148eb87977e153fda98",
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  const { title = "Mohideen Masjid", body = "" } = payload.notification || {};
  self.registration.showNotification(title, {
    body,
    icon: "/favicon.svg",
    data: payload.data || {},
  });
});

// On notification click — focus or open the admin tab
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow("/");
    })
  );
});
