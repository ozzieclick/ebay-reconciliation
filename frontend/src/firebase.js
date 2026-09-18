import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)

export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    throw new Error('Notifications are not supported by this browser')
  }

  const supported = await isSupported()

  if (!supported) {
    throw new Error('Firebase Messaging is not supported by this browser')
  }

  const permission = await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted')
  }

  const messaging = getMessaging(app)

  return getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
  })
}


export async function listenForForegroundNotifications(callback) {
  const supported = await isSupported()

  if (!supported) {
    return () => {}
  }

  const messaging = getMessaging(app)

  return onMessage(messaging, callback)
}
