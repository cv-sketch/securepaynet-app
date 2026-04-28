import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../store/useAuth'
import { onboardingService } from '../services/onboardingService'

type Step =
  | { kind: 'choose-method' }
  | { kind: 'email-password-form' }
  | { kind: 'verify-otp'; email: string }
  | { kind: 'finalizing' }

export default function Signup() {
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const { signUpWithEmail, verifyEmailOtp, signInWithGoogleSignup, signOut, user } = useAuth()
  const [step, setStep] = useState<Step>({ kind: 'choose-method' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailExists, setEmailExists] = useState(false)

  // Si volvemos de Google OAuth con ?step=oauth-return, finalizar.
  useEffect(() => {
    if (searchParams.get('step') === 'oauth-return' && user) {
      setStep({ kind: 'finalizing' })
    }
  }, [searchParams, user])

  // 'finalizing' = cliente creado (via recovery o verifyOtp) -> signOut -> /login.
  // Nunca dejamos al user dentro de la app desde signup.
  useEffect(() => {
    if (step.kind !== 'finalizing') return
    ;(async () => {
      try {
        // Idempotente: si ya existe cliente, no hace nada nuevo.
        await onboardingService.completeOnboarding()
      } catch (err: any) {
        setError(err.message ?? 'Error finalizando registro')
        return
      }
      if (typeof window !== 'undefined') window.sessionStorage?.removeItem('onboarding-pending')
      await signOut()
      nav('/login?from=signup', { replace: true })
    })()
  }, [step.kind, signOut, nav])

  const handleGoogle = async () => {
    setError(null); setLoading(true)
    try {
      await signInWithGoogleSignup()
    } catch (err: any) {
      setError(err.message ?? 'Error con Google')
      setLoading(false)
    }
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setEmailExists(false)
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }
    setLoading(true)
    try {
      await signUpWithEmail(email, password)
      setStep({ kind: 'verify-otp', email })
    } catch (err: any) {
      if (err?.code === 'USER_ALREADY_EXISTS') {
        setEmailExists(true)
      } else {
        setError(err.message ?? 'Error creando cuenta')
      }
    } finally { setLoading(false) }
  }

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step.kind !== 'verify-otp') return
    setError(null); setLoading(true)
    try {
      await verifyEmailOtp(step.email, otpCode)
      setStep({ kind: 'finalizing' })
    } catch (err: any) {
      setError(err.message ?? 'Codigo invalido o expirado (vence en 3 min)')
    } finally { setLoading(false) }
  }

  const handleResendOtp = async () => {
    if (step.kind !== 'verify-otp') return
    setError(null); setLoading(true)
    try {
      await onboardingService.resendEmailOtp(step.email)
      setError('Codigo reenviado, revisa tu mail')
    } catch (err: any) {
      setError(err.message ?? 'Error reenviando codigo')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-brand-600">SecurePayNet</div>
          <div className="text-sm text-slate-500 mt-1">Crear cuenta nueva</div>
        </div>

        {step.kind === 'choose-method' && (
          <div className="space-y-3">
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {loading ? 'Conectando…' : 'Continuar con Google'}
            </button>
            <div className="my-4 flex items-center gap-2 text-xs text-slate-400">
              <div className="flex-1 h-px bg-slate-200" />
              <span>o</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <button
              onClick={() => setStep({ kind: 'email-password-form' })}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg"
            >
              Email y contrasena
            </button>
          </div>
        )}

        {step.kind === 'email-password-form' && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {emailExists && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Ya existe una cuenta con <strong>{email}</strong>.{' '}
                <Link to="/login" className="text-brand-600 hover:underline font-semibold">
                  Ingresar
                </Link>
                {' '}o usá otro email.
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email" required value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailExists(false) }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="tu@email.com" autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Contrasena</label>
              <input
                type="password" required value={password} minLength={6}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="al menos 6 caracteres" autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Confirmar contrasena</label>
              <input
                type="password" required value={confirmPassword} minLength={6}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="repetí la contraseña" autoComplete="new-password"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Creando…' : 'Crear cuenta'}
            </button>
            <button type="button" onClick={() => setStep({ kind: 'choose-method' })}
              className="w-full text-xs text-slate-500 hover:underline">
              Volver
            </button>
          </form>
        )}

        {step.kind === 'verify-otp' && (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div className="text-sm text-slate-700">
              Te enviamos un código de 6 dígitos a <strong>{step.email}</strong>. Vence en 3 minutos. Revisá inbox y spam.
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Código de 6 dígitos</label>
              <input
                type="text" required value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-center text-lg tracking-widest focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="123456" inputMode="numeric" maxLength={6}
              />
            </div>
            <button
              type="submit" disabled={loading || otpCode.length !== 6}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Verificando…' : 'Verificar'}
            </button>
            <button type="button" onClick={handleResendOtp} disabled={loading}
              className="w-full text-xs text-brand-600 hover:underline">
              Reenviar código
            </button>
          </form>
        )}

        {step.kind === 'finalizing' && (
          <div className="text-center text-sm text-slate-600 py-8">
            Cuenta creada. Redirigiendo al login…
          </div>
        )}

        {error && (
          <div className="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
            {error}
          </div>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-xs text-slate-500 hover:underline">
            Ya tengo cuenta — Ingresar
          </Link>
        </div>
      </div>
    </div>
  )
}
