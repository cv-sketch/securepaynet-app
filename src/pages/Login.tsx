import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'

export default function Login() {
  const nav = useNavigate()
  const { user, signIn, hydrating } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeySupported, setPasskeySupported] = useState(false)

  useEffect(() => {
    if (user && !hydrating) nav('/', { replace: true })
  }, [user, hydrating, nav])

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
