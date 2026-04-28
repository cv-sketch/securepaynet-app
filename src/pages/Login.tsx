import { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/useAuth'

export default function Login() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const expiredReason = searchParams.get('expired')
  const expiredMessage =
    expiredReason === 'idle'
      ? 'Tu sesión finalizó por inactividad. Iniciá sesión nuevamente.'
      : expiredReason === 'absolute'
      ? 'Tu sesión alcanzó la duración máxima permitida. Iniciá sesión nuevamente.'
      : null
  const { user, cliente, signIn, signInWithGoogleLogin, signOut, hydrating } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(
    searchParams.get('from') === 'signup' ? 'Cuenta creada. Ingresá con tu email y contraseña.' : null
  )
  const [passkeySupported, setPasskeySupported] = useState(false)

  // Si hay sesion + cliente => entrar.
  // Si hay sesion pero NO cliente (ej: Google con cuenta inexistente) => expulsar.
  useEffect(() => {
    if (hydrating || !user) return
    if (cliente) {
      nav('/', { replace: true })
    } else {
      ;(async () => {
        await signOut()
        setError('No existe una cuenta con ese email. Creá una nueva primero.')
      })()
    }
  }, [user, cliente, hydrating, nav, signOut])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      setPasskeySupported(true)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await signIn(email, password)
    setLoading(false)
    if (res.error) setError(res.error)
    else nav('/', { replace: true })
  }

  const handleGoogle = async () => {
    setError(null); setInfo(null); setLoading(true)
    try {
      await signInWithGoogleLogin()
    } catch (err: any) {
      setError(err.message ?? 'Error con Google')
      setLoading(false)
    }
    // sigue en redirect
  }

  const handlePasskey = async () => {
    if (!email.trim()) {
      setError('Tipea tu email primero')
      return
    }
    setError(null); setLoading(true)
    try {
      await useAuth.getState().signInWithPasskey(email.trim())
      nav('/', { replace: true })
    } catch (err: any) {
      const msg = err.message === 'CLONED_CREDENTIAL'
        ? 'Passkey invalida. Contactá soporte.'
        : (err.message ?? 'No se pudo ingresar con passkey')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-brand-600">SecurePayNet</div>
          <div className="text-sm text-slate-500 mt-1">Tu billetera virtual</div>
        </div>

        {expiredMessage && (
          <div className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {expiredMessage}
          </div>
        )}

        {info && (
          <div className="mb-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            {info}
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 mb-4"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? 'Conectando…' : 'Ingresar con Google'}
        </button>

        <div className="my-4 flex items-center gap-2 text-xs text-slate-400">
          <div className="flex-1 h-px bg-slate-200" />
          <span>o con email</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              placeholder="tu@email.com" autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Contrasena</label>
            <input
              type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
              placeholder="contrasena" autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        {passkeySupported && (
          <>
            <div className="my-4 flex items-center gap-2 text-xs text-slate-400">
              <div className="flex-1 h-px bg-slate-200" />
              <span>o</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <button
              onClick={handlePasskey} disabled={loading}
              className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Verificando…' : 'Ingresar con passkey'}
            </button>
          </>
        )}

        <Link to="/signup" className="block text-center text-xs text-brand-600 hover:underline mt-4">
          No tengo cuenta — Crear cuenta
        </Link>

        <div className="mt-6 text-center text-xs text-slate-400">
          SecurePayNet S.A. - PSPCP registrado en BCRA
        </div>
      </div>
    </div>
  )
}
