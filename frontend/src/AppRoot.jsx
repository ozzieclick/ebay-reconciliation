import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import App from './App'
import Login from './Login'

function AppRoot() {
  if (window.location.pathname === '/privacy') {
    return <App />
  }

  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setCheckingAuth(false)
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
