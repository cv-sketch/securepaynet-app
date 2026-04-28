import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { onboardingService } from '../services/onboardingService'
import { passkeyService } from '../services/passkeyService'
import { authenticateCredential } from '../lib/webauthn'

type Cliente = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  cuit: string | null
  telefono: string | null
  tipo: string | null
  cvu: string | null
  alias: string | null
  saldo: number | null
  moneda: string | null
}

type State = {
  user: { id: string; email: string } | null
  cliente: Cliente | null
  hydrating: boolean
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  verifyEmailOtp: (email: string, code: string) => Promise<void>
  signInWithGoogleLogin: () => Promise<void>
  signInWithGoogleSignup: () => Promise<void>
  signInWithPasskey: (email: string) => Promise<void>
}

const ONBOARDING_FLAG = 'onboarding-pending'

async function loadCliente(authUserId: string): Promise<Cliente | null> {
  try {
    const { data: cli, error: e1 } = await supabase
      .from('clientes')
      .select('id, nombre, apellido, email, cuit, telefono, tipo')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (e1) {
      console.error('[loadCliente] clientes error:', e1)
      return null
    }
    if (!cli) {
      console.warn('[loadCliente] no cliente found for auth_user_id', authUserId)
      return null
    }

    const { data: wal, error: e2 } = await supabase
      .from('wallets')
      .select('cvu, alias, saldo, moneda')
      .eq('cliente_id', cli.id)
      .maybeSingle()
    if (e2) console.error('[loadCliente] wallets error:', e2)

    return {
      id: cli.id,
      nombre: cli.nombre,
      apellido: cli.apellido,
      email: cli.email,
      cuit: cli.cuit,
      telefono: cli.telefono,
      tipo: cli.tipo,
      cvu: wal?.cvu ?? null,
      alias: wal?.alias ?? null,
      saldo: wal?.saldo ?? null,
      moneda: wal?.moneda ?? null,
    }
  } catch (err) {
    console.error('[loadCliente] exception:', err)
    return null
  }
}

async function loadClienteWithRecovery(authUserId: string): Promise<Cliente | null> {
  let cli = await loadCliente(authUserId)
  if (cli) return cli
  // Recovery: solo si vinimos de un flow de signup colgado
  if (typeof window !== 'undefined' && window.sessionStorage?.getItem(ONBOARDING_FLAG)) {
    try {
      await onboardingService.completeOnboarding()
      window.sessionStorage.removeItem(ONBOARDING_FLAG)
      cli = await loadCliente(authUserId)
    } catch (err) {
      console.error('[loadClienteWithRecovery] completeOnboarding failed:', err)
    }
  }
  return cli
}

export const useAuth = create<State>((set) => ({
  user: null,
  cliente: null,
  hydrating: true,

  hydrate: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        set({ user: null, cliente: null, hydrating: false })
        return
      }
      const cliente = await loadClienteWithRecovery(session.user.id)
      set({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
        hydrating: false,
      })
    } catch (err) {
      console.error('[hydrate] error:', err)
      set({ hydrating: false })
    }
  },

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    if (data.user) {
      const cliente = await loadClienteWithRecovery(data.user.id)
      set({
        user: { id: data.user.id, email: data.user.email ?? '' },
        cliente,
      })
    }
    return { error: null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(ONBOARDING_FLAG)
    set({ user: null, cliente: null })
  },

  signUpWithEmail: async (email, password) => {
    if (typeof window !== 'undefined') window.sessionStorage?.setItem(ONBOARDING_FLAG, '1')
    await onboardingService.signUpWithEmail(email, password)
  },

  verifyEmailOtp: async (email, code) => {
    await onboardingService.verifyEmailOtp(email, code)
    await onboardingService.completeOnboarding()
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(ONBOARDING_FLAG)
  },

  // LOGIN: NO setea ONBOARDING_FLAG. Si el user no tiene cliente, Login.tsx
  // lo expulsa con error. Nunca crea cuenta automaticamente desde /login.
  signInWithGoogleLogin: async () => {
    if (typeof window !== 'undefined') window.sessionStorage?.removeItem(ONBOARDING_FLAG)
    const redirectTo = `${window.location.origin}/login`
    await onboardingService.signInWithGoogle(redirectTo)
  },

  // SIGNUP: setea ONBOARDING_FLAG para que loadClienteWithRecovery cree el
  // cliente. Despues Signup.tsx hace signOut y manda al user a /login.
  signInWithGoogleSignup: async () => {
    if (typeof window !== 'undefined') window.sessionStorage?.setItem(ONBOARDING_FLAG, '1')
    const redirectTo = `${window.location.origin}/signup?step=oauth-return`
    await onboardingService.signInWithGoogle(redirectTo)
  },

  signInWithPasskey: async (email) => {
    const { options } = await passkeyService.loginBegin(email)
    const credential = await authenticateCredential(options)
    const { hashedToken } = await passkeyService.loginFinish(email, credential)
    const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
    if (error) throw error
    // listener onAuthStateChange recarga cliente
  },
}))

// Listener de cambios de sesion - NO bloquea hydrate
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user) {
    useAuth.setState({ user: null, cliente: null })
    return
  }
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    loadClienteWithRecovery(session.user.id).then((cliente) => {
      useAuth.setState({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
      })
    })
  }
})
