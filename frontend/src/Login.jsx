import { useState } from 'react'
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { auth } from './firebase'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      setLoading(true)
      setError('')
      setMessage('')

      if (resetMode) {
        await sendPasswordResetEmail(auth, email)
        setMessage(
          'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.'
        )
        return
      }

      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      const messages = {
        'auth/invalid-credential': 'Correo o contraseña incorrectos.',
        'auth/invalid-email': 'El correo electrónico no es válido.',
        'auth/user-disabled': 'Esta cuenta está deshabilitada.',
        'auth/too-many-requests':
          'Demasiados intentos. Inténtalo nuevamente más tarde.',
      }

      setError(messages[err.code] || 'No se pudo completar la operación.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">eR</div>
          <h1>eBay Reconciliation</h1>
          <p>Gestión y conciliación de cuentas eBay</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <h2>{resetMode ? 'Recuperar contraseña' : 'Iniciar sesión'}</h2>

          {resetMode ? (
            <p className="login-description">
              Introduce tu correo y te enviaremos instrucciones para recuperar
              el acceso.
            </p>
          ) : (
            <p className="login-description">
              Introduce tus credenciales para continuar.
            </p>
          )}

          <label>
            Correo electrónico
            <input
              type="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>

          {!resetMode && (
            <label>
              Contraseña
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
          )}

          {error && <div className="login-alert login-alert-error">{error}</div>}

          {message && (
            <div className="login-alert login-alert-success">{message}</div>
          )}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading
              ? 'Procesando...'
              : resetMode
                ? 'Enviar instrucciones'
                : 'Iniciar sesión'}
          </button>

          <button
            className="login-link"
            type="button"
            onClick={() => {
              setResetMode((value) => !value)
              setError('')
              setMessage('')
              setPassword('')
            }}
          >
            {resetMode
              ? 'Volver a iniciar sesión'
              : '¿Olvidaste tu contraseña?'}
          </button>
        </form>

        <div className="login-footer">
          Acceso privado autorizado
        </div>
      </div>
    </div>
  )
}

export default Login
