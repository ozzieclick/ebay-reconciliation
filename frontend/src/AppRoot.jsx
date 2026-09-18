import { useEffect, useState } from 'react'
import { getIdToken, onAuthStateChanged } from 'firebase/auth'
import { auth, listenForForegroundNotifications, requestNotificationPermission } from './firebase'
import App from './App'
import Login from './Login'

async function registerPushNotifications() {
  try {
    const token = await requestNotificationPermission()

    if (!token || !auth.currentUser) {
      return
    }

    const idToken = await getIdToken(auth.currentUser)

    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/api/push/subscribe`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          token,
          platform: 'web',
        }),
      },
    )

    if (!response.ok) {
      console.error('No se pudo registrar el token FCM:', response.status)
    }
  } catch (error) {
    console.warn('Notificaciones no habilitadas:', error)
  }
}

function AppRoot() {
  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setCheckingAuth(false)

      if (currentUser) {
        registerPushNotifications()

        listenForForegroundNotifications((payload) => {
          const notification = payload.notification || {}
          const title = notification.title || 'eBay Reconciliation'
          const options = {
            body: notification.body || 'Nuevo evento',
            icon: '/eR-logo.png',
            data: payload.data || {},
          }

          if (Notification.permission === 'granted') {
            navigator.serviceWorker.ready.then((registration) => {
              registration.showNotification(title, options)
            })
          }
        })
      }
    })

    return unsubscribe
  }, [])

  if (checkingAuth) {
    return <div>Cargando...</div>
  }

  if (!user) {
    return <Login />
  }

  return <App />
}

export default AppRoot
