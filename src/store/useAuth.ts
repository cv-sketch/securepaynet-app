import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { onboardingService } from '../services/onboardingService'
import { passkeyService } from '../services/passkeyService'
import { authenticateCredential } from '../lib/webauthn'
import { createSession, revokeSession } from '../lib/sessionApi'

const SESSION_ID_KEY = 'spn.session_id'

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
  sessionId: string | null
  hydrating: boolean
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: (reason?: 'user' | 'idle' | 'absolute') => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  verifyEmailOtp: (email: string, code: string) => Promise<void>
  signInWithGoogleLogin: () => Promise<void>
  signInWithGoogleSignup: () => Promise<void>
  signInWithPasskey: (email: string) => Promise<void>
  ensureSession: () => Promise<void>
}

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
    if (!cli) return null
    const { data: wal } = await supabase
      .from('wallets')
      .select('cvu, alias, saldo, moneda')
      .eq('cliente_id', cli.id)
      .maybeSingle()
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

export const useAuth = create<State>((set, get) => ({
  user: null,
  cliente: null,
  sessionId: localStorage.getItem(SESSION_ID_KEY),
  hydrating: true,

  hydrate: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        localStorage.removeItem(SESSION_ID_KEY)
        set({ user: null, cliente: null, sessionId: null, hydrating: false })
        return
      }
      const cliente = await loadCliente(session.user.id)
      set({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
        hydrating: false,
      })
      if (!localStorage.getItem(SESSION_ID_KEY)) {
        await get().ensureSession()
      }
    } catch (err) {
      console.error('[hydrate] error:', err)
      set({ hydrating: false })
    }
  },

  ensureSession: async () => {
    if (get().sessionId) return
    try {
      const { session_id } = await createSession()
      localStorage.setItem(SESSION_ID_KEY, session_id)
      set({ sessionId: session_id })
    } catch (e) {
      console.error('[ensureSession] failed:', e)
    }
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    if (data.user) {
      const cliente = await loadCliente(data.user.id)
      set({
        user: { id: data.user.id, email: data.user.email ?? '' },
        cliente,
      })
      await get().ensureSession()
    }
    return { error: null }
  },

  signOut: async (reason = 'user') => {
    const sid = get().sessionId
    if (sid && reason === 'user') {
      try { await revokeSession(sid, 'user') } catch (e) { console.warn(e) }
    }
    localStorage.removeItem(SESSION_ID_KEY)
    await supabase.auth.signOut()
    set({ user: null, cliente: null, sessionId: null })
  },

  signUpWithEmail: async (email, password) => {
    await onboardingService.signUpWithEmail(email, password)
  },

  verifyEmailOtp: async (email, code) => {
    await onboardingService.verifyEmailOtp(email, code)
  },

  signInWithGoogleLogin: async () => {
    const redirectTo = `${window.location.origin}/login`
    await onboardingService.signInWithGoogle(redirectTo)
  },

  signInWithGoogleSignup: async () => {
    const redirectTo = `${window.location.origin}/signup?step=oauth-return`
    await onboardingService.signInWithGoogle(redirectTo)
  },

  signInWithPasskey: async (email) => {
    const { options } = await passkeyService.loginBegin(email)
    const credential = await authenticateCredential(options)
    const { hashedToken } = await passkeyService.loginFinish(email, credential)
    const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
    if (error) throw error
    // ensureSession se llamará desde el listener onAuthStateChange.
  },
}))

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session?.user) {
    localStorage.removeItem(SESSION_ID_KEY)
    useAuth.setState({ user: null, cliente: null, sessionId: null })
    return
  }
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    loadCliente(session.user.id).then((cliente) => {
      useAuth.setState({
        user: { id: session.user.id, email: session.user.email ?? '' },
        cliente,
      })
      if (event === 'SIGNED_IN') void useAuth.getState().ensureSession()
    })
  }
})
