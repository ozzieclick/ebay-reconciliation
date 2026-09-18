importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyBMtSAM8K4-tB5sG7Lre1y0rpe6NRZC5jU',
  authDomain: 'reconcile-ebay.firebaseapp.com',
  projectId: 'reconcile-ebay',
  storageBucket: 'reconcile-ebay.firebasestorage.app',
  messagingSenderId: '56167052491',
  appId: '1:56167052491:web:7cfadd10e8ccdfef98574e'
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {}
  const title = notification.title || 'eBay Reconciliation'
  const options = {
    body: notification.body || 'Nuevo evento',
    icon: '/eR-logo.png',
    data: payload.data || {},
  }

  self.registration.showNotification(title, options)
})
