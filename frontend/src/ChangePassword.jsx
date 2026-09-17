import { useState } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { auth } from './firebase'

function ChangePassword({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()

    setError('')
    setSuccess('')

    if (newPassword.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden.')
      return
    }

    const user = auth.currentUser

    if (!user || !user.email) {
      setError('No hay un usuario autenticado.')
      return
    }

    try {
      setLoading(true)

      const credential = EmailAuthProvider.credential(
        user.email,
        currentPassword,
      )

      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess('Tu contraseña se cambió correctamente.')
    } catch (err) {
      const messages = {
        'auth/invalid-credential': 'La contraseña actual es incorrecta.',
        'auth/wrong-password': 'La contraseña actual es incorrecta.',
        'auth/too-many-requests':
          'Demasiados intentos. Inténtalo nuevamente más tarde.',
        'auth/requires-recent-login':
          'Por seguridad, vuelve a iniciar sesión antes de cambiar la contraseña.',
      }

      setError(messages[err.code] || 'No se pudo cambiar la contraseña.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="password-modal-overlay">
      <div className="password-modal">
        <div className="password-modal-header">
          <div>
            <h2>Cambiar contraseña</h2>
            <p>Actualiza la contraseña de tu cuenta.</p>
          </div>

          <button
            type="button"
            className="password-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label>
            Contraseña actual
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>

          <label>
            Nueva contraseña
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>

          <label>
            Confirmar nueva contraseña
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>

          {error && (
            <div className="password-message password-message-error">
              {error}
            </div>
          )}

          {success && (
            <div className="password-message password-message-success">
              {success}
            </div>
          )}

          <div className="password-actions">
            <button type="button" className="password-cancel" onClick={onClose}>
              Cancelar
            </button>

            <button
              type="submit"
              className="password-submit"
              disabled={loading}
            >
              {loading ? 'Guardando...' : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ChangePassword
